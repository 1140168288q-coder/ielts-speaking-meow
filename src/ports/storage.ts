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
