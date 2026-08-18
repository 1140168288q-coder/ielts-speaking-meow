import type {
  AiFeedback,
  PracticeTexts,
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
  texts: PracticeTexts | null = null

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

  deleteExpression(expressionId: string): Promise<void> {
    this.operations.push(`expression:delete:${expressionId}`)
    this.backing.expressions.delete(expressionId)
    return Promise.resolve()
  }

  getPracticeTexts(): Promise<PracticeTexts | null> {
    return Promise.resolve(this.texts)
  }

  savePracticeTexts(texts: PracticeTexts): Promise<void> {
    this.texts = texts
    return Promise.resolve()
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
  it('supports editing, review check-ins, and explicit deletion of saved expressions', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence, 'expression')
    const session = await service.createSession('p1-home-001')
    await service.saveAttempt(
      session.id,
      1,
      recording('first original recording'),
      { status: 'ready', text: 'I like reading at home.', source: 'stt' },
    )
    await service.saveAttempt(
      session.id,
      2,
      recording('second original recording'),
      { status: 'ready', text: 'It helps me relax.', source: 'stt' },
    )
    const saved = await service.submitSecondAnswerToCorpus(
      session.id,
      'It helps me relax.',
      'Home',
    )

    expect(saved.expression).toMatchObject({
      reviewCount: 0,
      lastReviewedAt: null,
      updatedAt: NOW.toISOString(),
      text: 'It helps me relax.',
      topic: 'Home',
      sourceAttempt: 2,
    })

    const edited = await service.updateExpression(saved.expression.id, {
      text: 'It helps me unwind after a busy day.',
      topic: 'Home life',
    })
    expect(edited).toMatchObject({
      text: 'It helps me unwind after a busy day.',
      topic: 'Home life',
    })

    const reviewed = await service.markExpressionReviewed(saved.expression.id)
    expect(reviewed.reviewCount).toBe(1)
    expect(reviewed.lastReviewedAt).toBe(NOW.toISOString())

    await service.deleteExpression(saved.expression.id)
    expect(await service.listExpressions()).toEqual([])
    await expect(service.deleteExpression(saved.expression.id)).rejects.toThrow(
      'Saved expression not found.',
    )
  })

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

    const completed = await service.submitSecondAnswerToCorpus(
      session.id,
      'It helps me unwind after a busy day.',
      'Home',
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

  it('stores AI comparison only while both attempt transcripts still match', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence, 'ai-comparison')
    const created = await service.createSession('p1-home-001')
    await service.saveAttempt(
      created.id,
      1,
      recording('first comparison audio'),
      { status: 'ready', text: 'Um I like reading.', source: 'stt' },
    )
    const twoAttempts = await service.saveAttempt(
      created.id,
      2,
      recording('second comparison audio'),
      { status: 'ready', text: 'I like reading because it helps me relax.', source: 'stt' },
    )
    const first = twoAttempts.attempts.find((item) => item.attemptNumber === 1)!
    const second = twoAttempts.attempts.find((item) => item.attemptNumber === 2)!
    const feedback: AiFeedback = {
      keyIssues: [
        {
          category: 'fluency',
          kind: 'improvement',
          title: 'Clearer opening',
          observation: 'The second answer starts directly.',
          action: 'Keep the direct opening.',
          evidence: 'I like reading',
        },
      ],
      secondAttemptTips: ['Keep the direct opening.'],
      revisions: {
        minimalFix: 'I like reading because it helps me relax.',
        naturalVersion: null,
        stretchVersion: null,
      },
    }
    const snapshot = {
      first: {
        attemptId: first.id,
        text: first.transcript.text,
        updatedAt: first.transcript.updatedAt,
      },
      second: {
        attemptId: second.id,
        text: second.transcript.text,
        updatedAt: second.transcript.updatedAt,
      },
    }

    const enriched = await service.applyAiComparisonIfTranscriptsCurrent(
      created.id,
      snapshot,
      feedback,
    )
    expect(enriched?.aiComparison).toEqual(feedback)

    const edited = await service.updateTranscript(
      created.id,
      2,
      'I like reading at home because it helps me relax.',
    )
    expect(edited.aiComparison).toBeNull()
    await expect(
      service.applyAiComparisonIfTranscriptsCurrent(created.id, snapshot, feedback),
    ).resolves.toBeNull()
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

describe('PracticeService version selection and read-aloud flow', () => {
  const versionFeedback: AiFeedback = {
    summary: { problem: '填充词较多。', suggestion: '用停顿代替填充词。' },
    versions: [
      {
        style: '基础稳妥',
        text: 'I like reading at home because it helps me relax.',
        hint: 'opening: I like ... because ...',
      },
      {
        style: '自然均衡',
        text: 'In my free time I enjoy reading since it helps me unwind.',
        hint: 'opening: In my free time ...',
      },
      {
        style: '略加挑战',
        text: 'Reading is my favourite way to relax and broaden my view.',
        hint: '... is my favourite way to ...',
      },
    ],
  }

  const sessionWithFirstAttempt = async (
    service: PracticeService,
    text = 'I like reading at home.',
  ) => {
    const session = await service.createSession('p1-home-001')
    await service.saveAttempt(
      session.id,
      1,
      recording('first original recording'),
      { status: 'ready', text, source: 'stt' },
    )
    return service.applyAiFeedback(session.id, versionFeedback)
  }

  it('selects a version and rejects an out-of-range index', async () => {
    const service = createService(new MemoryPersistence(), 'version')
    const enriched = await sessionWithFirstAttempt(service)

    const selected = await service.selectVersion(enriched.id, 1)
    expect(selected.selectedVersionIndex).toBe(1)

    await expect(service.selectVersion(enriched.id, 5)).rejects.toThrow(
      '所选回答版本不存在',
    )
  })

  it('saves a read-aloud and computes pronunciation issues from the transcript', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence, 'read-aloud')
    const enriched = await sessionWithFirstAttempt(service)
    const selected = await service.selectVersion(enriched.id, 0)

    const saved = await service.saveReadAloud(
      selected.id,
      recording('read-aloud original recording'),
      {
        status: 'ready',
        text: 'I like read at home.',
        source: 'stt',
      },
    )

    expect(saved.readAloud?.targetVersionIndex).toBe(0)
    expect(saved.readAloud?.transcript).toMatchObject({
      status: 'ready',
      text: 'I like read at home.',
      source: 'stt',
    })
    const issueWords = saved.readAloud?.issues.map((issue) => issue.word) ?? []
    expect(issueWords).toContain('reading')
    expect(
      saved.readAloud?.issues.find((issue) => issue.word === 'reading')
        ?.heardAs,
    ).toBe('read')
    expect(await persistence.hasAudio(saved.readAloud?.audio.id ?? '')).toBe(
      true,
    )
    expect(persistence.deletedAudioIds).toEqual([])
  })

  it('re-diffs issues when a remote transcript arrives after the recording', async () => {
    const service = createService(new MemoryPersistence(), 'read-aloud-remote')
    const enriched = await sessionWithFirstAttempt(service)
    const selected = await service.selectVersion(enriched.id, 0)

    const pending = await service.saveReadAloud(
      selected.id,
      recording('read-aloud before remote STT'),
      { status: 'pending', text: '', source: null },
    )
    expect(pending.readAloud?.issues).toEqual([])

    const transcribed = await service.applyReadAloudTranscript(
      selected.id,
      'I like reading at home because it helps me relax.',
    )
    expect(transcribed.readAloud?.transcript.status).toBe('ready')
    expect(transcribed.readAloud?.issues).toEqual([])
  })

  it('keeps the read-aloud audio when transcription fails', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence, 'read-aloud-failed')
    const enriched = await sessionWithFirstAttempt(service)
    const selected = await service.selectVersion(enriched.id, 2)
    const saved = await service.saveReadAloud(
      selected.id,
      recording('read-aloud kept after STT failure'),
      { status: 'pending', text: '', source: null },
    )

    const failed = await service.markReadAloudTranscriptionFailed(
      selected.id,
      'remote-stt-failed',
    )
    expect(failed.readAloud?.transcript.status).toBe('failed')
    expect(failed.readAloud?.issues).toEqual([])
    expect(await persistence.hasAudio(saved.readAloud?.audio.id ?? '')).toBe(
      true,
    )
    expect(persistence.deletedAudioIds).toEqual([])
  })

  it('clears the chosen version and read-aloud when the first transcript changes', async () => {
    const service = createService(new MemoryPersistence(), 'reset-on-edit')
    const enriched = await sessionWithFirstAttempt(service)
    const selected = await service.selectVersion(enriched.id, 0)
    const withReadAloud = await service.saveReadAloud(
      selected.id,
      recording('read-aloud before transcript edit'),
      { status: 'ready', text: 'I like reading at home.', source: 'stt' },
    )

    const edited = await service.updateTranscript(
      withReadAloud.id,
      1,
      'I like reading at home because it helps me relax.',
    )
    expect(edited.aiFeedback).toBeNull()
    expect(edited.selectedVersionIndex).toBeNull()
    expect(edited.readAloud).toBeNull()
  })
})

