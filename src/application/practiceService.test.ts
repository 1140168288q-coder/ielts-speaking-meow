import type {
  AiFeedback,
  SavedExpression,
  TrainingSession,
} from '../domain/models'
import type { AudioRecording } from '../ports/speech'
import type { AudioStorage, LocalStorage } from '../ports/storage'
import { PracticeService } from './practiceService'

const NOW = new Date('2026-08-09T02:00:00.000Z')

interface MemoryBacking {
  sessions: Map<string, TrainingSession>
  expressions: Map<string, SavedExpression>
  audio: Map<string, Blob>
}

const createBacking = (): MemoryBacking => ({
  sessions: new Map(),
  expressions: new Map(),
  audio: new Map(),
})

class MemoryPersistence implements LocalStorage, AudioStorage {
  readonly operations: string[] = []
  readonly deletedAudioIds: string[] = []
  failNextSessionWrite: Error | null = null
  failNextAudioWrite: Error | null = null

  constructor(private readonly backing: MemoryBacking = createBacking()) {}

  upsertSession(session: TrainingSession): Promise<void> {
    this.operations.push(`session:put:${session.id}`)

    if (this.failNextSessionWrite) {
      const error = this.failNextSessionWrite
      this.failNextSessionWrite = null
      return Promise.reject(error)
    }

    this.backing.sessions.set(session.id, structuredClone(session))
    return Promise.resolve()
  }

  getSession(sessionId: string): Promise<TrainingSession | null> {
    this.operations.push(`session:get:${sessionId}`)
    const session = this.backing.sessions.get(sessionId)
    return Promise.resolve(session ? structuredClone(session) : null)
  }

  listSessions(): Promise<TrainingSession[]> {
    this.operations.push('session:list')
    return Promise.resolve(
      [...this.backing.sessions.values()].map((session) =>
        structuredClone(session),
      ),
    )
  }

  upsertExpression(expression: SavedExpression): Promise<void> {
    this.operations.push(`expression:put:${expression.id}`)
    this.backing.expressions.set(expression.id, structuredClone(expression))
    return Promise.resolve()
  }

  getExpression(expressionId: string): Promise<SavedExpression | null> {
    this.operations.push(`expression:get:${expressionId}`)
    const expression = this.backing.expressions.get(expressionId)
    return Promise.resolve(expression ? structuredClone(expression) : null)
  }

  listExpressions(): Promise<SavedExpression[]> {
    this.operations.push('expression:list')
    return Promise.resolve(
      [...this.backing.expressions.values()].map((expression) =>
        structuredClone(expression),
      ),
    )
  }

  saveAudio(audioId: string, audio: Blob): Promise<void> {
    this.operations.push(`audio:put:${audioId}`)

    if (this.failNextAudioWrite) {
      const error = this.failNextAudioWrite
      this.failNextAudioWrite = null
      return Promise.reject(error)
    }

    this.backing.audio.set(audioId, audio)
    return Promise.resolve()
  }

  getAudio(audioId: string): Promise<Blob | null> {
    this.operations.push(`audio:get:${audioId}`)
    return Promise.resolve(this.backing.audio.get(audioId) ?? null)
  }

  hasAudio(audioId: string): Promise<boolean> {
    this.operations.push(`audio:has:${audioId}`)
    return Promise.resolve(this.backing.audio.has(audioId))
  }

  deleteAudio(audioId: string): Promise<void> {
    this.operations.push(`audio:delete:${audioId}`)
    this.deletedAudioIds.push(audioId)
    this.backing.audio.delete(audioId)
    return Promise.resolve()
  }
}

const recording = (
  marker: string,
  durationMs = 30_000,
): AudioRecording => ({
  blob: new Blob([marker], { type: 'audio/webm' }),
  mimeType: 'audio/webm',
  durationMs,
  startedAt: 1_000,
  endedAt: 1_000 + durationMs,
})

const createService = (
  persistence: MemoryPersistence,
  idPrefix = 'entity',
): PracticeService => {
  let sequence = 0

  return new PracticeService({
    localStorage: persistence,
    audioStorage: persistence,
    now: () => NOW,
    createId: () => `${idPrefix}-${++sequence}`,
  })
}

