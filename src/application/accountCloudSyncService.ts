import {
  CloudSyncError,
  type CloudSyncEntityType,
  type CloudSyncGateway,
  type SyncChange,
  type SyncPayload,
} from '../domain/cloudSync'
import {
  savedExpressionSchema,
  trainingSessionSchema,
  type SavedExpression,
  type TrainingSession,
} from '../domain/models'
import {
  personalMaterialSchema,
  type PersonalMaterial,
} from '../domain/personalMaterials'
import {
  importedQuestionRecordSchema,
  importSourceSchema,
  questionBankExclusionSchema,
  questionExclusionSchema,
  userPreferencesSchema,
} from '../domain'
import {
  userKnowledgeEntrySchema,
  userKnowledgeSourceSchema,
  type UserKnowledgeEntry,
  type UserKnowledgeSource,
} from '../domain/userKnowledge'
import type { UserPreferences } from '../domain/userPreferences'
import { recordBelongsToAccount } from '../domain/accounts'
import type {
  CloudSyncStorage,
  LocalDataMaintenance,
  LocalStorage,
  SyncEntityState,
} from '../ports/storage'
import type { ImportStorage } from '../ports/imports'
import type { UserKnowledgeStorage } from '../ports/userKnowledge'
import type { QuestionManagementStorage } from '../ports/questionManagement'
import { CloudSyncService } from './cloudSyncService'

type AccountSyncStorage = LocalStorage & CloudSyncStorage & Partial<ImportStorage> & Partial<UserKnowledgeStorage> & Partial<QuestionManagementStorage> & Partial<{
  listUserPreferences(): Promise<UserPreferences[]>
  getUserPreferences(ownerId: string): Promise<UserPreferences | null>
  saveUserPreferences(preferences: UserPreferences): Promise<void>
}> & Pick<
  LocalDataMaintenance,
  'deleteSessionWithAudio'
>

export type SyncConflictReason =
  | 'concurrent-change'
  | 'foreign-local-owner'

export interface SyncConflict {
  entityType: CloudSyncEntityType
  entityId: string
  reason: SyncConflictReason
  message: string
}

/** A compact result intended for the account UI after an explicit manual sync. */
export interface SyncSummary {
  status: 'synced' | 'conflict'
  downloaded: number
  queued: number
  uploaded: number
  conflicts: SyncConflict[]
}

export interface AccountCloudSyncServiceOptions {
  /** Cloud account id. It scopes cursor, versions, and the durable outbox. */
  scopeId: string
  /** The local account that the user explicitly chose to sync. */
  ownerId: string
  storage: AccountSyncStorage
  gateway: CloudSyncGateway
}

class ApplyConflictError extends Error {
  readonly conflict: SyncConflict

  constructor(conflict: SyncConflict) {
    super(conflict.message)
    this.name = 'ApplyConflictError'
    this.conflict = conflict
  }
}

/**
 * Explicit account sync adapter. Constructing it never starts network or disk work;
 * callers must invoke synchronize() from a deliberate user action.
 */
export class AccountCloudSyncService {
  private readonly scopeId: string
  private readonly ownerId: string
  private readonly storage: AccountSyncStorage
  private readonly cloudSync: CloudSyncService
  private downloaded = 0

  constructor(options: AccountCloudSyncServiceOptions) {
    this.scopeId = requireScope(options.scopeId, '云端账号')
    this.ownerId = requireScope(options.ownerId, '本地账号')
    this.storage = options.storage
    this.cloudSync = new CloudSyncService({
      scopeId: this.scopeId,
      storage: options.storage,
      gateway: options.gateway,
      applyChange: async (change) => {
        await this.applyRemoteChange(change)
        this.downloaded += 1
      },
    })
  }