describe('PracticeService second answer corpus submission', () => {
  it('updates the second transcript, saves the corpus entry and completes the session', async () => {
    const persistence = new MemoryPersistence()
    const service = createService(persistence, 'corpus')
    const session = await service.createSession('p1-home-001')
    await service.saveAttempt(
      session.id,
      1,
      recording('first original recording'),
      { status: 'ready', text: 'I like reading.', source: 'stt' },
    )
    const withSecond = await service.saveAttempt(
      session.id,
      2,
      recording('second original recording'),
      { status: 'ready', text: 'I like reading because it help me relax.', source: 'stt' },
    )
    const audioId = withSecond.attempts.find((item) => item.attemptNumber === 2)
      ?.audio.id

    const result = await service.submitSecondAnswerToCorpus(
      session.id,
      'I like reading because it helps me relax.',
      'Home',
    )

    expect(result.session.status).toBe('completed')
    expect(
      result.session.attempts.find((item) => item.attemptNumber === 2)
        ?.transcript.text,
    ).toBe('I like reading because it helps me relax.')
    expect(result.expression).toMatchObject({
      text: 'I like reading because it helps me relax.',
      topic: 'Home',
      sourceAttempt: 2,
    })
    expect(await service.listExpressions()).toEqual([result.expression])
    expect(await persistence.hasAudio(audioId ?? '')).toBe(true)
    expect(persistence.deletedAudioIds).toEqual([])
  })

  it('rejects an empty corpus submission without touching the session', async () => {
    const service = createService(new MemoryPersistence(), 'corpus-empty')
    const session = await service.createSession('p1-home-001')
    await service.saveAttempt(
      session.id,
      1,
      recording('first original recording'),
      { status: 'ready', text: 'I like reading.', source: 'stt' },
    )
    await service.saveAttempt(
      session.id,
      2,
      recording('second original recording'),
      { status: 'ready', text: 'Reading is my hobby.', source: 'stt' },
    )

    await expect(
      service.submitSecondAnswerToCorpus(session.id, '   ', 'Home'),
    ).rejects.toThrow('请先填写第二次回答的文本。')
    expect(await service.listExpressions()).toEqual([])
    expect((await service.getSession(session.id))?.status).toBe(
      'comparison-ready',
    )
  })
})
