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
import { recordBelongsToAccount } from '../domain/accounts'
import type { CloudSyncStorage, LocalStorage, SyncEntityState } from '../ports/storage'
import { CloudSyncService } from './cloudSyncService'

type AccountSyncStorage = LocalStorage & CloudSyncStorage

export type SyncConflictReason =
  | 'concurrent-change'
  | 'foreign-local-owner'
  | 'session-delete-unsupported'

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
    if (state.syncedUpdatedAt === updatedAt) return 0

    const operationId = stableOperationId(entityType, entityId, updatedAt, deletedAt)
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
    if (change.entityType === 'user_setting') {
      throw invalidRemotePayload('云端返回了此服务不支持的数据类型。')
    }
    if (change.entityType === 'session' && change.deletedAt !== null) {
      throw new ApplyConflictError({
        entityType: change.entityType,
        entityId: change.entityId,
        reason: 'session-delete-unsupported',
        message: '云端要求删除练习记录，但本机无法在保留历史录音的前提下安全删除。',
      })
    }

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
    await this.applyMaterial(change, state)
  }

  private async applySession(
    change: SyncChange,
    state: SyncEntityState,
  ): Promise<void> {
    const current = await this.storage.getSession(change.entityId)
    this.assertLocalOwner(current?.ownerId, change, current !== null)
    this.assertNotConcurrentlyModified(current?.updatedAt ?? null, state, change)

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

    const remote = parseOwnerlessPayload(
      savedExpressionSchema,
      change,
      this.ownerId,
      { updatedAt: change.updatedAt },
    )
    if (change.deletedAt !== null) {
      await this.storage.deleteExpression(change.entityId)
      return
    }
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

    const remote = parseOwnerlessPayload(
      personalMaterialSchema,
      change,
      this.ownerId,
    )
    if (change.deletedAt !== null) {
      await this.storage.deletePersonalMaterial(change.entityId, this.ownerId)
      // The storage boundary uses a local soft-delete timestamp. Replacing it with
      // the validated cloud tombstone prevents that local implementation detail
      // from being queued back as a new user edit.
      await this.storage.upsertPersonalMaterial(remote)
      return
    }
    await this.storage.upsertPersonalMaterial(remote)
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
    if (localUpdatedAt !== null && localUpdatedAt !== state.syncedUpdatedAt) {
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
  return omitProperty(material, 'ownerId')
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
): string {
  const identity = `${entityType}\u0000${entityId}\u0000${updatedAt}\u0000${deletedAt ?? ''}`
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
