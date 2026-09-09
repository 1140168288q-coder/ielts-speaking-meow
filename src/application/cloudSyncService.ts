import { z } from 'zod'
import {
  CloudSyncError,
  syncOutboxOperationSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type CloudSyncEntityType,
  type CloudSyncGateway,
  type SyncChange,
  type SyncOutboxOperation,
  type SyncPayload,
  type SyncPushResult,
} from '../domain/cloudSync'
import type { CloudSyncStorage } from '../ports/storage'

const syncScopeSchema = z.string().trim().min(1).max(128)

export interface EnqueueCloudSyncOperation {
  operationId?: string
  entityType: CloudSyncEntityType
  entityId: string
  baseVersion?: number
  payload: SyncPayload
  deletedAt: string | null
  createdAt?: string
}

export interface CloudSyncServiceOptions {
  /** Cloud account user id. It isolates queues and cursors when accounts switch. */
  scopeId: string
  storage: CloudSyncStorage
  gateway: CloudSyncGateway
  applyChange: (change: SyncChange) => Promise<void>
  createOperationId?: () => string
  now?: () => string
}

export interface FlushResult {
  attempted: number
  applied: number
  conflicts: number
  rejected: number
  results: SyncPushResult[]
}

export interface PullResult {
  applied: number
  cursor: number
}

export class CloudSyncService {
  private readonly scopeId: string
  private readonly storage: CloudSyncStorage
  private readonly gateway: CloudSyncGateway
  private readonly applyChange: CloudSyncServiceOptions['applyChange']
  private readonly createOperationId: () => string
  private readonly now: () => string

  constructor(options: CloudSyncServiceOptions) {
    this.scopeId = syncScopeSchema.parse(options.scopeId)
    this.storage = options.storage
    this.gateway = options.gateway
    this.applyChange = options.applyChange
    this.createOperationId =
      options.createOperationId ?? (() => globalThis.crypto.randomUUID())
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async enqueue(input: EnqueueCloudSyncOperation): Promise<SyncOutboxOperation> {
    const entityState = await this.storage.getSyncEntityState(
      this.scopeId,
      input.entityType,
      input.entityId,
    )
    const operation = syncOutboxOperationSchema.parse({
      ...input,
      baseVersion: input.baseVersion ?? entityState.version,
      operationId: input.operationId ?? this.createOperationId(),
      createdAt: input.createdAt ?? this.now(),
    })
    await this.storage.enqueueSyncOperation(this.scopeId, operation)
    return operation
  }

  async flush(limit = 100): Promise<FlushResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new CloudSyncError('invalid-input', '单次推送数量必须在 1–100 之间。')
    }

    const operations = await this.storage.listSyncOperations(this.scopeId, limit)
    if (operations.length === 0) {
      return { attempted: 0, applied: 0, conflicts: 0, rejected: 0, results: [] }
    }

    const response = parsePushResponse(
      await this.gateway.push(operations.map(toPushItem)),
    )
    const results = validatePushResults(operations, response.results)

    for (const result of results) {
      if (result.status === 'applied') {
        const operation = operations.find((item) => item.operationId === result.operationId)
        if (operation && result.version) {
          await this.storage.setSyncEntityState(
            this.scopeId,
            result.entityType,
            result.entityId,
            {
              version: result.version,
              syncedUpdatedAt: readPayloadSyncTimestamp(
                operation.entityType,
                operation.payload,
                operation.createdAt,
                operation.deletedAt,
              ),
            },
          )
        }
        await this.storage.removeSyncOperation(this.scopeId, result.operationId)
      }
    }

    return {
      attempted: operations.length,
      applied: results.filter((result) => result.status === 'applied').length,
      conflicts: results.filter((result) => result.status === 'conflict').length,
      rejected: results.filter((result) => result.status === 'rejected').length,
      results,
    }
  }

  async pull(limit = 200): Promise<PullResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new CloudSyncError('invalid-input', '单次拉取数量必须在 1–500 之间。')
    }

    let cursor = await this.storage.getSyncCursor(this.scopeId)
    let applied = 0
    let hasMore = true

    while (hasMore) {
      const page = parsePullResponse(await this.gateway.pull(cursor, limit))
      validatePullPage(cursor, page, limit)

      for (const change of page.changes) {
        await this.applyChange(change)
        await this.storage.commitPulledSyncChange(
          this.scopeId,
          change,
          {
            version: change.version,
            syncedUpdatedAt: readPayloadSyncTimestamp(
              change.entityType,
              change.payload,
              change.updatedAt,
              change.deletedAt,
            ),
          },
        )
        cursor = change.cursor
        applied += 1
      }

      hasMore = page.hasMore
    }

    return { applied, cursor }
  }
}

function readPayloadSyncTimestamp(
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
  // Exclusion records use createdAt as their schema-compatible base timestamp.
  // Their deletedAt value is the actual mutable state, so include it only when
  // a deletion is active. Restoring an exclusion returns to the original base
  // stamp and therefore queues a distinct operation after a prior deletion.
  if (
    deletedAt === null &&
    (entityType === 'question_exclusion' || entityType === 'question_bank_exclusion')
  ) {
    const payloadDeletedAt = payload.deletedAt
    if (typeof payloadDeletedAt === 'string' && payloadDeletedAt.length > 0) {
      return `${timestamp}|deleted:${payloadDeletedAt}`
    }
  }
  return timestamp
}

function toPushItem(operation: SyncOutboxOperation) {
  return {
    operationId: operation.operationId,
    entityType: operation.entityType,
    entityId: operation.entityId,
    baseVersion: operation.baseVersion,
    payload: operation.payload,
    deletedAt: operation.deletedAt,
  }
}

function validatePushResults(
  operations: SyncOutboxOperation[],
  results: SyncPushResult[],
): SyncPushResult[] {
  const expected = new Map(
    operations.map((operation) => [operation.operationId, operation]),
  )
  const seen = new Set<string>()

  for (const result of results) {
    const operation = expected.get(result.operationId)
    if (
      operation === undefined ||
      seen.has(result.operationId) ||
      result.entityType !== operation.entityType ||
      result.entityId !== operation.entityId ||
      (result.status === 'applied' &&
        (result.version === null ||
          result.version === undefined ||
          result.version < 1 ||
          result.cursor === null ||
          result.cursor === undefined))
    ) {
      throw invalidProtocolResponse()
    }
    seen.add(result.operationId)
  }
  if (seen.size !== expected.size) {
    throw invalidProtocolResponse()
  }
  return results
}

function validatePullPage(
  previousCursor: number,
  page: z.infer<typeof syncPullResponseSchema>,
  limit: number,
): void {
  let cursor = previousCursor
  for (const change of page.changes) {
    if (change.cursor <= cursor) throw invalidProtocolResponse()
    cursor = change.cursor
  }
  if (
    page.changes.length > limit ||
    page.nextCursor !== cursor ||
    (page.hasMore && page.changes.length === 0)
  ) {
    throw invalidProtocolResponse()
  }
}

function parsePushResponse(value: unknown) {
  const parsed = syncPushResponseSchema.safeParse(value)
  if (!parsed.success) throw invalidProtocolResponse()
  return parsed.data
}

function parsePullResponse(value: unknown) {
  const parsed = syncPullResponseSchema.safeParse(value)
  if (!parsed.success) throw invalidProtocolResponse()
  return parsed.data
}

function invalidProtocolResponse(): CloudSyncError {
  return new CloudSyncError(
    'invalid-response',
    '云端同步响应不完整，本地同步状态未被清除。',
    { retryable: true },
  )
}
