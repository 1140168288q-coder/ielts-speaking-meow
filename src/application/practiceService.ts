import {
  LOCAL_DEFAULT_USER_ID,
  recordBelongsToAccount,
} from '../domain/accounts'
import {
  aiFeedbackSchema,
  secondAttemptAnalysisSchema,
  type ConfirmedMemoryFact,
  type IeltsPart,
  type MemoryCandidate,
  type Question,
  type SecondAttemptAnalysis,
  savedExpressionSchema,
  trainingSessionSchema,
  type AiFeedback,
  type PracticeAttempt,
  type SavedExpression,
  type TrainingSession,
} from '../domain/models'
import {
  questionPracticeStateId,
  questionPracticeStateSchema,
  type QuestionPracticeState,
} from '../domain/questionPracticeState'
import { analyzeSpeech } from '../domain/speechAnalysis'
import type { LocalDataMaintenance, LocalStorage } from '../ports/storage'

type SessionUpdater = (session: TrainingSession | null) => TrainingSession | null

const sessionWriteQueues = new WeakMap<object, Map<string, Promise<void>>>()

export interface PracticeServiceDependencies {
  localStorage: LocalStorage & Pick<LocalDataMaintenance, 'deleteSessionWithAudio'>
  now?: () => Date
  createId?: () => string
  /** 当前本地账号 userId;切换账号后所有读写立即按新账号过滤。 */
  getCurrentUserId?: () => string
}

export interface AnswerTextSnapshot {
  attemptId: string
  text: string
  updatedAt: string
}

const defaultCreateId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Coordinates durable text-answer practice writes.
 *
 * V1.7 起答题为文本:用户手动输入,或使用手机系统键盘的语音输入。
 * 可选计时器只记录作答耗时,仅供参考,不参与任何语速或语音表现评价。
 * 历史录音数据仍由存储层原样保留,本服务不再读取或删除它们。
 */
export class PracticeService {
  private readonly localStorage: LocalStorage & Pick<LocalDataMaintenance, 'deleteSessionWithAudio'>
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly getCurrentUserId: () => string

  constructor(dependencies: PracticeServiceDependencies) {
    this.localStorage = dependencies.localStorage
    this.now = dependencies.now ?? (() => new Date())
    this.createId = dependencies.createId ?? defaultCreateId
    this.getCurrentUserId =
      dependencies.getCurrentUserId ?? (() => LOCAL_DEFAULT_USER_ID)
  }