  async synchronize(): Promise<SyncSummary> {
    this.downloaded = 0
    let queued = 0
    let uploaded = 0

    const firstPullConflict = await this.pullUntilSettled()
    if (firstPullConflict !== null) {
      return conflictSummary(this.downloaded, queued, uploaded, firstPullConflict)
    }

    queued = await this.scanAndQueueCurrentOwner()

    while ((await this.storage.listSyncOperations(this.scopeId, 100)).length > 0) {
      const flush = await this.cloudSync.flush(100)
      uploaded += flush.applied

      if (flush.rejected > 0) {
        throw new CloudSyncError(
          'request-failed',
          '云端拒绝了部分同步数据；未成功的项目仍保留在本机等待重试。',
        )
      }
      if (flush.conflicts > 0) {
        return {
          status: 'conflict',
          downloaded: this.downloaded,
          queued,
          uploaded,
          conflicts: flush.results
            .filter((result) => result.status === 'conflict')
            .map((result) => ({
              entityType: result.entityType,
              entityId: result.entityId,
              reason: 'concurrent-change',
              message: result.message ?? '本机和云端都修改了这条数据，请先处理冲突。',
            })),
        }
      }
      if (flush.attempted > 0 && flush.applied === 0) {
        throw new CloudSyncError(
          'invalid-response',
          '同步没有取得进展；未发送的数据仍保留在本机。',
          { retryable: true },
        )
      }
    }

    await this.clearSyncedDeletionTombstones()

    const finalPullConflict = await this.pullUntilSettled()
    if (finalPullConflict !== null) {
      return conflictSummary(this.downloaded, queued, uploaded, finalPullConflict)
    }

    return {
      status: 'synced',
      downloaded: this.downloaded,
      queued,
      uploaded,
      conflicts: [],
    }
  }

  private async pullUntilSettled(): Promise<SyncConflict | null> {
    try {
      await this.cloudSync.pull()
      return null
    } catch (error) {
      if (error instanceof ApplyConflictError) return error.conflict
      throw error
    }
  }