describe('PracticeService durability and offline flow', () => {
  it('commits original audio before writing attempt metadata', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence)
    const session = await service.createSession('p1-home-001')
    persistence.operations.length = 0

    const saved = await service.saveAttempt(
      session.id,
      1,
      recording('first original recording'),
      { status: 'ready', text: 'I enjoy reading at home.', source: 'stt' },
    )

    const writeOperations = persistence.operations.filter(
      (operation) => operation.includes(':put:'),
    )
    expect(writeOperations).toEqual([
      `audio:put:${saved.attempts[0]?.audio.id}`,
      `session:put:${session.id}`,
    ])
    expect(
      await persistence.hasAudio(saved.attempts[0]?.audio.id ?? ''),
    ).toBe(true)
  })

  it('keeps audio when STT fails because of a network error', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence)
    const session = await service.createSession('p1-home-001')

    const saved = await service.saveAttempt(
      session.id,
      1,
      recording('recording without transcript'),
      {
        status: 'failed',
        text: '',
        source: null,
        errorCode: 'network',
      },
    )
    const attempt = saved.attempts[0]

    expect(attempt?.transcript).toMatchObject({
      status: 'failed',
      text: '',
      source: null,
      errorCode: 'network',
    })
    expect(await persistence.hasAudio(attempt?.audio.id ?? '')).toBe(true)
    expect(persistence.deletedAudioIds).toEqual([])
  })

  it('keeps committed audio when the following metadata write fails', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence)
    const session = await service.createSession('p1-home-001')
    persistence.failNextSessionWrite = new Error(
      'Simulated metadata persistence failure.',
    )

    await expect(
      service.saveAttempt(
        session.id,
        1,
        recording('durable original recording'),
        { status: 'ready', text: 'I enjoy reading.', source: 'stt' },
      ),
    ).rejects.toThrow('Simulated metadata persistence failure.')

    const savedAudioId = [...persistence.operations]
      .find((operation) => operation.startsWith('audio:put:'))
      ?.replace('audio:put:', '')

    expect(savedAudioId).toBeDefined()
    expect(await persistence.hasAudio(savedAudioId ?? '')).toBe(true)
    expect(persistence.deletedAudioIds).toEqual([])
    expect((await persistence.getSession(session.id))?.attempts).toEqual([])
  })

  it('does not write metadata or delete audio when the audio save itself fails', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence)
    const session = await service.createSession('p1-home-001')
    persistence.operations.length = 0
    persistence.failNextAudioWrite = new Error('Simulated audio write failure.')

    await expect(
      service.saveAttempt(
        session.id,
        1,
        recording('unsaved recording'),
        { status: 'ready', text: 'I enjoy reading.', source: 'manual' },
      ),
    ).rejects.toThrow('Simulated audio write failure.')

    expect(
      persistence.operations.some((operation) =>
        operation.startsWith('session:put:'),
      ),
    ).toBe(false)
    expect(persistence.deletedAudioIds).toEqual([])
  })

  it('turns a failed transcript into manual text and recalculates metrics', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence)
    const session = await service.createSession('p1-home-001')
    const saved = await service.saveAttempt(
      session.id,
      1,
      recording('first original recording', 60_000),
      { status: 'failed', text: '', source: null, errorCode: 'no-speech' },
    )
    const audioId = saved.attempts[0]?.audio.id

    const corrected = await service.updateTranscript(
      session.id,
      1,
      '  Um I I enjoy reading at home.  ',
    )
    const attempt = corrected.attempts[0]

    expect(attempt?.audio.id).toBe(audioId)
    expect(attempt?.transcript).toMatchObject({
      status: 'ready',
      text: 'Um I I enjoy reading at home.',
      originalText: null,
      source: 'manual',
      errorCode: null,
    })
    expect(attempt?.metrics).toMatchObject({
      wordCount: 7,
      wordsPerMinute: 7,
      fillerCount: 1,
      repeatedWordCount: 1,
    })
    expect(corrected.localFeedback.map((item) => item.category)).toContain(
      'fluency',
    )
    expect(await persistence.hasAudio(audioId ?? '')).toBe(true)
    expect(persistence.deletedAudioIds).toEqual([])
  })

  it('completes two attempts without Text AI and restores the result in a new service', async () => {
    const backing = createBacking()
    const firstPersistence = new MemoryPersistence(backing)
    const service = createService(firstPersistence, 'first-run')
    const session = await service.createSession('p1-home-001')

    const afterFirst = await service.saveAttempt(
      session.id,
      1,
      recording('first original recording'),
      {
        status: 'ready',
        text: 'Um I I enjoy reading at home.',
        source: 'stt',
      },
    )
    expect(afterFirst.localFeedback.length).toBeGreaterThan(0)

    const readyForSecond = await service.prepareSecondAttempt(session.id)
    expect(readyForSecond.status).toBe('second-ready')

    const afterSecond = await service.saveAttempt(
      session.id,
      2,
      recording('second improved recording'),
      {
        status: 'ready',
        text: 'I enjoy reading at home because it helps me relax.',
        source: 'manual',
      },
    )

    expect(afterSecond.status).toBe('comparison-ready')
    expect(afterSecond.attempts.map((attempt) => attempt.attemptNumber)).toEqual([
      1, 2,
    ])
    expect(afterSecond.comparison).not.toBeNull()
    expect(afterSecond.comparison?.fillerCount).toMatchObject({
      first: 1,
      second: 0,
      delta: -1,
    })
    expect(afterSecond.comparison?.repeatedWordCount?.delta).toBe(-1)

    const completed = await service.saveExpression(
      session.id,
      'It helps me unwind after a busy day.',
      'Home',
      2,
    )
    expect(completed.session.status).toBe('completed')

    const reopenedPersistence = new MemoryPersistence(backing)
    const reopenedService = createService(reopenedPersistence, 'second-run')
    const restoredSessions = await reopenedService.listSessions()
    const restoredExpressions = await reopenedService.listExpressions()

    expect(restoredSessions).toHaveLength(1)
    expect(restoredSessions[0]).toEqual(completed.session)
    expect(restoredExpressions).toEqual([completed.expression])
    expect(restoredSessions[0]?.aiFeedback).toBeNull()

    for (const attempt of restoredSessions[0]?.attempts ?? []) {
      expect(await reopenedService.getAudio(attempt.audio.id)).not.toBeNull()
    }
    expect(reopenedPersistence.deletedAudioIds).toEqual([])
  })
})

