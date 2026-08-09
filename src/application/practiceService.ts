import {
  type PracticeAttempt,
  type SavedExpression,
  type TrainingSession,
  savedExpressionSchema,
  trainingSessionSchema,
} from '../domain/models'
import {
  compareAttempts,
  createLocalFeedback,
} from '../domain/comparison'
import { analyzeSpeech } from '../domain/speechAnalysis'
import type { AudioRecording } from '../ports/speech'
import type { AudioStorage, LocalStorage } from '../ports/storage'

export interface PracticeServiceDependencies {
  localStorage: LocalStorage
  audioStorage: AudioStorage
  now?: () => Date
  createId?: () => string
}

export interface InitialTranscript {
  text: string
  status: 'ready' | 'failed'
  source: 'stt' | 'manual' | null
  errorCode?: string | null
}

const defaultCreateId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Coordinates durable practice writes. Original audio is always committed
 * before attempt metadata and is never deleted when a later operation fails.
 */
export class PracticeService {
  private readonly localStorage: LocalStorage
  private readonly audioStorage: AudioStorage
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(dependencies: PracticeServiceDependencies) {
    this.localStorage = dependencies.localStorage
    this.audioStorage = dependencies.audioStorage
    this.now = dependencies.now ?? (() => new Date())
    this.createId = dependencies.createId ?? defaultCreateId
  }

  async createSession(questionId: string): Promise<TrainingSession> {
    const timestamp = this.now().toISOString()
    const session = trainingSessionSchema.parse({
      id: this.createId(),
      questionId,
      status: 'first-ready',
      attempts: [],
      localFeedback: [],
      aiFeedback: null,
      comparison: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    await this.localStorage.upsertSession(session)
    return session
  }

  async saveAttempt(
    sessionId: string,
    attemptNumber: 1 | 2,
    recording: AudioRecording,
    transcriptInput: InitialTranscript,
  ): Promise<TrainingSession> {
    if (recording.blob.size === 0) {
      throw new Error('The recording is empty and was not saved.')
    }

    const session = await this.requireSession(sessionId)
    const timestamp = this.now().toISOString()
    const audioId = this.createId()
    const attemptId = this.createId()
    const durationMs = Math.max(1, recording.durationMs)

    // Critical durability order: audio first, session metadata second.
    await this.audioStorage.saveAudio(audioId, recording.blob)

    const transcriptText = transcriptInput.text.trim()
    const attempt: PracticeAttempt = {
      id: attemptId,
      attemptNumber,
      audio: {
        id: audioId,
        relativePath: `indexeddb://audio/${audioId}`,
        mimeType: recording.mimeType,
        durationMs,
        createdAt: timestamp,
      },
      transcript: {
        status: transcriptInput.status,
        text: transcriptText,
        originalText: transcriptInput.source === 'stt' ? transcriptText : null,
        source: transcriptInput.source,
        errorCode: transcriptInput.errorCode ?? null,
        updatedAt: timestamp,
      },
      metrics: analyzeSpeech({ transcript: transcriptText, durationMs }),
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const attempts = [
      ...session.attempts.filter(
        (existing) => existing.attemptNumber !== attemptNumber,
      ),
      attempt,
    ].sort((a, b) => a.attemptNumber - b.attemptNumber)

    const firstAttempt = attempts.find((item) => item.attemptNumber === 1)
    const secondAttempt = attempts.find((item) => item.attemptNumber === 2)
    const updated = trainingSessionSchema.parse({
      ...session,
      attempts,
      status: attemptNumber === 1 ? 'first-review' : 'comparison-ready',
      localFeedback: firstAttempt
        ? createLocalFeedback(firstAttempt.metrics)
        : session.localFeedback,
      comparison:
        firstAttempt && secondAttempt
          ? compareAttempts(firstAttempt.metrics, secondAttempt.metrics)
          : null,
      updatedAt: timestamp,
    })

    await this.localStorage.upsertSession(updated)
    return updated
  }

  async updateTranscript(
    sessionId: string,
    attemptNumber: 1 | 2,
    text: string,
  ): Promise<TrainingSession> {
    const session = await this.requireSession(sessionId)
    const timestamp = this.now().toISOString()
    const existing = session.attempts.find(
      (attempt) => attempt.attemptNumber === attemptNumber,
    )
    if (!existing) {
      throw new Error(`Attempt ${attemptNumber} does not exist.`)
    }

    const cleanText = text.trim()
    const updatedAttempt: PracticeAttempt = {
      ...existing,
      transcript: {
        ...existing.transcript,
        status: 'ready',
        text: cleanText,
        source: existing.transcript.originalText ? 'edited' : 'manual',
        errorCode: null,
        updatedAt: timestamp,
      },
      metrics: analyzeSpeech({
        transcript: cleanText,
        durationMs: existing.audio.durationMs,
      }),
      updatedAt: timestamp,
    }
    const attempts = session.attempts.map((attempt) =>
      attempt.attemptNumber === attemptNumber ? updatedAttempt : attempt,
    )
    const firstAttempt = attempts.find((attempt) => attempt.attemptNumber === 1)
    const secondAttempt = attempts.find((attempt) => attempt.attemptNumber === 2)
    const updated = trainingSessionSchema.parse({
      ...session,
      attempts,
      localFeedback: firstAttempt
        ? createLocalFeedback(firstAttempt.metrics)
        : session.localFeedback,
      comparison:
        firstAttempt && secondAttempt
          ? compareAttempts(firstAttempt.metrics, secondAttempt.metrics)
          : null,
      updatedAt: timestamp,
    })

    await this.localStorage.upsertSession(updated)
    return updated
  }

  async prepareSecondAttempt(sessionId: string): Promise<TrainingSession> {
    const session = await this.requireSession(sessionId)
    if (!session.attempts.some((attempt) => attempt.attemptNumber === 1)) {
      throw new Error('The first recording must be saved before attempt two.')
    }

    const updated = trainingSessionSchema.parse({
      ...session,
      status: 'second-ready',
      updatedAt: this.now().toISOString(),
    })
    await this.localStorage.upsertSession(updated)
    return updated
  }

  async saveExpression(
    sessionId: string,
    text: string,
    topic: string,
    sourceAttempt: 1 | 2 | null = 2,
  ): Promise<{ session: TrainingSession; expression: SavedExpression }> {
    const session = await this.requireSession(sessionId)
    const timestamp = this.now().toISOString()
    const expression = savedExpressionSchema.parse({
      id: this.createId(),
      text,
      topic,
      questionId: session.questionId,
      sessionId,
      sourceAttempt,
      createdAt: timestamp,
    })

    await this.localStorage.upsertExpression(expression)
    const updated = trainingSessionSchema.parse({
      ...session,
      status: 'completed',
      updatedAt: timestamp,
    })
    await this.localStorage.upsertSession(updated)
    return { session: updated, expression }
  }

  async listSessions(): Promise<TrainingSession[]> {
    const sessions = await this.localStorage.listSessions()
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listExpressions(): Promise<SavedExpression[]> {
    const expressions = await this.localStorage.listExpressions()
    return expressions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  getAudio(audioId: string): Promise<Blob | null> {
    return this.audioStorage.getAudio(audioId)
  }

  private async requireSession(sessionId: string): Promise<TrainingSession> {
    const session = await this.localStorage.getSession(sessionId)
    if (!session) {
      throw new Error('The practice session could not be found.')
    }
    return session
  }
}