  private async scanAndQueueCurrentOwner(): Promise<number> {
    let queued = 0

    const sessions = (await this.storage.listSessions()).filter((session) =>
      recordBelongsToAccount(session.ownerId, this.ownerId) &&
      !isUnsubmittedDraft(session),
    )
    const expressions = (await this.storage.listExpressions()).filter((expression) =>
      recordBelongsToAccount(expression.ownerId, this.ownerId),
    )
    const materials = await this.storage.listPersonalMaterials(this.ownerId, {
      includeDeleted: true,
    })
    const importedQuestions = this.storage.listImportedQuestions === undefined
      ? []
      : await this.storage.listImportedQuestions(this.ownerId)
    const importSources = this.storage.listImportSources === undefined
      ? []
      : (await this.storage.listImportSources()).filter((source) =>
        importedQuestions.some((record) => record.sourceId === source.id),
      )
    const questionExclusions = this.storage.listQuestionExclusions === undefined
      ? []
      : await this.storage.listQuestionExclusions(this.ownerId, { includeDeleted: true })
    const questionBankExclusions = this.storage.listQuestionBankExclusions === undefined
      ? []
      : await this.storage.listQuestionBankExclusions(this.ownerId, { includeDeleted: true })
    const knowledgeSources = this.storage.listUserKnowledgeSources === undefined
      ? []
      : await this.storage.listUserKnowledgeSources(this.ownerId, { includeDeleted: true })
    const knowledgeEntries = this.storage.listUserKnowledgeEntries === undefined
      ? []
      : await this.storage.listUserKnowledgeEntries(this.ownerId, { includeDeleted: true })
    const userPreferences = this.storage.listUserPreferences === undefined
      ? []
      : (await this.storage.listUserPreferences()).filter((preferences) =>
        preferences.ownerId === this.ownerId,
      )
    const tombstones = await this.storage.listLocalDeletionTombstones(
      this.ownerId,
    )

    for (const session of sessions) {
      queued += await this.queueIfChanged(
        'session',
        session.id,
        session.updatedAt,
        sanitizeSession(session),
        null,
      )
    }
    for (const expression of expressions) {
      const updatedAt = expression.updatedAt ?? expression.createdAt
      queued += await this.queueIfChanged(
        'expression',
        expression.id,
        updatedAt,
        sanitizeExpression(expression, updatedAt),
        null,
      )
    }
    for (const material of materials) {
      queued += await this.queueIfChanged(
        'personal_material',
        material.id,
        material.updatedAt,
        sanitizeMaterial(material),
        material.deletedAt,
      )
    }
    for (const source of importSources) {
      queued += await this.queueIfChanged(
        'import_source_metadata',
        source.id,
        source.importedAt,
        { ...source, extractedText: '' },
        null,
      )
    }
    for (const record of importedQuestions) {
      queued += await this.queueIfChanged(
        'imported_question',
        record.id,
        record.createdAt,
        omitProperty(record, 'ownerId'),
        null,
      )
    }
    for (const exclusion of questionExclusions) {
      queued += await this.queueIfChanged(
        'question_exclusion',
        exclusion.id,
        exclusion.createdAt,
        omitProperty(exclusion, 'ownerId'),
        null,
      )
    }
    for (const exclusion of questionBankExclusions) {
      queued += await this.queueIfChanged(
        'question_bank_exclusion',
        exclusion.id,
        exclusion.createdAt,
        omitProperty(exclusion, 'ownerId'),
        null,
      )
    }
    for (const source of knowledgeSources) {
      queued += await this.queueIfChanged(
        'knowledge_source',
        source.id,
        source.updatedAt,
        sanitizeKnowledgeSource(source),
        source.deletedAt,
      )
    }
    for (const entry of knowledgeEntries) {
      queued += await this.queueIfChanged(
        'knowledge_entry',
        entry.id,
        entry.updatedAt,
        sanitizeKnowledgeEntry(entry),
        entry.deletedAt,
      )
    }
    for (const preferences of userPreferences) {
      queued += await this.queueIfChanged(
        'user_setting',
        preferences.ownerId,
        preferences.updatedAt,
        omitProperty(preferences, 'ownerId'),
        null,
      )
    }
    for (const tombstone of tombstones) {
      // Question exclusions are stateful records: their deletedAt value is
      // synced as part of the strict entity payload. A generic tombstone has
      // no questionId/reason fields and would be unrecoverable on a new device.
      if (
        tombstone.entityType === 'question_exclusion' ||
        tombstone.entityType === 'question_bank_exclusion'
      ) {
        // Older builds wrote a generic tombstone for these records. The
        // current payload-based state supersedes it, so remove the stale
        // duplicate instead of uploading an unrecoverable empty payload.
        await this.storage.removeLocalDeletionTombstone(
          this.ownerId,
          tombstone.entityType,
          tombstone.entityId,
        )
        continue
      }
      queued += await this.queueIfChanged(
        tombstone.entityType,
        tombstone.entityId,
        tombstone.deletedAt,
        {
          id: tombstone.entityId,
          updatedAt: tombstone.deletedAt,
        },
        tombstone.deletedAt,
      )
    }

    return queued
  }

  private async queueIfChanged(
    entityType: CloudSyncEntityType,
    entityId: string,
    updatedAt: string,
    payload: SyncPayload,
    deletedAt: string | null,
  ): Promise<number> {
    const state = await this.storage.getSyncEntityState(
      this.scopeId,
      entityType,
      entityId,
    )
    const syncTimestamp = readLocalSyncTimestamp(
      entityType,
      payload,
      updatedAt,
      deletedAt,
    )
    if (state.syncedUpdatedAt === syncTimestamp) return 0

    // Include the last accepted cloud version so a state that is restored to
    // its original createdAt still gets a fresh operation id. Retries with the
    // same version/state remain idempotent.
    const operationId = stableOperationId(
      entityType,
      entityId,
      syncTimestamp,
      deletedAt,
      state.version,
    )
    const pendingIds = new Set(
      (await this.storage.listSyncOperations(this.scopeId, 100)).map(
        (operation) => operation.operationId,
      ),
    )
    await this.cloudSync.enqueue({
      operationId,
      entityType,
      entityId,
      baseVersion: state.version,
      payload,
      deletedAt,
    })
    return pendingIds.has(operationId) ? 0 : 1
  }