  async createSession(
    questionId: string,
    part: 1 | 2 | 3 | null = null,
    questionSnapshot?: Question,
  ): Promise<TrainingSession> {
    const timestamp = this.now().toISOString()
    const session = trainingSessionSchema.parse({
      id: this.createId(),
      ownerId: this.getCurrentUserId(),
      questionId,
      part,
      ...(questionSnapshot === undefined ? {} : { questionSnapshot }),
      status: 'first-ready',
      attempts: [],
      localFeedback: [],
      aiFeedback: null,
      secondAttemptAnalysis: null,
      confirmedMemoryFacts: [],
      aiComparison: null,
      comparison: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    await this.localStorage.upsertSession(session)
    return session
  }

  async saveTextAttempt(
    sessionId: string,
    attemptNumber: 1 | 2,
    text: string,
    answerDurationMs: number | null = null,
  ): Promise<TrainingSession> {
    const cleanText = text.trim()
    if (cleanText.length === 0) {
      throw new Error('请先输入答案文本，再提交。')
    }

    const updated = await this.updateSessionAtomically(sessionId, (session) => {
      if (session === null || !recordBelongsToAccount(session.ownerId, this.getCurrentUserId())) {
        throw new Error('The practice session could not be found.')
      }
      const timestamp = this.now().toISOString()
      const attempt: PracticeAttempt = {
        id: this.createId(),
        attemptNumber,
        audio: null,
        transcript: {
          status: 'ready',
          text: cleanText,
          originalText: null,
          source: 'manual',
          errorCode: null,
          updatedAt: timestamp,
        },
        metrics: analyzeSpeech({
          transcript: cleanText,
          durationMs: answerDurationMs ?? 0,
        }),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const attempts = [
        ...session.attempts.filter((existing) => existing.attemptNumber !== attemptNumber),
        attempt,
      ].sort((a, b) => a.attemptNumber - b.attemptNumber)
      return trainingSessionSchema.parse({
        ...session,
        attempts,
        status: attemptNumber === 1 ? 'first-review' : 'comparison-ready',
        localFeedback: [],
        comparison: null,
        aiComparison: null,
        ...(attemptNumber === 2 ? { secondAttemptAnalysis: null } : {}),
        updatedAt: timestamp,
      })
    })
    if (updated === null) throw new Error('The practice session could not be found.')
    return updated
  }

  async applyAiFeedback(
    sessionId: string,
    feedback: AiFeedback,
  ): Promise<TrainingSession> {
    const parsedFeedback = aiFeedbackSchema.parse(feedback)
    const updated = await this.updateSessionAtomically(sessionId, (session) => {
      if (session === null || !recordBelongsToAccount(session.ownerId, this.getCurrentUserId())) {
        throw new Error('The practice session could not be found.')
      }
      return this.buildAiFeedbackSession(session, parsedFeedback)
    })
    if (updated === null) throw new Error('The practice session could not be found.')
    return updated
  }

  async applyAiFeedbackIfAnswerCurrent(
    sessionId: string,
    snapshot: AnswerTextSnapshot,
    feedback: AiFeedback,
  ): Promise<TrainingSession | null> {
    const parsedFeedback = aiFeedbackSchema.parse(feedback)
    return this.updateSessionAtomically(sessionId, (session) => {
      if (session === null || !recordBelongsToAccount(session.ownerId, this.getCurrentUserId())) {
        throw new Error('The practice session could not be found.')
      }
      const firstAttempt = session.attempts.find((attempt) => attempt.attemptNumber === 1)
      if (
        firstAttempt?.id !== snapshot.attemptId ||
        firstAttempt.transcript.status !== 'ready' ||
        firstAttempt.transcript.text !== snapshot.text ||
        firstAttempt.transcript.updatedAt !== snapshot.updatedAt
      ) return null
      return this.buildAiFeedbackSession(session, parsedFeedback)
    })
  }

  async applySecondAttemptAnalysisIfAnswerCurrent(
    sessionId: string,
    snapshot: AnswerTextSnapshot,
    analysis: SecondAttemptAnalysis,
  ): Promise<TrainingSession | null> {
    const parsedAnalysis = secondAttemptAnalysisSchema.parse(analysis)
    return this.updateSessionAtomically(sessionId, (session) => {
      if (session === null || !recordBelongsToAccount(session.ownerId, this.getCurrentUserId())) {
        throw new Error('The practice session could not be found.')
      }
      const secondAttempt = session.attempts.find((attempt) => attempt.attemptNumber === 2)
      if (
        secondAttempt?.id !== snapshot.attemptId ||
        secondAttempt.transcript.status !== 'ready' ||
        secondAttempt.transcript.text !== snapshot.text ||
        secondAttempt.transcript.updatedAt !== snapshot.updatedAt
      ) return null
      return trainingSessionSchema.parse({
        ...session,
        secondAttemptAnalysis: parsedAnalysis,
        updatedAt: this.now().toISOString(),
      })
    })
  }

  async prepareSecondAttempt(sessionId: string): Promise<TrainingSession> {
    const updated = await this.updateSessionAtomically(sessionId, (session) => {
      if (session === null || !recordBelongsToAccount(session.ownerId, this.getCurrentUserId())) {
        throw new Error('The practice session could not be found.')
      }
      if (!session.attempts.some((attempt) => attempt.attemptNumber === 1)) {
        throw new Error('请先完成第一次回答，再进入第二次。')
      }
      return trainingSessionSchema.parse({
        ...session,
        status: 'second-ready',
        updatedAt: this.now().toISOString(),
      })
    })
    if (updated === null) throw new Error('The practice session could not be found.')
    return updated
  }

  async completeSession(sessionId: string): Promise<TrainingSession> {
    const updated = await this.updateSessionAtomically(sessionId, (session) => {
      if (session === null || !recordBelongsToAccount(session.ownerId, this.getCurrentUserId())) {
        throw new Error('The practice session could not be found.')
      }
      if (!session.attempts.some((attempt) => attempt.attemptNumber === 2)) {
        throw new Error('请先完成第二次回答，再结束练习。')
      }
      return trainingSessionSchema.parse({
        ...session,
        status: 'completed',
        updatedAt: this.now().toISOString(),
      })
    })
    if (updated === null) throw new Error('The practice session could not be found.')
    await this.setQuestionDone(updated.questionId, true)
    return updated
  }

  /**
   * 用户从第二次回答里确认一条短表达后收录进个人语料；完整回答仍只属于
   * 练习记录，避免把个人语料库变成范文仓库。会话同时完成。
   */
  async submitSecondAnswerToCorpus(
    sessionId: string,
    text: string,
    topic: string,
  ): Promise<{ session: TrainingSession; expression: SavedExpression }> {
    const session = await this.requireSession(sessionId)
    const secondAttempt = session.attempts.find(
      (attempt) => attempt.attemptNumber === 2,
    )
    if (!secondAttempt) {
      throw new Error('请先完成第二次回答，再提交收录。')
    }

    const cleanText = text.trim()
    if (cleanText.length === 0) {
      throw new Error('请先挑选一句值得复用的表达。')
    }
    const result = await this.finalizeSecondAttempt(sessionId, {
      correctedSentences: [cleanText],
      memoryCandidates: [],
      topic,
    })
    const expression = result.expressions[0]
    if (expression === undefined) {
      throw new Error('个人语料保存失败。')
    }
    return { session: result.session, expression }
  }

  async finalizeSecondAttempt(
    sessionId: string,
    input: {
      correctedSentences: string[]
      memoryCandidates: MemoryCandidate[]
      topic: string
    },
  ): Promise<{ session: TrainingSession; expressions: SavedExpression[] }> {
    const session = await this.requireSession(sessionId)
    const secondAttempt = session.attempts.find(
      (attempt) => attempt.attemptNumber === 2,
    )
    if (!secondAttempt) {
      throw new Error('请先完成第二次回答，再提交收录。')
    }

    const sourcePart = session.part ?? inferPartFromQuestionId(session.questionId)
    const timestamp = this.now().toISOString()
    const expressionTexts = [...new Set(
      input.correctedSentences
        .map((text) => text.trim())
        .filter((text) => text.length > 0),
    )]
    const existingExpressions = (await this.localStorage.listExpressions())
      .filter((expression) =>
        recordBelongsToAccount(expression.ownerId, this.getCurrentUserId()) &&
        expression.sessionId === sessionId &&
        expression.sourceAttempt === 2,
      )
    const expressions = expressionTexts.map((text) => {
      const existing = existingExpressions.find((item) => item.text === text)
      return existing ?? savedExpressionSchema.parse({
        id: this.createId(),
        ownerId: this.getCurrentUserId(),
        text,
        topic: input.topic.trim() || '未分类',
        sourcePart,
        questionId: session.questionId,
        sessionId,
        sourceAttempt: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
        reviewCount: 0,
        lastReviewedAt: null,
        reuseCount: 0,
      })
    })
    for (const expression of expressions) {
      if (!existingExpressions.some((item) => item.id === expression.id)) {
        await this.localStorage.upsertExpression(expression)
      }
    }

    const existingFacts = session.confirmedMemoryFacts ?? []
    const existingFactKeys = new Set(existingFacts.map((fact) => fact.content))
    const memoryFacts: ConfirmedMemoryFact[] = input.memoryCandidates
      .filter((candidate) => sourcePart !== null && candidate.sourcePart === sourcePart)
      .filter((candidate) => isMemoryCandidateGrounded(candidate.sourceSentence, secondAttempt.transcript.text))
      .filter((candidate) => {
        if (existingFactKeys.has(candidate.content)) return false
        existingFactKeys.add(candidate.content)
        return true
      })
      .map((candidate) => ({
        id: this.createId(),
        content: candidate.content,
        kind: candidate.kind,
        topicTags: candidate.topicTags,
        sourceSentence: candidate.sourceSentence,
        sourcePart: candidate.sourcePart,
        sourceAttempt: 2,
        createdAt: timestamp,
      }))

    const updated = await this.updateSessionAtomically(sessionId, (current) => {
      if (current === null || !recordBelongsToAccount(current.ownerId, this.getCurrentUserId())) {
        throw new Error('The practice session could not be found.')
      }
      const currentSecondAttempt = current.attempts.find((attempt) => attempt.attemptNumber === 2)
      if (currentSecondAttempt?.id !== secondAttempt.id || currentSecondAttempt.transcript.text !== secondAttempt.transcript.text) {
        throw new Error('第二次回答已经变化，请重新确认收录内容。')
      }
      const currentFacts = current.confirmedMemoryFacts ?? []
      const currentFactKeys = new Set(currentFacts.map((fact) => fact.content))
      const mergedFacts = [
        ...currentFacts,
        ...memoryFacts.filter((fact) => {
          if (currentFactKeys.has(fact.content)) return false
          currentFactKeys.add(fact.content)
          return true
        }),
      ]
      return trainingSessionSchema.parse({
        ...current,
        confirmedMemoryFacts: mergedFacts,
        status: 'completed',
        updatedAt: timestamp,
      })
    })
    if (updated === null) throw new Error('The practice session could not be found.')
    await this.setQuestionDone(updated.questionId, true)
    return { session: updated, expressions }
  }

  async updateMemoryFactPart(
    sessionId: string,
    factId: string,
    sourcePart: IeltsPart | null,
  ): Promise<TrainingSession> {
    const updated = await this.updateSessionAtomically(sessionId, (session) => {
      if (session === null || !recordBelongsToAccount(session.ownerId, this.getCurrentUserId())) {
        throw new Error('The practice session could not be found.')
      }
      const facts = session.confirmedMemoryFacts ?? []
      if (!facts.some((fact) => fact.id === factId)) {
        throw new Error('这条 Memory 不存在，或不属于当前账号。')
      }
      return trainingSessionSchema.parse({
        ...session,
        confirmedMemoryFacts: facts.map((fact) =>
          fact.id === factId ? { ...fact, sourcePart } : fact,
        ),
        updatedAt: this.now().toISOString(),
      })
    })
    if (updated === null) throw new Error('The practice session could not be found.')
    return updated
  }

  async deleteMemoryFact(
    sessionId: string,
    factId: string,
  ): Promise<TrainingSession> {
    const updated = await this.updateSessionAtomically(sessionId, (session) => {
      if (session === null || !recordBelongsToAccount(session.ownerId, this.getCurrentUserId())) {
        throw new Error('The practice session could not be found.')
      }
      const facts = session.confirmedMemoryFacts ?? []
      if (!facts.some((fact) => fact.id === factId)) {
        throw new Error('这条 Memory 不存在，或不属于当前账号。')
      }
      return trainingSessionSchema.parse({
        ...session,
        confirmedMemoryFacts: facts.filter((fact) => fact.id !== factId),
        updatedAt: this.now().toISOString(),
      })
    })
    if (updated === null) throw new Error('The practice session could not be found.')
    return updated
  }

  async listQuestionPracticeStates(): Promise<QuestionPracticeState[]> {
    return this.localStorage.listQuestionPracticeStates(this.getCurrentUserId())
  }

  async setQuestionDone(
    questionId: string,
    isDone: boolean,
  ): Promise<QuestionPracticeState> {
    const ownerId = this.getCurrentUserId()
    const state = questionPracticeStateSchema.parse({
      id: questionPracticeStateId(ownerId, questionId),
      ownerId,
      questionId,
      isDone,
      updatedAt: this.now().toISOString(),
    })
    await this.localStorage.saveQuestionPracticeState(state)
    return state
  }

  async listSessions(): Promise<TrainingSession[]> {
    const ownerId = this.getCurrentUserId()
    const sessions = (await this.localStorage.listSessions()).filter((session) =>
      recordBelongsToAccount(session.ownerId, ownerId),
    )
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listExpressions(): Promise<SavedExpression[]> {
    const ownerId = this.getCurrentUserId()
    const expressions = (await this.localStorage.listExpressions()).filter(
      (expression) => recordBelongsToAccount(expression.ownerId, ownerId),
    )
    return expressions.sort((a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
    )
  }

  async updateExpression(
    expressionId: string,
    changes: Pick<SavedExpression, 'text' | 'topic' | 'sourcePart'>,
  ): Promise<SavedExpression> {
    if (changes.sourcePart === null) {
      throw new Error('保存个人语料前，请先选择归属 Part。')
    }
    const existing = await this.requireExpression(expressionId)
    const updated = savedExpressionSchema.parse({
      ...existing,
      text: changes.text,
      topic: changes.topic,
      sourcePart: changes.sourcePart,
      updatedAt: this.now().toISOString(),
    })
    await this.localStorage.upsertExpression(updated)
    return updated
  }

  async markExpressionReviewed(expressionId: string): Promise<SavedExpression> {
    const existing = await this.requireExpression(expressionId)
    const timestamp = this.now().toISOString()
    const updated = savedExpressionSchema.parse({
      ...existing,
      reviewCount: (existing.reviewCount ?? 0) + 1,
      lastReviewedAt: timestamp,
      updatedAt: timestamp,
    })
    await this.localStorage.upsertExpression(updated)
    return updated
  }

  /** 用户把历史素材插入当前题答案时调用;用于长期记忆和排序。 */
  async markExpressionReused(expressionId: string): Promise<SavedExpression> {
    const existing = await this.requireExpression(expressionId)
    const updated = savedExpressionSchema.parse({
      ...existing,
      reuseCount: (existing.reuseCount ?? 0) + 1,
      updatedAt: this.now().toISOString(),
    })
    await this.localStorage.upsertExpression(updated)
    return updated
  }

  async deleteSession(
    sessionId: string,
  ): Promise<{ deletedAudio: number }> {
    await this.requireSession(sessionId)
    return this.localStorage.deleteSessionWithAudio(
      sessionId,
      this.getCurrentUserId(),
      this.now().toISOString(),
    )
  }

  async deleteExpression(expressionId: string): Promise<void> {
    await this.requireExpression(expressionId)
    await this.localStorage.deleteExpression(
      expressionId,
      this.getCurrentUserId(),
      this.now().toISOString(),
    )
  }

  async getSession(sessionId: string): Promise<TrainingSession | null> {
    const session = await this.localStorage.getSession(sessionId)
    if (session === null) return null
    return recordBelongsToAccount(session.ownerId, this.getCurrentUserId())
      ? session
      : null
  }

  private async updateSessionAtomically(
    sessionId: string,
    updater: SessionUpdater,
  ): Promise<TrainingSession | null> {
    const atomicUpdater = this.localStorage.updateSessionAtomically
    if (atomicUpdater !== undefined) {
      return atomicUpdater.call(this.localStorage, sessionId, updater)
    }

    let queues = sessionWriteQueues.get(this.localStorage)
    if (queues === undefined) {
      queues = new Map()
      sessionWriteQueues.set(this.localStorage, queues)
    }
    const previous = queues.get(sessionId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    queues.set(sessionId, current)
    await previous
    try {
      const existing = await this.localStorage.getSession(sessionId)
      const updated = updater(existing)
      if (updated !== null) await this.localStorage.upsertSession(updated)
      return updated
    } finally {
      release()
      if (queues.get(sessionId) === current) queues.delete(sessionId)
    }
  }

  private buildAiFeedbackSession(
    session: TrainingSession,
    feedback: AiFeedback,
  ): TrainingSession {
    return trainingSessionSchema.parse({
      ...session,
      aiFeedback: aiFeedbackSchema.parse(feedback),
      status:
        session.status === 'first-review' ? 'feedback-ready' : session.status,
      updatedAt: this.now().toISOString(),
    })
  }

  private async requireExpression(expressionId: string): Promise<SavedExpression> {
    const expression = await this.localStorage.getExpression(expressionId)
    if (!expression || !recordBelongsToAccount(
      expression.ownerId,
      this.getCurrentUserId(),
    )) {
      throw new Error('Saved expression not found.')
    }
    return expression
  }

  private async requireSession(sessionId: string): Promise<TrainingSession> {
    const session = await this.localStorage.getSession(sessionId)
    if (!session || !recordBelongsToAccount(
      session.ownerId,
      this.getCurrentUserId(),
    )) {
      throw new Error('The practice session could not be found.')
    }
    return session
  }
}

function inferPartFromQuestionId(questionId: string): 1 | 2 | 3 | null {
  const match = /^p([123])-/u.exec(questionId)
  return match === null ? null : Number(match[1]) as 1 | 2 | 3
}

function isMemoryCandidateGrounded(sourceSentence: string, answer: string): boolean {
  const sourceTokens = sourceSentence.toLocaleLowerCase().match(/[a-z0-9']+/gu) ?? []
  const answerTokens = new Set(answer.toLocaleLowerCase().match(/[a-z0-9']+/gu) ?? [])
  if (sourceTokens.length === 0) {
    return answer.toLocaleLowerCase().includes(sourceSentence.trim().toLocaleLowerCase())
  }
  const meaningful = sourceTokens.filter((token) => token.length >= 3)
  if (meaningful.length === 0) return false
  const overlap = meaningful.filter((token) => answerTokens.has(token)).length
  // A source sentence must largely describe words the learner actually used;
  // matching only a generic time phrase such as "last year" is not enough to
  // turn a model-generated fact into durable Memory.
  return overlap / meaningful.length >= 0.75
}
