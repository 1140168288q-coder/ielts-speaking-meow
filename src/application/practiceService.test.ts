import {
  type AiFeedback,
  type PracticeTexts,
  type SavedExpression,
  type SecondAttemptAnalysis,
  type TrainingSession,
} from '../domain/models'
import type { QuestionPracticeState } from '../domain/questionPracticeState'
import type { PersonalMaterial } from '../domain/personalMaterials'
import type { LocalStorage } from '../ports/storage'
import { PracticeService } from './practiceService'

const NOW = new Date('2026-08-09T02:00:00.000Z')

interface MemoryBacking {
  sessions: Map<string, TrainingSession>
  expressions: Map<string, SavedExpression>
  states?: Map<string, QuestionPracticeState>
}

class MemoryPersistence implements LocalStorage {
  sessions: Map<string, TrainingSession>
  expressions: Map<string, SavedExpression>
  states: Map<string, QuestionPracticeState>
  materials = new Map<string, PersonalMaterial>()
  texts: PracticeTexts | null = null
  failNextSessionWrite: Error | null = null

  constructor(backing: MemoryBacking = { sessions: new Map(), expressions: new Map() }) {
    this.sessions = backing.sessions
    this.expressions = backing.expressions
    this.states = backing.states ?? new Map<string, QuestionPracticeState>()
  }

  upsertSession(session: TrainingSession): Promise<void> {
    if (this.failNextSessionWrite) {
      const error = this.failNextSessionWrite
      this.failNextSessionWrite = null
      return Promise.reject(error)
    }
    this.sessions.set(session.id, structuredClone(session))
    return Promise.resolve()
  }

  getSession(sessionId: string): Promise<TrainingSession | null> {
    const session = this.sessions.get(sessionId)
    return Promise.resolve(session ? structuredClone(session) : null)
  }

  listSessions(): Promise<TrainingSession[]> {
    return Promise.resolve(
      [...this.sessions.values()].map((session) => structuredClone(session)),
    )
  }

  listQuestionPracticeStates(ownerId: string): Promise<QuestionPracticeState[]> {
    return Promise.resolve(
      [...this.states.values()]
        .filter((state) => state.ownerId === ownerId)
        .map((state) => structuredClone(state)),
    )
  }

  saveQuestionPracticeState(state: QuestionPracticeState): Promise<void> {
    this.states.set(state.id, structuredClone(state))
    return Promise.resolve()
  }

  upsertExpression(expression: SavedExpression): Promise<void> {
    this.expressions.set(expression.id, structuredClone(expression))
    return Promise.resolve()
  }

  getExpression(expressionId: string): Promise<SavedExpression | null> {
    const expression = this.expressions.get(expressionId)
    return Promise.resolve(expression ? structuredClone(expression) : null)
  }

  listExpressions(): Promise<SavedExpression[]> {
    return Promise.resolve(
      [...this.expressions.values()].map((expression) =>
        structuredClone(expression),
      ),
    )
  }

  deleteExpression(expressionId: string): Promise<void> {
    this.expressions.delete(expressionId)
    return Promise.resolve()
  }

  upsertPersonalMaterial(material: PersonalMaterial): Promise<void> {
    this.materials.set(material.id, structuredClone(material))
    return Promise.resolve()
  }

  getPersonalMaterial(
    materialId: string,
    ownerId: string,
  ): Promise<PersonalMaterial | null> {
    const material = this.materials.get(materialId)
    return Promise.resolve(
      material?.ownerId === ownerId ? structuredClone(material) : null,
    )
  }

  listPersonalMaterials(ownerId: string): Promise<PersonalMaterial[]> {
    return Promise.resolve(
      [...this.materials.values()].filter(
        (material) => material.ownerId === ownerId,
      ),
    )
  }

  deletePersonalMaterial(
    materialId: string,
    ownerId: string,
  ): Promise<void> {
    if (this.materials.get(materialId)?.ownerId === ownerId) {
      this.materials.delete(materialId)
    }
    return Promise.resolve()
  }