  private async applyRemoteChange(change: SyncChange): Promise<void> {
    const state = await this.storage.getSyncEntityState(
      this.scopeId,
      change.entityType,
      change.entityId,
    )
    if (change.version <= state.version) return

    if (change.entityType === 'session') {
      await this.applySession(change, state)
      return
    }
    if (change.entityType === 'expression') {
      await this.applyExpression(change, state)
      return
    }
    if (change.entityType === 'personal_material') {
      await this.applyMaterial(change, state)
      return
    }
    if (change.entityType === 'import_source_metadata') {
      await this.applyImportSource(change, state)
      return
    }
    if (change.entityType === 'imported_question') {
      await this.applyImportedQuestion(change, state)
      return
    }
    if (change.entityType === 'question_exclusion') {
      await this.applyQuestionExclusion(change, state)
      return
    }
    if (change.entityType === 'question_bank_exclusion') {
      await this.applyQuestionBankExclusion(change, state)
      return
    }
    if (change.entityType === 'knowledge_source') {
      await this.applyKnowledgeSource(change, state)
      return
    }
    if (change.entityType === 'knowledge_entry') {
      await this.applyKnowledgeEntry(change, state)
      return
    }
    if (change.entityType === 'user_setting') {
      await this.applyUserSetting(change, state)
      return
    }
    throw invalidRemotePayload('云端返回了未知的数据类型。')
  }

  private async applySession(
    change: SyncChange,
    state: SyncEntityState,
  ): Promise<void> {
    const current = await this.storage.getSession(change.entityId)
    this.assertLocalOwner(current?.ownerId, change, current !== null)
    this.assertNotConcurrentlyModified(current?.updatedAt ?? null, state, change)

    if (change.deletedAt !== null) {
      validateDeletionPayload(change)
      if (current !== null) {
        await this.storage.deleteSessionWithAudio(
          change.entityId,
          this.ownerId,
          null,
        )
      }
      return
    }

    const remote = parseOwnerlessPayload(
      trainingSessionSchema,
      change,
      this.ownerId,
    )
    const merged = preserveLocalRecordingReferences(remote, current)
    await this.storage.upsertSession(trainingSessionSchema.parse(merged))
  }

  private async applyExpression(
    change: SyncChange,
    state: SyncEntityState,
  ): Promise<void> {
    const current = await this.storage.getExpression(change.entityId)
    this.assertLocalOwner(current?.ownerId, change, current !== null)
    this.assertNotConcurrentlyModified(expressionUpdatedAt(current), state, change)

    if (change.deletedAt !== null) {
      validateDeletionPayload(change)
      if (current !== null) {
        await this.storage.deleteExpression(
          change.entityId,
          this.ownerId,
          null,
        )
      }
      return
    }

    const remote = parseOwnerlessPayload(
      savedExpressionSchema,
      change,
      this.ownerId,
      { updatedAt: change.updatedAt },
    )
    await this.storage.upsertExpression(remote)
  }

  private async applyMaterial(
    change: SyncChange,
    state: SyncEntityState,
  ): Promise<void> {
    const current = await this.storage.getPersonalMaterial(
      change.entityId,
      this.ownerId,
    )
    this.assertNotConcurrentlyModified(current?.updatedAt ?? null, state, change)

    if (change.deletedAt !== null) {
      validateDeletionPayload(change)
      if (current !== null) {
        await this.storage.deletePersonalMaterial(
          change.entityId,
          this.ownerId,
          change.deletedAt,
        )
      }
      return
    }

    const remote = parseOwnerlessPayload(
      personalMaterialSchema,
      change,
      this.ownerId,
    )
    await this.storage.upsertPersonalMaterial(remote)
  }

