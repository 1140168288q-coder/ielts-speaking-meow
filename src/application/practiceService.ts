import {
  aiFeedbackSchema,
  type AiFeedback,
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
import type { AudioRecording, RecordedAudioAnalyzer } from '../ports/speech'
import type { AudioStorage, LocalStorage } from '../ports/storage'

export interface PracticeServiceDependencies {
  localStorage: LocalStorage
  audioStorage: AudioStorage
  audioAnalyzer?: RecordedAudioAnalyzer
  now?: () => Date
  createId?: () => string
}

export interface InitialTranscript {
  text: string
  status: 'pending' | 'ready' | 'failed'
  source: 'stt' | 'manual' | null
  errorCode?: string | null
}

export interface FirstTranscriptSnapshot {
  attemptId: string
  text: string
  updatedAt: string
}

export interface ComparisonTranscriptSnapshot {
  first: FirstTranscriptSnapshot
  second: FirstTranscriptSnapshot
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
  private readonly audioAnalyzer: RecordedAudioAnalyzer | null
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(dependencies: PracticeServiceDependencies) {
    this.localStorage = dependencies.localStorage
    this.audioStorage = dependencies.audioStorage
    this.audioAnalyzer = dependencies.audioAnalyzer ?? null
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
      aiComparison: null,
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
    const acoustic = await this.analyzeAudio(recording.blob)

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
      metrics: analyzeSpeech({ transcript: transcriptText, durationMs, acoustic }),
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
      aiComparison: null,
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
        acoustic: existing.metrics.acoustic ?? null,
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
      aiFeedback:
        attemptNumber === 1 ? null : session.aiFeedback,
      aiComparison: null,
      updatedAt: timestamp,
    })

    await this.localStorage.upsertSession(updated)
    return updated
  }

  async applySttTranscript(
    sessionId: string,
    attemptNumber: 1 | 2,
    text: string,
  ): Promise<TrainingSession> {
    return this.replaceTranscript(sessionId, attemptNumber, {
      status: 'ready',
      text,
      source: 'stt',
      originalText: text,
      errorCode: null,
    })
  }

  async markTranscriptionFailed(
    sessionId: string,
    attemptNumber: 1 | 2,
    errorCode = 'provider-failed',
  ): Promise<TrainingSession> {
    const session = await this.requireSession(sessionId)
    const existing = session.attempts.find(
      (attempt) => attempt.attemptNumber === attemptNumber,
    )
    if (!existing) {
      throw new Error(`Attempt ${attemptNumber} does not exist.`)
    }

    return this.replaceTranscript(sessionId, attemptNumber, {
      status: 'failed',
      text: existing.transcript.text,
      source: existing.transcript.source,
      originalText: existing.transcript.originalText,
      errorCode,
    })
  }

  async applyAiFeedback(
    sessionId: string,
    feedback: AiFeedback,
  ): Promise<TrainingSession> {
    const session = await this.requireSession(sessionId)
    return this.persistAiFeedback(session, feedback)
  }

  async applyAiFeedbackIfTranscriptCurrent(
    sessionId: string,
    snapshot: FirstTranscriptSnapshot,
    feedback: AiFeedback,
  ): Promise<TrainingSession | null> {
    const parsedFeedback = aiFeedbackSchema.parse(feedback)
    const session = await this.requireSession(sessionId)
    const firstAttempt = session.attempts.find(
      (attempt) => attempt.attemptNumber === 1,
    )

    if (
      firstAttempt?.id !== snapshot.attemptId ||
      firstAttempt.transcript.status !== 'ready' ||
      firstAttempt.transcript.text !== snapshot.text ||
      firstAttempt.transcript.updatedAt !== snapshot.updatedAt
    ) {
      return null
    }

    return this.persistAiFeedback(session, parsedFeedback)
  }

  async applyAiComparisonIfTranscriptsCurrent(
    sessionId: string,
    snapshot: ComparisonTranscriptSnapshot,
    feedback: AiFeedback,
  ): Promise<TrainingSession | null> {
    const parsedFeedback = aiFeedbackSchema.parse(feedback)
    const session = await this.requireSession(sessionId)
    const firstAttempt = session.attempts.find(
      (attempt) => attempt.attemptNumber === 1,
    )
    const secondAttempt = session.attempts.find(
      (attempt) => attempt.attemptNumber === 2,
    )

    if (
      !this.transcriptMatches(firstAttempt, snapshot.first) ||
      !this.transcriptMatches(secondAttempt, snapshot.second)
    ) {
      return null
    }

    const updated = trainingSessionSchema.parse({
      ...session,
      aiComparison: parsedFeedback,
      updatedAt: this.now().toISOString(),
    })
    await this.localStorage.upsertSession(updated)
    return updated
  }

  private async persistAiFeedback(
    session: TrainingSession,
    feedback: AiFeedback,
  ): Promise<TrainingSession> {
    const updated = trainingSessionSchema.parse({
      ...session,
      aiFeedback: aiFeedbackSchema.parse(feedback),
      status:
        session.status === 'first-review' ? 'feedback-ready' : session.status,
      updatedAt: this.now().toISOString(),
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
      updatedAt: timestamp,
      reviewCount: 0,
      lastReviewedAt: null,
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
    return expressions.sort((a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
    )
  }

  async updateExpression(
    expressionId: string,
    changes: Pick<SavedExpression, 'text' | 'topic'>,
  ): Promise<SavedExpression> {
    const existing = await this.requireExpression(expressionId)
    const updated = savedExpressionSchema.parse({
      ...existing,
      text: changes.text,
      topic: changes.topic,
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

  async deleteExpression(expressionId: string): Promise<void> {
    const existing = await this.localStorage.getExpression(expressionId)
    if (!existing) {
      throw new Error('Saved expression not found.')
    }
    await this.localStorage.deleteExpression(expressionId)
  }

  getAudio(audioId: string): Promise<Blob | null> {
    return this.audioStorage.getAudio(audioId)
  }

  getSession(sessionId: string): Promise<TrainingSession | null> {
    return this.localStorage.getSession(sessionId)
  }

  private async requireExpression(expressionId: string): Promise<SavedExpression> {
    const expression = await this.localStorage.getExpression(expressionId)
    if (!expression) {
      throw new Error('Saved expression not found.')
    }
    return expression
  }

  private async replaceTranscript(
    sessionId: string,
    attemptNumber: 1 | 2,
    replacement: {
      status: 'ready' | 'failed'
      text: string
      originalText: string | null
      source: 'stt' | 'manual' | 'edited' | null
      errorCode: string | null
    },
  ): Promise<TrainingSession> {
    const session = await this.requireSession(sessionId)
    const timestamp = this.now().toISOString()
    const existing = session.attempts.find(
      (attempt) => attempt.attemptNumber === attemptNumber,
    )
    if (!existing) {
      throw new Error(`Attempt ${attemptNumber} does not exist.`)
    }

    const cleanText = replacement.text.trim()
    const updatedAttempt: PracticeAttempt = {
      ...existing,
      transcript: {
        status: replacement.status,
        text: cleanText,
        originalText: replacement.originalText,
        source: replacement.source,
        errorCode: replacement.errorCode,
        updatedAt: timestamp,
      },
      metrics: analyzeSpeech({
        transcript: cleanText,
        durationMs: existing.audio.durationMs,
        acoustic: existing.metrics.acoustic ?? null,
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
      aiFeedback:
        attemptNumber === 1 ? null : session.aiFeedback,
      aiComparison: null,
      updatedAt: timestamp,
    })

    await this.localStorage.upsertSession(updated)
    return updated
  }

  private async requireSession(sessionId: string): Promise<TrainingSession> {
    const session = await this.localStorage.getSession(sessionId)
    if (!session) {
      throw new Error('The practice session could not be found.')
    }
    return session
  }

  private transcriptMatches(
    attempt: PracticeAttempt | undefined,
    snapshot: FirstTranscriptSnapshot,
  ): boolean {
    return attempt?.id === snapshot.attemptId &&
      attempt.transcript.status === 'ready' &&
      attempt.transcript.text === snapshot.text &&
      attempt.transcript.updatedAt === snapshot.updatedAt
  }

  private async analyzeAudio(audio: Blob) {
    if (this.audioAnalyzer === null) return null
    try {
      return await this.audioAnalyzer.analyze(audio)
    } catch {
      // Acoustic enrichment must never block saving the original recording.
      return null
    }
  }
}
