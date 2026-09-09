import { z } from 'zod'

export const cloudSyncEntityTypeSchema = z.enum([
  'session',
  'expression',
  'personal_material',
  'user_setting',
  'imported_question',
  'import_source_metadata',
  'question_exclusion',
  'question_bank_exclusion',
  'knowledge_source',
  'knowledge_entry',
])

export const localDeletionEntityTypeSchema = z.enum([
  'session',
  'expression',
  'question_exclusion',
  'question_bank_exclusion',
  'knowledge_source',
  'knowledge_entry',
])

export const localDeletionTombstoneSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    ownerId: z.string().trim().min(1).max(120),
    entityType: localDeletionEntityTypeSchema,
    entityId: z.string().trim().min(1).max(240),
    deletedAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export const cloudSyncPayloadSchema = z.record(z.string(), z.unknown())

export const syncOutboxOperationSchema = z
  .object({
    operationId: z.string().trim().min(1).max(128),
    entityType: cloudSyncEntityTypeSchema,
    entityId: z.string().trim().min(1).max(128),
    baseVersion: z.number().int().nonnegative(),
    payload: cloudSyncPayloadSchema,
    deletedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export const syncPushItemSchema = syncOutboxOperationSchema.omit({
  createdAt: true,
})

export const syncChangeSchema = z
  .object({
    cursor: z.number().int().positive(),
    entityType: cloudSyncEntityTypeSchema,
    entityId: z.string().trim().min(1).max(128),
    version: z.number().int().positive(),
    payload: cloudSyncPayloadSchema,
    deletedAt: z.iso.datetime({ offset: true }).nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export const syncPushResultSchema = z
  .object({
    operationId: z.string().trim().min(1).max(128),
    entityType: cloudSyncEntityTypeSchema,
    entityId: z.string().trim().min(1).max(128),
    status: z.enum(['applied', 'conflict', 'rejected']),
    version: z.number().int().nonnegative().nullable().optional(),
    cursor: z.number().int().positive().nullable().optional(),
    replayed: z.boolean(),
    code: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    current: syncChangeSchema.nullable().optional(),
  })
  .strict()

export const syncPushResponseSchema = z
  .object({
    // Backend V1 responses carry this compatibility marker. Keep it optional
    // for older self-hosted servers during the migration window, but reject
    // unknown versions instead of silently accepting a different protocol.
    schemaVersion: z.literal(1).optional(),
    results: z.array(syncPushResultSchema),
  })
  .strict()

export const syncPullResponseSchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    changes: z.array(syncChangeSchema),
    nextCursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict()

export type CloudSyncEntityType = z.infer<typeof cloudSyncEntityTypeSchema>
export type LocalDeletionTombstone = z.infer<typeof localDeletionTombstoneSchema>
export type SyncPayload = z.infer<typeof cloudSyncPayloadSchema>
export type SyncOutboxOperation = z.infer<typeof syncOutboxOperationSchema>
export type SyncPushItem = z.infer<typeof syncPushItemSchema>
export type SyncChange = z.infer<typeof syncChangeSchema>
export type SyncPushResult = z.infer<typeof syncPushResultSchema>
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>

export interface CloudSyncGateway {
  push(items: SyncPushItem[]): Promise<SyncPushResponse>
  pull(cursor: number, limit?: number): Promise<SyncPullResponse>
}

export type CloudSyncErrorCode =
  | 'unauthenticated'
  | 'session-expired'
  | 'invalid-input'
  | 'invalid-response'
  | 'network'
  | 'timeout'
  | 'server'
  | 'request-failed'

export class CloudSyncError extends Error {
  readonly code: CloudSyncErrorCode
  readonly retryable: boolean
  readonly status: number | null

  constructor(
    code: CloudSyncErrorCode,
    message: string,
    options: { retryable?: boolean; status?: number | null } = {},
  ) {
    super(message)
    this.name = 'CloudSyncError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.status = options.status ?? null
  }
}