  private async applyImportSource(change: SyncChange, state: SyncEntityState): Promise<void> {
    if (this.storage.upsertImportSourceMetadata === undefined || this.storage.getImportSource === undefined) throw invalidRemotePayload('当前版本不支持恢复导入来源。')
    const current = await this.storage.getImportSource(change.entityId)
    this.assertNotConcurrentlyModified(current?.importedAt ?? null, state, change)
    if (change.deletedAt !== null) return
    const parsed = importSourceSchema.safeParse({
      ...change.payload,
      extractedText: '',
    })
    if (!parsed.success || parsed.data.id !== change.entityId) throw invalidRemotePayload('云端来源结构无效。')
    await this.storage.upsertImportSourceMetadata(parsed.data)
  }

  private async applyImportedQuestion(change: SyncChange, state: SyncEntityState): Promise<void> {
    if (this.storage.listImportedQuestions === undefined || this.storage.upsertImportedQuestion === undefined) throw invalidRemotePayload('当前版本不支持恢复导入题。')
    const current = (await this.storage.listImportedQuestions(this.ownerId)).find((item) => item.id === change.entityId) ?? null
    this.assertLocalOwner(current?.ownerId, change, current !== null)
    this.assertNotConcurrentlyModified(current?.createdAt ?? null, state, change)
    if (change.deletedAt !== null) return
    const parsed = importedQuestionRecordSchema.safeParse({ ...change.payload, ownerId: this.ownerId })
    if (!parsed.success || parsed.data.id !== change.entityId) throw invalidRemotePayload('云端导入题结构无效。')
    await this.storage.upsertImportedQuestion(parsed.data)
  }

  private async applyQuestionExclusion(change: SyncChange, state: SyncEntityState): Promise<void> {
    if (this.storage.listQuestionExclusions === undefined || this.storage.saveQuestionExclusion === undefined) throw invalidRemotePayload('当前版本不支持恢复题目状态。')
    const current = (await this.storage.listQuestionExclusions(this.ownerId, { includeDeleted: true })).find((item) => item.id === change.entityId) ?? null
    this.assertNotConcurrentlyModified(
      questionExclusionSyncTimestamp(current),
      state,
      change,
    )
    const parsed = parseOwnerlessPayload(questionExclusionSchema, change, this.ownerId, {
      deletedAt: change.deletedAt,
    })
    await this.storage.saveQuestionExclusion(parsed)
  }

  private async applyQuestionBankExclusion(change: SyncChange, state: SyncEntityState): Promise<void> {
    if (this.storage.listQuestionBankExclusions === undefined || this.storage.saveQuestionBankExclusion === undefined) throw invalidRemotePayload('当前版本不支持恢复题库状态。')
    const current = (await this.storage.listQuestionBankExclusions(this.ownerId, { includeDeleted: true })).find((item) => item.id === change.entityId) ?? null
    this.assertNotConcurrentlyModified(
      questionBankExclusionSyncTimestamp(current),
      state,
      change,
    )
    const parsed = parseOwnerlessPayload(questionBankExclusionSchema, change, this.ownerId, {
      deletedAt: change.deletedAt,
    })
    await this.storage.saveQuestionBankExclusion(parsed)
  }