  deleteSessionWithAudio(
    sessionId: string,
    ownerId: string,
  ): Promise<{ deletedAudio: number }> {
    const session = this.sessions.get(sessionId)
    if (session?.ownerId === ownerId) this.sessions.delete(sessionId)
    return Promise.resolve({ deletedAudio: 0 })
  }

  getPracticeTexts(): Promise<PracticeTexts | null> {
    return Promise.resolve(this.texts)
  }

  savePracticeTexts(texts: PracticeTexts): Promise<void> {
    this.texts = texts
    return Promise.resolve()
  }
}

const createService = (
  storage = new MemoryPersistence(),
  getCurrentUserId?: () => string,
  createId?: () => string,
) =>
  new PracticeService({
    localStorage: storage,
    now: () => NOW,
    createId: createId ?? (() => {
      let counter = 0
      return () => `id-${++counter}`
    })(),
    ...(getCurrentUserId !== undefined ? { getCurrentUserId } : {}),
  })

const FEEDBACK: AiFeedback = {
  summary: '回答切题，重点是过去时态需要更稳。',
  strengths: ['有具体例子。'],
  problems: ['过去时态混用。', '结尾还可以补一个具体细节。'],
  grammarSuggestions: ['先想好动词过去式。'],
  vocabularySuggestions: ['用 relaxing 代替 good。'],
  referenceAnswers: [
    { label: '简单优化版', text: 'I like reading books because they help me relax.' },
    { label: '自然提升版', text: 'I enjoy reading books because they help me unwind.' },
  ],
  naturalUpgradeSuggestions: { addableContent: [], advancedChanges: [] },
  answerFramework: [{ label: '直接回答', template: 'I usually ___ because ___.' }],
}

