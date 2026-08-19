import {
  type AiFeedback,
  type PracticeTexts,
  type SavedExpression,
  type TrainingSession,
} from '../domain/models'
import type { LocalStorage } from '../ports/storage'
import { PracticeService } from './practiceService'

const NOW = new Date('2026-08-09T02:00:00.000Z')

interface MemoryBacking {
  sessions: Map<string, TrainingSession>
  expressions: Map<string, SavedExpression>
}

class MemoryPersistence implements LocalStorage {
  sessions: Map<string, TrainingSession>
  expressions: Map<string, SavedExpression>
  texts: PracticeTexts | null = null
  failNextSessionWrite: Error | null = null

  constructor(backing: MemoryBacking = { sessions: new Map(), expressions: new Map() }) {
    this.sessions = backing.sessions
    this.expressions = backing.expressions
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
  problems: ['过去时态混用。'],
  grammarSuggestions: ['先想好动词过去式。'],
  vocabularySuggestions: ['用 relaxing 代替 good。'],
  improvedAnswer: 'I like reading books because they help me relax.',
  referenceAnswers: [
    { label: '简单自然版', text: 'I like reading books because they help me relax.' },
    { label: '自然提升版', text: 'I enjoy reading books because they help me unwind.' },
    { label: '另一种表达版', text: 'Reading is my favourite way to relax after a busy day.' },
  ],
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
    expect(updated?.aiFeedback?.referenceAnswers).toHaveLength(3)

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

  it('saves the second answer and then submits it to the personal corpus', async () => {
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
    expect(result.session.attempts[1]?.transcript.source).toBe('edited')
    expect(result.session.attempts[1]?.transcript.text).toContain('after a long day')
    expect(result.expression.topic).toBe('Hobbies')
    expect(result.expression.sourceAttempt).toBe(2)
    expect(storage.expressions.size).toBe(1)
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
      { text: 'I really like reading books.', topic: 'Books' },
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
        { text: 'Alice cannot edit this.', topic: 'Hobbies' },
      ),
    ).rejects.toThrow('not found')
  })
})