  private async applyKnowledgeSource(change: SyncChange, state: SyncEntityState): Promise<void> {
    if (this.storage.listUserKnowledgeSources === undefined || this.storage.updateUserKnowledgeSource === undefined) throw invalidRemotePayload('当前版本不支持恢复个人知识来源。')
    const current = (await this.storage.listUserKnowledgeSources(this.ownerId, { includeDeleted: true })).find((item) => item.id === change.entityId) ?? null
    this.assertNotConcurrentlyModified(current?.updatedAt ?? null, state, change)
    if (change.deletedAt !== null) {
      if (current !== null) {
        await this.storage.updateUserKnowledgeSource({ ...current, status: 'disabled', deletedAt: change.deletedAt, updatedAt: change.updatedAt })
        if (
          this.storage.listUserKnowledgeEntries !== undefined &&
          this.storage.updateUserKnowledgeEntry !== undefined
        ) {
          const entries = await this.storage.listUserKnowledgeEntries(this.ownerId, { includeDeleted: true })
          for (const entry of entries.filter((item) => item.sourceId === current.id && item.deletedAt === null)) {
            await this.storage.updateUserKnowledgeEntry({
              ...entry,
              enabled: false,
              deletedAt: change.deletedAt,
              updatedAt: change.updatedAt,
            })
          }
        }
      }
      return
    }
    const parsed = parseOwnerlessPayload(userKnowledgeSourceSchema, change, this.ownerId)
    await this.storage.updateUserKnowledgeSource(parsed)
  }

  private async applyKnowledgeEntry(change: SyncChange, state: SyncEntityState): Promise<void> {
    if (this.storage.listUserKnowledgeEntries === undefined || this.storage.updateUserKnowledgeEntry === undefined) throw invalidRemotePayload('当前版本不支持恢复个人知识条目。')
    const current = (await this.storage.listUserKnowledgeEntries(this.ownerId, { includeDeleted: true })).find((item) => item.id === change.entityId) ?? null
    this.assertNotConcurrentlyModified(current?.updatedAt ?? null, state, change)
    if (change.deletedAt !== null) {
      if (current !== null) {
        await this.storage.updateUserKnowledgeEntry({ ...current, enabled: false, deletedAt: change.deletedAt, updatedAt: change.updatedAt })
        if (
          this.storage.listUserKnowledgeSources !== undefined &&
          this.storage.updateUserKnowledgeSource !== undefined
        ) {
          const source = (await this.storage.listUserKnowledgeSources(this.ownerId, { includeDeleted: true }))
            .find((item) => item.id === current.sourceId)
          if (source !== undefined && source.deletedAt === null) {
            const entries = this.storage.listUserKnowledgeEntries === undefined
              ? []
              : await this.storage.listUserKnowledgeEntries(this.ownerId)
            const entryCount = entries.filter((item) => item.sourceId === source.id && item.enabled && item.deletedAt === null).length
            await this.storage.updateUserKnowledgeSource({
              ...source,
              entryCount,
              status: entryCount > 0 ? 'ready' : 'disabled',
              updatedAt: change.updatedAt,
            })
          }
        }
      }
      return
    }
    const parsed = parseOwnerlessPayload(userKnowledgeEntrySchema, change, this.ownerId)
    await this.storage.updateUserKnowledgeEntry(parsed)
  }

  private async applyUserSetting(change: SyncChange, state: SyncEntityState): Promise<void> {
    if (this.storage.getUserPreferences === undefined || this.storage.saveUserPreferences === undefined) {
      throw invalidRemotePayload('当前版本不支持恢复用户偏好。')
    }
    if (change.deletedAt !== null) {
      throw invalidRemotePayload('用户偏好不支持云端删除。')
    }
    if (change.entityId !== this.ownerId) {
      throw invalidRemotePayload('云端用户偏好归属无效。')
    }
    const current = await this.storage.getUserPreferences(this.ownerId)
    this.assertNotConcurrentlyModified(current?.updatedAt ?? null, state, change)
    if (Object.prototype.hasOwnProperty.call(change.payload, 'ownerId')) {
      throw invalidRemotePayload('云端用户偏好不应包含本地账号 ownerId。')
    }
    const parsed = userPreferencesSchema.safeParse({
      ...change.payload,
      ownerId: this.ownerId,
    })
    if (!parsed.success) throw invalidRemotePayload('云端用户偏好结构无效，本机偏好未被修改。')
    await this.storage.saveUserPreferences(parsed.data)
  }

