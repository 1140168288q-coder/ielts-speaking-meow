import type { SavedExpression, TrainingSession } from '../domain/models'

/**
 * Durable, non-secret application data.
 *
 * API credentials deliberately do not belong in this store. They must use the
 * separate secure-secret boundary provided by the platform integration.
 */
export interface LocalStorage {
  upsertSession(session: TrainingSession): Promise<void>
  getSession(sessionId: string): Promise<TrainingSession | null>
  listSessions(): Promise<TrainingSession[]>

  upsertExpression(expression: SavedExpression): Promise<void>
  getExpression(expressionId: string): Promise<SavedExpression | null>
  listExpressions(): Promise<SavedExpression[]>
  deleteExpression(expressionId: string): Promise<void>
}

/**
 * Durable storage for the user's original recordings.
 *
 * `deleteAudio` is intentionally explicit. Implementations must never invoke it
 * as cleanup after a failed save/read or after an STT/provider failure.
 */
export interface AudioStorage {
  saveAudio(audioId: string, audio: Blob): Promise<void>
  getAudio(audioId: string): Promise<Blob | null>
  hasAudio(audioId: string): Promise<boolean>
  deleteAudio(audioId: string): Promise<void>
}

export interface StorageUsageSummary {
  sessions: number
  expressions: number
  recordings: number
  importSources: number
  importedQuestions: number
  importedFiles: number
  ttsCacheEntries: number
  audioBytes: number
  importedFileBytes: number
  ttsCacheBytes: number
  estimatedTotalBytes: number
}

/** Explicit user-controlled maintenance. No automatic action may delete recordings. */
export interface LocalDataMaintenance {
  getStorageUsage(): Promise<StorageUsageSummary>
  deleteSessionWithAudio(sessionId: string): Promise<{ deletedAudio: number }>
  clearTtsCache(): Promise<number>
}