describe('PracticeService deferred STT and AI enrichment', () => {
  it('moves a saved pending attempt to STT-ready without replacing its audio', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence, 'pending-success')
    const session = await service.createSession('p1-home-001')
    const pending = await service.saveAttempt(
      session.id,
      1,
      recording('original audio before remote STT', 60_000),
      { status: 'pending', text: '', source: null },
    )
    const originalAudioId = pending.attempts[0]?.audio.id

    const completed = await service.applySttTranscript(
      session.id,
      1,
      'Um I I enjoy reading at home.',
    )
    const attempt = completed.attempts[0]

    expect(attempt?.audio.id).toBe(originalAudioId)
    expect(attempt?.transcript).toMatchObject({
      status: 'ready',
      text: 'Um I I enjoy reading at home.',
      originalText: 'Um I I enjoy reading at home.',
      source: 'stt',
      errorCode: null,
    })
    expect(attempt?.metrics).toMatchObject({
      wordCount: 7,
      wordsPerMinute: 7,
      fillerCount: 1,
      repeatedWordCount: 1,
    })
    expect(await persistence.hasAudio(originalAudioId ?? '')).toBe(true)
    expect(await (await service.getAudio(originalAudioId ?? ''))?.text()).toBe(
      'original audio before remote STT',
    )
    expect(persistence.deletedAudioIds).toEqual([])
  })

  it('marks pending STT as failed while retaining the original recording and manual path', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence, 'pending-failure')
    const session = await service.createSession('p1-home-001')
    const pending = await service.saveAttempt(
      session.id,
      1,
      recording('irreplaceable audio after STT failure'),
      { status: 'pending', text: '', source: null },
    )
    const originalAudioId = pending.attempts[0]?.audio.id

    const failed = await service.markTranscriptionFailed(
      session.id,
      1,
      'network',
    )

    expect(failed.attempts[0]?.transcript).toMatchObject({
      status: 'failed',
      text: '',
      originalText: null,
      source: null,
      errorCode: 'network',
    })
    expect(failed.attempts[0]?.audio.id).toBe(originalAudioId)
    expect(await persistence.hasAudio(originalAudioId ?? '')).toBe(true)
    expect(await (await service.getAudio(originalAudioId ?? ''))?.text()).toBe(
      'irreplaceable audio after STT failure',
    )
    expect(failed.localFeedback[0]?.title).toBe(
      'Add or correct the transcript',
    )
    expect(persistence.deletedAudioIds).toEqual([])
  })

  it('adds validated AI feedback without replacing local feedback or audio', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence, 'ai-enrichment')
    const session = await service.createSession('p1-home-001')
    const firstReview = await service.saveAttempt(
      session.id,
      1,
      recording('audio retained across AI feedback'),
      {
        status: 'ready',
        text: 'Um I I enjoy reading at home.',
        source: 'stt',
      },
    )
    const localFeedback = structuredClone(firstReview.localFeedback)
    const audioId = firstReview.attempts[0]?.audio.id
    const aiFeedback: AiFeedback = {
      keyIssues: [
        {
          category: 'fluency',
          kind: 'focus',
          title: 'Pause before the main idea',
          observation: 'The answer opens with a filler.',
          action: 'Replace the filler with a short silent pause.',
          evidence: 'um',
        },
      ],
      secondAttemptTips: ['Start directly with the main idea.'],
      revisions: {
        minimalFix: 'I enjoy reading at home.',
        naturalVersion: null,
        stretchVersion: null,
      },
    }

    const enriched = await service.applyAiFeedback(session.id, aiFeedback)

    expect(enriched.status).toBe('feedback-ready')
    expect(enriched.aiFeedback).toEqual(aiFeedback)
    expect(enriched.localFeedback).toEqual(localFeedback)
    expect(enriched.attempts[0]?.audio.id).toBe(audioId)
    expect(await persistence.hasAudio(audioId ?? '')).toBe(true)
    expect(persistence.deletedAudioIds).toEqual([])
  })

  it('discards AI feedback generated for a transcript that has since changed', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence, 'stale-ai')
    const session = await service.createSession('p1-home-001')
    const firstReview = await service.saveAttempt(
      session.id,
      1,
      recording('audio retained when stale AI is discarded'),
      {
        status: 'ready',
        text: 'Um I enjoy reading at home.',
        source: 'stt',
      },
    )
    const originalAttempt = firstReview.attempts[0]!
    const corrected = await service.updateTranscript(
      session.id,
      1,
      'I enjoy reading at home because it helps me relax.',
    )
    const feedback: AiFeedback = {
      keyIssues: [
        {
          category: 'fluency',
          kind: 'focus',
          title: 'Remove the opening filler',
          observation: 'The old transcript started with a filler.',
          action: 'Start directly with the main idea.',
          evidence: 'Um',
        },
      ],
      secondAttemptTips: ['Start directly.'],
      revisions: {
        minimalFix: null,
        naturalVersion: null,
        stretchVersion: null,
      },
    }

    const result = await service.applyAiFeedbackIfTranscriptCurrent(
      session.id,
      {
        attemptId: originalAttempt.id,
        text: originalAttempt.transcript.text,
        updatedAt: originalAttempt.transcript.updatedAt,
      },
      feedback,
    )

    expect(result).toBeNull()
    expect(await service.getSession(session.id)).toEqual(corrected)
    expect((await service.getSession(session.id))?.aiFeedback).toBeNull()
  })

  it('rejects invalid AI feedback without changing persisted local results', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence, 'invalid-ai')
    const session = await service.createSession('p1-home-001')
    const firstReview = await service.saveAttempt(
      session.id,
      1,
      recording('audio retained after invalid AI response'),
      {
        status: 'ready',
        text: 'Um I I enjoy reading at home.',
        source: 'stt',
      },
    )
    const invalidFeedback = {
      keyIssues: 'not a structured feedback list',
      secondAttemptTips: [],
      revisions: {
        minimalFix: null,
        naturalVersion: null,
        stretchVersion: null,
      },
    } as unknown as AiFeedback

    await expect(
      service.applyAiFeedback(session.id, invalidFeedback),
    ).rejects.toThrow()

    const restored = await service.getSession(session.id)
    expect(restored).toEqual(firstReview)
    expect(restored?.aiFeedback).toBeNull()
    expect(restored?.localFeedback).toEqual(firstReview.localFeedback)
    const audioId = restored?.attempts[0]?.audio.id
    expect(await persistence.hasAudio(audioId ?? '')).toBe(true)
    expect(persistence.deletedAudioIds).toEqual([])
  })
})
