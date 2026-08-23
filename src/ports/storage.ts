import type {
  PracticeTexts,
  SavedExpression,
  TrainingSession,
} from '../domain/models'
import type { PersonalMaterial } from '../domain/personalMaterials'
import type { CloudSyncEntityType, SyncOutboxOperation } from '../domain/cloudSync'

export interface SyncEntityState {
  version: number
  syncedUpdatedAt: string | null
}

export interface ListPersonalMaterialsOptions {
  /** 默认隐藏软删除墓碑；同步与恢复流程可显式读取。 */
  includeDeleted?: boolean
}

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

  upsertPersonalMaterial(material: PersonalMaterial): Promise<void>
  getPersonalMaterial(
    materialId: string,
    ownerId: string,
  ): Promise<PersonalMaterial | null>
  listPersonalMaterials(
    ownerId: string,
    options?: ListPersonalMaterialsOptions,
  ): Promise<PersonalMaterial[]>
  /** 写入 deletedAt 墓碑，不物理删除记录。 */
  deletePersonalMaterial(materialId: string, ownerId: string): Promise<void>

  /** 练习页顶部三行自定义文字;未保存过时返回 null(使用默认值)。 */
  getPracticeTexts(): Promise<PracticeTexts | null>
  savePracticeTexts(texts: PracticeTexts): Promise<void>
}

/**
 * Durable cloud-sync metadata, scoped by cloud account id.
 *
 * This boundary deliberately does not claim to atomically persist a business
 * entity and its outbox operation. Callers must persist the entity first and
 * then enqueue; a future entity-specific transactional API is required before
 * the two writes can be guaranteed atomic in IndexedDB.
 */
export interface CloudSyncStorage {
  enqueueSyncOperation(
    scopeId: string,
    operation: SyncOutboxOperation,
  ): Promise<'created' | 'already-enqueued'>
  listSyncOperations(
    scopeId: string,
    limit?: number,
  ): Promise<SyncOutboxOperation[]>
  removeSyncOperation(scopeId: string, operationId: string): Promise<void>
  getSyncCursor(scopeId: string): Promise<number>
  setSyncCursor(scopeId: string, cursor: number): Promise<void>
  getSyncEntityState(
    scopeId: string,
    entityType: CloudSyncEntityType,
    entityId: string,
  ): Promise<SyncEntityState>
  setSyncEntityState(
    scopeId: string,
    entityType: CloudSyncEntityType,
    entityId: string,
    state: SyncEntityState,
  ): Promise<void>
}

/**
 * Durable storage for the user's original recordings.
 *
 * `deleteAudio` is intentionally explicit. Implementations must never invoke it
 * as cleanup after a failed save/read or a provider failure. V1.7 新练习不再
 * 产生录音;该接口仅为读取/维护 V1.6 及更早版本的历史录音保留。
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