describe('PracticeService V1.7 text-answer flow', () => {
  it('creates a session with no answer attempts', async () => {
    const storage = new MemoryPersistence()
    const service = createService(storage)

    const session = await service.createSession('p1-hobbies')

    expect(session.status).toBe('first-ready')
    expect(session.attempts).toHaveLength(0)
    expect(storage.sessions.get(session.id)).toBeDefined()
  })

  it('saves a first text answer with an optional timer duration and no audio', async () => {
    const storage = new MemoryPersistence()
    const service = createService(storage)
    const session = await service.createSession('p1-hobbies')

    const updated = await service.saveTextAttempt(
      session.id,
      1,
      'I like reading books in my free time.',
      32_500,
    )

    const attempt = updated.attempts[0]
    expect(attempt?.attemptNumber).toBe(1)
    expect(attempt?.audio).toBeNull()
    expect(attempt?.transcript.status).toBe('ready')
    expect(attempt?.transcript.source).toBe('manual')
    expect(attempt?.transcript.text).toBe('I like reading books in my free time.')
    expect(attempt?.metrics.durationMs).toBe(32_500)
    expect(attempt?.metrics.wordsPerMinute).toBeNull()
    expect(attempt?.metrics.acoustic ?? null).toBeNull()
    expect(updated.status).toBe('first-review')
    expect(updated.aiFeedback).toBeNull()
  })

  it('rejects an empty text answer', async () => {
    const service = createService()
    const session = await service.createSession('p1-hobbies')

    await expect(service.saveTextAttempt(session.id, 1, '   ', null))
      .rejects.toThrow('答案文本')
  })

  it('applies AI feedback only when the first answer text is unchanged', async () => {
    const storage = new MemoryPersistence()
    const service = createService(storage)
    const session = await service.createSession('p1-hobbies')
    const withAnswer = await service.saveTextAttempt(
      session.id,
      1,
      'I like reading books.',
      12_000,
    )
    const attempt = withAnswer.attempts[0]!

    const updated = await service.applyAiFeedbackIfAnswerCurrent(
      session.id,
      {
        attemptId: attempt.id,
        text: attempt.transcript.text,
        updatedAt: attempt.transcript.updatedAt,
      },
      FEEDBACK,
    )

    expect(updated?.status).toBe('feedback-ready')
    expect(updated?.aiFeedback?.summary).toBe(FEEDBACK.summary)
    expect(updated?.aiFeedback?.referenceAnswers).toHaveLength(2)

    const stale = await service.applyAiFeedbackIfAnswerCurrent(
      session.id,
      {
        attemptId: attempt.id,
        text: 'a different answer',
        updatedAt: attempt.transcript.updatedAt,
      },
      FEEDBACK,
    )
    expect(stale).toBeNull()
  })

  it('moves to the second answer stage and preserves the first answer', async () => {
    const service = createService()
    const session = await service.createSession('p1-hobbies')
    const withAnswer = await service.saveTextAttempt(
      session.id,
      1,
      'I like reading books.',
      10_000,
    )

    const secondReady = await service.prepareSecondAttempt(withAnswer.id)

    expect(secondReady.status).toBe('second-ready')
    expect(secondReady.attempts).toHaveLength(1)
  })

  it('stores second-answer corrections as corpus and asks before adding Memory facts', async () => {
    const storage = new MemoryPersistence()
    const service = createService(storage)
    const created = await service.createSession('p1-hobbies', 1)
    const first = await service.saveTextAttempt(created.id, 1, 'I like reading.', null)
    const ready = await service.prepareSecondAttempt(first.id)
    const second = await service.saveTextAttempt(ready.id, 2, 'I go to Beijing last year.', null)
    const analysis: SecondAttemptAnalysis = {
      correctedSentences: [{
        original: 'I go there last year.',
        corrected: 'I went there last year.',
        reason: '过去时间使用过去式。',
      }],
      memoryCandidates: [{
        content: '我去年去了北京。',
        kind: 'experience',
        topicTags: ['travel'],
        sourceSentence: 'I go to Beijing last year.',
        sourcePart: 1,
      }],
    }

    const analyzed = await service.applySecondAttemptAnalysisIfAnswerCurrent(
      second.id,
      {
        attemptId: second.attempts.find((item) => item.attemptNumber === 2)!.id,
        text: 'I go to Beijing last year.',
        updatedAt: second.attempts.find((item) => item.attemptNumber === 2)!.transcript.updatedAt,
      },
      analysis,
    )
    expect(analyzed?.secondAttemptAnalysis).toEqual(analysis)

    const result = await service.finalizeSecondAttempt(second.id, {
      correctedSentences: ['I went there last year.'],
      memoryCandidates: analysis.memoryCandidates,
      topic: 'Travel',
    })
    expect(result.session.status).toBe('completed')
    expect(result.expressions[0]).toMatchObject({
      text: 'I went there last year.',
      sourceAttempt: 2,
      sourcePart: 1,
    })
    expect(result.session.confirmedMemoryFacts[0]).toMatchObject({
      content: '我去年去了北京。',
      sourcePart: 1,
      sourceAttempt: 2,
    })

    const retried = await service.finalizeSecondAttempt(second.id, {
      correctedSentences: ['I went there last year.'],
      memoryCandidates: analysis.memoryCandidates,
      topic: 'Travel',
    })
    expect(retried.expressions).toHaveLength(1)
    expect(storage.expressions.size).toBe(1)
    expect(retried.session.confirmedMemoryFacts).toHaveLength(1)
  })

  it('rejects a Memory candidate whose source adds facts absent from the second answer', async () => {
    const service = createService()
    const created = await service.createSession('p1-hobbies', 1)
    const first = await service.saveTextAttempt(created.id, 1, 'I like reading.', null)
    const ready = await service.prepareSecondAttempt(first.id)
    const second = await service.saveTextAttempt(ready.id, 2, 'I go there last year.', null)

    const result = await service.finalizeSecondAttempt(second.id, {
      correctedSentences: [],
      memoryCandidates: [{
        content: '我去年去了北京。',
        kind: 'experience',
        topicTags: ['travel'],
        sourceSentence: 'I went to Beijing last year.',
        sourcePart: 1,
      }],
      topic: 'Travel',
    })

    expect(result.session.confirmedMemoryFacts).toEqual([])
  })

  it('lets the learner reclassify a unified Memory fact without duplicating it', async () => {
    const storage = new MemoryPersistence()
    const service = createService(storage)
    const created = await service.createSession('p1-hobbies', 1)
    const first = await service.saveTextAttempt(created.id, 1, 'I like reading.', null)
    const ready = await service.prepareSecondAttempt(first.id)
    const second = await service.saveTextAttempt(ready.id, 2, 'I read at home.', null)
    const result = await service.finalizeSecondAttempt(second.id, {
      correctedSentences: [],
      memoryCandidates: [{
        content: '我喜欢在家阅读。',
        kind: 'preference',
        topicTags: ['hobbies'],
        sourceSentence: 'I read at home.',
        sourcePart: 1,
      }],
      topic: 'Hobbies',
    })

    const reclassified = await service.updateMemoryFactPart(
      result.session.id,
      result.session.confirmedMemoryFacts[0]!.id,
      2,
    )
    expect(reclassified.confirmedMemoryFacts).toHaveLength(1)
    expect(reclassified.confirmedMemoryFacts[0]?.sourcePart).toBe(2)

    const deleted = await service.deleteMemoryFact(
      result.session.id,
      result.session.confirmedMemoryFacts[0]!.id,
    )
    expect(deleted.confirmedMemoryFacts).toEqual([])
  })

  it('saves the full second answer but only submits a confirmed snippet to the personal corpus', async () => {
    const storage = new MemoryPersistence()
    const service = createService(storage)
    const session = await service.createSession('p1-hobbies')
    const withFirst = await service.saveTextAttempt(
      session.id,
      1,
      'I like reading books.',
      9_000,
    )
    const secondReady = await service.prepareSecondAttempt(withFirst.id)
    const withSecond = await service.saveTextAttempt(
      secondReady.id,
      2,
      'I like reading books because they help me relax.',
      15_500,
    )

    expect(withSecond.status).toBe('comparison-ready')
    expect(withSecond.attempts).toHaveLength(2)
    expect(withSecond.attempts[1]?.audio).toBeNull()

    const result = await service.submitSecondAnswerToCorpus(
      withSecond.id,
      'I like reading books because they help me relax after a long day.',
      'Hobbies',
    )

    expect(result.session.status).toBe('completed')
    expect(result.session.attempts[1]?.transcript.source).toBe('manual')
    expect(result.session.attempts[1]?.transcript.text).toBe(
      'I like reading books because they help me relax.',
    )
    expect(result.expression.text).toContain('after a long day')
    expect(result.expression.topic).toBe('Hobbies')
    expect(result.expression.sourceAttempt).toBe(2)
    expect(storage.expressions.size).toBe(1)
  })

  it('can complete a practice without forcing the answer into the personal corpus', async () => {
    const storage = new MemoryPersistence()
    const service = createService(storage)
    const session = await service.createSession('p1-hobbies')
    const withFirst = await service.saveTextAttempt(session.id, 1, 'I like reading.', null)
    const secondReady = await service.prepareSecondAttempt(withFirst.id)
    const withSecond = await service.saveTextAttempt(
      secondReady.id,
      2,
      'I like reading because it helps me relax.',
      null,
    )

    const completed = await service.completeSession(withSecond.id)

    expect(completed.status).toBe('completed')
    expect(storage.expressions.size).toBe(0)
    await expect(service.listQuestionPracticeStates()).resolves.toMatchObject([
      { questionId: 'p1-hobbies', isDone: true },
    ])
  })

  it('allows an account to manually override its own question state', async () => {
    const storage = new MemoryPersistence()
    const alice = createService(storage, () => 'alice')
    const bob = createService(storage, () => 'bob')

    await alice.setQuestionDone('p1-hobbies', true)
    await alice.setQuestionDone('p1-hobbies', false)
    await bob.setQuestionDone('p1-hobbies', true)

    await expect(alice.listQuestionPracticeStates()).resolves.toMatchObject([
      { ownerId: 'alice', questionId: 'p1-hobbies', isDone: false },
    ])
    await expect(bob.listQuestionPracticeStates()).resolves.toMatchObject([
      { ownerId: 'bob', questionId: 'p1-hobbies', isDone: true },
    ])
  })

  it('keeps expression CRUD local and marks reviews', async () => {
    const storage = new MemoryPersistence()
    const service = createService(storage)
    const session = await service.createSession('p1-hobbies')
    const withFirst = await service.saveTextAttempt(session.id, 1, 'I like reading.', null)
    const secondReady = await service.prepareSecondAttempt(withFirst.id)
    const withSecond = await service.saveTextAttempt(secondReady.id, 2, 'I like reading books.', null)
    const submitted = await service.submitSecondAnswerToCorpus(
      withSecond.id,
      'I like reading books.',
      'Hobbies',
    )

    const updated = await service.updateExpression(
      submitted.expression.id,
      { text: 'I really like reading books.', topic: 'Books', sourcePart: 1 },
    )
    expect(updated.text).toBe('I really like reading books.')

    const reviewed = await service.markExpressionReviewed(updated.id)
    expect(reviewed.reviewCount).toBe(1)

    await service.deleteExpression(updated.id)
    expect(storage.expressions.size).toBe(0)
  })

  it('lists sessions newest first', async () => {
    const storage = new MemoryPersistence()
    const service = createService(storage)
    const first = await service.createSession('p1-hobbies')
    await service.saveTextAttempt(first.id, 1, 'Answer one.', null)

    const second = await service.createSession('p1-hobbies')
    await service.saveTextAttempt(second.id, 1, 'Answer two.', null)

    const sessions = await service.listSessions()
    expect(new Set(sessions.map((item) => item.id))).toEqual(
      new Set([first.id, second.id]),
    )
    expect(sessions).toHaveLength(2)
  })

  it('isolates sessions and expressions between local accounts', async () => {
    const storage = new MemoryPersistence()
    const alice = '00000000-0000-4000-8000-00000000000a'
    const bob = '00000000-0000-4000-8000-00000000000b'
    let idCounter = 0
    const sharedCreateId = () => `id-${++idCounter}`
    const aliceService = createService(storage, () => alice, sharedCreateId)
    const bobService = createService(storage, () => bob, sharedCreateId)

    const aliceSession = await aliceService.createSession('p1-hobbies')
    await aliceService.saveTextAttempt(aliceSession.id, 1, 'Alice answer.', null)
    const bobSession = await bobService.createSession('p1-hobbies')

    expect((await aliceService.listSessions()).map((item) => item.id)).toEqual([
      aliceSession.id,
    ])
    expect((await bobService.listSessions()).map((item) => item.id)).toEqual([
      bobSession.id,
    ])
    await expect(
      bobService.saveTextAttempt(aliceSession.id, 1, 'Should fail.', null),
    ).rejects.toThrow('could not be found')

    const bobAttempt = await bobService.saveTextAttempt(
      bobSession.id,
      1,
      'Bob answer.',
      null,
    )
    await bobService.prepareSecondAttempt(bobAttempt.id)
    await bobService.saveTextAttempt(bobSession.id, 2, 'Bob second answer.', null)
    const submitted = await bobService.submitSecondAnswerToCorpus(
      bobSession.id,
      'Bob second answer.',
      'Hobbies',
    )
    expect(await aliceService.listExpressions()).toHaveLength(0)
    expect(await bobService.listExpressions()).toHaveLength(1)

    const reused = await bobService.markExpressionReused(submitted.expression.id)
    expect(reused.reuseCount).toBe(1)
    await expect(
      aliceService.updateExpression(
        submitted.expression.id,
        { text: 'Alice cannot edit this.', topic: 'Hobbies', sourcePart: 1 },
      ),
    ).rejects.toThrow('not found')
  })
})