  private async clearSyncedDeletionTombstones(): Promise<void> {
    const tombstones = await this.storage.listLocalDeletionTombstones(
      this.ownerId,
    )
    for (const tombstone of tombstones) {
      const state = await this.storage.getSyncEntityState(
        this.scopeId,
        tombstone.entityType,
        tombstone.entityId,
      )
      if (state.syncedUpdatedAt === tombstone.deletedAt) {
        await this.storage.removeLocalDeletionTombstone(
          this.ownerId,
          tombstone.entityType,
          tombstone.entityId,
        )
      }
    }
  }

  private assertLocalOwner(
    localOwnerId: string | undefined,
    change: SyncChange,
    exists: boolean,
  ): void {
    if (exists && !recordBelongsToAccount(localOwnerId, this.ownerId)) {
      throw new ApplyConflictError({
        entityType: change.entityType,
        entityId: change.entityId,
        reason: 'foreign-local-owner',
        message: '云端数据与另一个本地账号的记录重名，已停止同步以保护本机数据。',
      })
    }
  }

  private assertNotConcurrentlyModified(
    localUpdatedAt: string | null,
    state: SyncEntityState,
    change: SyncChange,
  ): void {
    const incomingUpdatedAt = readPayloadUpdatedAt(change)
    if (
      localUpdatedAt !== null &&
      localUpdatedAt !== incomingUpdatedAt &&
      localUpdatedAt !== state.syncedUpdatedAt
    ) {
      throw new ApplyConflictError({
        entityType: change.entityType,
        entityId: change.entityId,
        reason: 'concurrent-change',
        message: '本机和云端都修改了这条数据，已停止同步且未覆盖本机版本。',
      })
    }
  }
}

function parseOwnerlessPayload<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  change: SyncChange,
  ownerId: string,
  defaults: Record<string, unknown> = {},
): T {
  if (Object.prototype.hasOwnProperty.call(change.payload, 'ownerId')) {
    throw invalidRemotePayload('云端同步数据不应包含本地账号 ownerId。')
  }
  const parsed = schema.safeParse({
    ...defaults,
    ...change.payload,
    ownerId,
  })
  if (!parsed.success || readEntityId(parsed.data) !== change.entityId) {
    throw invalidRemotePayload('云端同步数据结构无效，本机数据未被修改。')
  }
  return parsed.data
}

function readEntityId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('id' in value)) return null
  return typeof value.id === 'string' ? value.id : null
}

function sanitizeSession(session: TrainingSession): SyncPayload {
  const ownerless = omitProperty(
    omitProperty(session, 'ownerId'),
    'readAloud',
  )
  return {
    ...ownerless,
    attempts: ownerless.attempts.map((attempt) =>
      omitProperty(attempt, 'audio'),
    ),
  }
}

function sanitizeExpression(
  expression: SavedExpression,
  updatedAt: string,
): SyncPayload {
  const ownerless = omitProperty(expression, 'ownerId')
  return { ...ownerless, updatedAt }
}

function sanitizeMaterial(material: PersonalMaterial): SyncPayload {
  if (material.deletedAt !== null) {
    return { id: material.id, updatedAt: material.deletedAt }
  }
  return omitProperty(material, 'ownerId')
}

function sanitizeKnowledgeSource(source: UserKnowledgeSource): SyncPayload {
  return omitProperty(source, 'ownerId')
}

function sanitizeKnowledgeEntry(entry: UserKnowledgeEntry): SyncPayload {
  return omitProperty(entry, 'ownerId')
}

function validateDeletionPayload(change: SyncChange): void {
  if (
    ('ownerId' in change.payload) ||
    (typeof change.payload.id === 'string' &&
      change.payload.id !== change.entityId)
  ) {
    throw invalidRemotePayload('云端删除记录结构无效，本机数据未被修改。')
  }
}

function readPayloadUpdatedAt(change: SyncChange): string {
  let timestamp = change.updatedAt
  for (const key of ['updatedAt', 'createdAt', 'importedAt'] as const) {
    if (typeof change.payload[key] === 'string') {
      timestamp = change.payload[key]
      break
    }
  }
  if (
    (change.entityType === 'question_exclusion' ||
      change.entityType === 'question_bank_exclusion') &&
    typeof change.payload.deletedAt === 'string' &&
    change.payload.deletedAt.length > 0
  ) {
    return `${timestamp}|deleted:${change.payload.deletedAt}`
  }
  return timestamp
}

function questionExclusionSyncTimestamp(
  value: { createdAt: string; deletedAt: string | null } | null,
): string | null {
  if (value === null) return null
  return value.deletedAt === null
    ? value.createdAt
    : `${value.createdAt}|deleted:${value.deletedAt}`
}

function questionBankExclusionSyncTimestamp(
  value: { createdAt: string; deletedAt: string | null } | null,
): string | null {
  if (value === null) return null
  return value.deletedAt === null
    ? value.createdAt
    : `${value.createdAt}|deleted:${value.deletedAt}`
}

function readLocalSyncTimestamp(
  entityType: CloudSyncEntityType,
  payload: SyncPayload,
  fallback: string,
  deletedAt: string | null,
): string {
  let timestamp = fallback
  for (const key of ['updatedAt', 'createdAt', 'importedAt'] as const) {
    if (typeof payload[key] === 'string') {
      timestamp = payload[key]
      break
    }
  }
  if (
    deletedAt === null &&
    (entityType === 'question_exclusion' || entityType === 'question_bank_exclusion') &&
    typeof payload.deletedAt === 'string' &&
    payload.deletedAt.length > 0
  ) {
    return `${timestamp}|deleted:${payload.deletedAt}`
  }
  return timestamp
}

function isUnsubmittedDraft(session: TrainingSession): boolean {
  return session.status === 'first-ready' && session.attempts.length === 0
}

function omitProperty<T extends object, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> {
  const copy = { ...value }
  Reflect.deleteProperty(copy, key)
  return copy
}

function preserveLocalRecordingReferences(
  remote: TrainingSession,
  local: TrainingSession | null,
): TrainingSession {
  if (local === null) return remote
  const localAttempts = new Map(
    local.attempts.map((attempt) => [attempt.attemptNumber, attempt]),
  )
  return {
    ...remote,
    attempts: remote.attempts.map((attempt) => {
      const localAttempt = localAttempts.get(attempt.attemptNumber)
      return localAttempt?.audio === undefined
        ? attempt
        : { ...attempt, audio: localAttempt.audio }
    }),
    ...(local.readAloud === undefined ? {} : { readAloud: local.readAloud }),
  }
}

function expressionUpdatedAt(expression: SavedExpression | null): string | null {
  return expression === null ? null : expression.updatedAt ?? expression.createdAt
}

function stableOperationId(
  entityType: CloudSyncEntityType,
  entityId: string,
  updatedAt: string,
  deletedAt: string | null,
  baseVersion: number,
): string {
  const identity = `${entityType}\u0000${entityId}\u0000${updatedAt}\u0000${deletedAt ?? ''}\u0000${baseVersion}`
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < identity.length; index += 1) {
    const code = identity.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `account-sync-${entityType}-${toHex(first)}${toHex(second)}`
}

function toHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}

function requireScope(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized.length < 1 || normalized.length > 128) {
    throw new CloudSyncError('invalid-input', `${label}标识无效。`)
  }
  return normalized
}

function invalidRemotePayload(message: string): CloudSyncError {
  return new CloudSyncError('invalid-response', message, { retryable: true })
}

function conflictSummary(
  downloaded: number,
  queued: number,
  uploaded: number,
  conflict: SyncConflict,
): SyncSummary {
  return {
    status: 'conflict',
    downloaded,
    queued,
    uploaded,
    conflicts: [conflict],
  }
}
