import {
  LOCAL_DEFAULT_USER_ID,
  accountProfileSchema,
  backendConfigSchema,
  importedQuestionRecordSchema,
  importSourceSchema,
  isoDateTimeSchema,
  normalizeStoredTrainingSession,
  personalMaterialSchema,
  practiceTextsSchema,
  questionPracticeStateId,
  questionPracticeStateSchema,
  questionExclusionSchema,
  questionBankExclusionSchema,
  recordBelongsToAccount,
  savedExpressionSchema,
  ttsCacheEntrySchema,
  userPreferencesSchema,
  USER_PREFERENCES_VERSION,
  type AccountProfile,
  type BackendConfig,
  type ImportedQuestionRecord,
  type ImportSource,
  type PersonalMaterial,
  type QuestionPracticeState,
  type PracticeTexts,
  type SavedExpression,
  type TrainingSession,
  type TtsCacheEntry,
  type UserPreferences,
  type QuestionExclusion,
  type QuestionBankExclusion,
} from '../../domain'
import {
  localDeletionTombstoneSchema,
  type SyncChange,
  syncChangeSchema,
  syncOutboxOperationSchema,
  type CloudSyncEntityType,
  type LocalDeletionTombstone,
  type SyncOutboxOperation,
} from '../../domain/cloudSync'
import type { AccountStorage } from '../../ports/accounts'
import type { BackendConfigStorage } from '../../ports/backend'
import type {
  ImportBundle,
  ImportQuestionBankReplacement,
  ImportStorage,
  TtsCacheStorage,
} from '../../ports/imports'
import type { UserKnowledgeStorage } from '../../ports/userKnowledge'
import type { QuestionManagementStorage } from '../../ports/questionManagement'
import {
  userKnowledgeEntrySchema,
  userKnowledgeSourceSchema,
  type UserKnowledgeDraft,
  type UserKnowledgeEntry,
  type UserKnowledgeSource,
} from '../../domain/userKnowledge'
import type {
  AudioStorage,
  CloudSyncStorage,
  SyncEntityState,
  ListPersonalMaterialsOptions,
  LocalDataMaintenance,
  LocalStorage,
  StorageUsageSummary,
} from '../../ports/storage'

const DATABASE_VERSION = 9
const DEFAULT_DATABASE_NAME = 'ielts-speaking-meow'
const MAX_TTS_CACHE_ENTRIES = 40
const MAX_TTS_CACHE_BYTES = 25 * 1024 * 1024

/**
 * apiConfigurations 是 V1.1 遗留 store:自 Backend 化后不再读写,但保留
 * 建表以兼容既有用户数据(不主动删除用户历史配置)。
 */
const STORES = {
  sessions: 'sessions',
  expressions: 'expressions',
  audio: 'audio',
  importSources: 'importSources',
  importedQuestions: 'importedQuestions',
  importedFiles: 'importedFiles',
  userKnowledgeSources: 'userKnowledgeSources',
  userKnowledgeEntries: 'userKnowledgeEntries',
  userKnowledgeFiles: 'userKnowledgeFiles',
  apiConfigurations: 'apiConfigurations',
  ttsCache: 'ttsCache',
  backendConfig: 'backendConfig',
  appMeta: 'appMeta',
  accounts: 'accounts',
  personalMaterials: 'personalMaterials',
  deletionTombstones: 'deletionTombstones',
  syncOutbox: 'syncOutbox',
  syncState: 'syncState',
} as const

const PERSONAL_MATERIAL_INDEXES = {
  ownerId: 'ownerId',
  updatedAt: 'updatedAt',
} as const

const SYNC_OUTBOX_INDEXES = {
  scopeId: 'scopeId',
} as const

const DELETION_TOMBSTONE_INDEXES = {
  ownerId: 'ownerId',
} as const

type StoreName = (typeof STORES)[keyof typeof STORES]

interface StoredAudio {
  id: string
  blob: Blob
}

interface StoredFile {
  id: string
  blob: Blob
}

interface StoredTtsCache extends TtsCacheEntry {
  audio: Blob
}

interface StoredSyncOutboxOperation extends SyncOutboxOperation {
  id: string
  scopeId: string
}

interface StoredSyncState {
  id: string
  scopeId: string
  cursor: number
  entities: Record<string, SyncEntityState>
}

export interface IndexedDbStorageOptions {
  databaseName?: string
  indexedDb?: IDBFactory
}

/**
 * IndexedDB-backed storage for local-first practice data and original audio.
 *
 * The adapter has no implicit deletion or recovery cleanup. A failed read or
 * write rejects that operation while leaving all previously committed records
 * untouched.
 */
export class IndexedDbStorage
  implements
    LocalStorage,
    AudioStorage,
    ImportStorage,
    TtsCacheStorage,
    BackendConfigStorage,
    AccountStorage,
    CloudSyncStorage,
    LocalDataMaintenance,
    UserKnowledgeStorage,
    QuestionManagementStorage
{
  private readonly databaseName: string
  private readonly indexedDb: IDBFactory
  private databasePromise: Promise<IDBDatabase> | undefined

  constructor(options: IndexedDbStorageOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME

    const indexedDb = options.indexedDb ?? globalThis.indexedDB
    if (indexedDb === undefined) {
      throw new Error('IndexedDB is unavailable in this environment.')
    }

    this.indexedDb = indexedDb
  }

  async upsertSession(session: TrainingSession): Promise<void> {
    assertStorageKey(session.id, 'Session')
    await this.put(STORES.sessions, session)
  }

  async updateSessionAtomically(
    sessionId: string,
    updater: (session: TrainingSession | null) => TrainingSession | null,
  ): Promise<TrainingSession | null> {
    assertStorageKey(sessionId, 'Session')
    const database = await this.getDatabase()

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORES.sessions, 'readwrite')
      const store = transaction.objectStore(STORES.sessions)
      const request = store.get(sessionId)
      let updated: TrainingSession | null = null

      request.onsuccess = () => {
        try {
          const current = request.result === undefined
            ? null
            : normalizeStoredTrainingSession(request.result)
          updated = updater(current)
          if (updated !== null) {
            store.put(updated)
          }
        } catch (error) {
          transaction.abort()
          reject(toError(error))
        }
      }
      request.onerror = () => {
        reject(request.error ?? new Error('Unable to read the session.'))
      }
      transaction.oncomplete = () => resolve(updated)
      transaction.onabort = () => {
        reject(transaction.error ?? new Error('Session update aborted.'))
      }
      transaction.onerror = () => {
        reject(transaction.error ?? new Error('Session update failed.'))
      }
    })
  }

  async getSession(sessionId: string): Promise<TrainingSession | null> {
    assertStorageKey(sessionId, 'Session')
    const value = await this.get<unknown>(STORES.sessions, sessionId)
    return value === null ? null : normalizeStoredTrainingSession(value)
  }

  async listSessions(): Promise<TrainingSession[]> {
    const values = await this.getAll<unknown>(STORES.sessions)
    const validValues: TrainingSession[] = []
    for (const value of values) {
      const parsed = normalizeStoredTrainingSession(value)
      if (parsed !== null) {
        validValues.push(parsed)
      }
    }
    return validValues
  }

  async listQuestionPracticeStates(ownerId: string): Promise<QuestionPracticeState[]> {
    assertStorageKey(ownerId, 'Question practice owner')
    const values = await this.getAll<unknown>(STORES.appMeta)
    return values.flatMap((value) => {
      const parsed = questionPracticeStateSchema.safeParse(value)
      return parsed.success && parsed.data.ownerId === ownerId ? [parsed.data] : []
    })
  }

  async saveQuestionPracticeState(state: QuestionPracticeState): Promise<void> {
    const parsed = questionPracticeStateSchema.parse(state)
    await this.put(STORES.appMeta, {
      ...parsed,
      id: questionPracticeStateId(parsed.ownerId, parsed.questionId),
    })
  }

  async listQuestionExclusions(
    ownerId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<QuestionExclusion[]> {
    assertStorageKey(ownerId, 'Question exclusion owner')
    return (await this.getAll<unknown>(STORES.appMeta)).flatMap((value) => {
      const parsed = questionExclusionSchema.safeParse(value)
      return parsed.success && parsed.data.ownerId === ownerId &&
        (options.includeDeleted === true || parsed.data.deletedAt === null)
        ? [parsed.data]
        : []
    })
  }

  async listQuestionBankExclusions(
    ownerId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<QuestionBankExclusion[]> {
    assertStorageKey(ownerId, 'Question bank exclusion owner')
    return (await this.getAll<unknown>(STORES.appMeta)).flatMap((value) => {
      const parsed = questionBankExclusionSchema.safeParse(value)
      return parsed.success && parsed.data.ownerId === ownerId &&
        (options.includeDeleted === true || parsed.data.deletedAt === null)
        ? [parsed.data]
        : []
    })
  }

  async saveQuestionExclusion(exclusion: QuestionExclusion): Promise<void> {
    const parsed = questionExclusionSchema.parse(exclusion)
    const database = await this.getDatabase()
    const transaction = database.transaction(
      [STORES.appMeta, STORES.deletionTombstones],
      'readwrite',
    )
    const requests = [
      requestResult(transaction.objectStore(STORES.appMeta).put(parsed)),
      // Exclusions carry their mutable deletedAt state in the synced entity
      // itself. Do not create a second generic tombstone operation, which would
      // lose the strict exclusion payload on another device.
      requestResult(transaction.objectStore(STORES.deletionTombstones).delete(
        localDeletionTombstoneId(parsed.ownerId, 'question_exclusion', parsed.questionId),
      )),
    ]
    await Promise.all([...requests, transactionComplete(transaction)])
  }

  async saveQuestionBankExclusion(exclusion: QuestionBankExclusion): Promise<void> {
    const parsed = questionBankExclusionSchema.parse(exclusion)
    const database = await this.getDatabase()
    const transaction = database.transaction(
      [STORES.appMeta, STORES.deletionTombstones],
      'readwrite',
    )
    const requests = [
      requestResult(transaction.objectStore(STORES.appMeta).put(parsed)),
      requestResult(transaction.objectStore(STORES.deletionTombstones).delete(
        localDeletionTombstoneId(
          parsed.ownerId,
          'question_bank_exclusion',
          parsed.bankFingerprint,
        ),
      )),
    ]
    await Promise.all([...requests, transactionComplete(transaction)])
  }

  async saveQuestionBankState(
    bankExclusion: QuestionBankExclusion,
    questionExclusions: QuestionExclusion[],
  ): Promise<void> {
    const bank = questionBankExclusionSchema.parse(bankExclusion)
    const exclusions = questionExclusions.map((exclusion) => questionExclusionSchema.parse(exclusion))
    if (exclusions.some((exclusion) =>
      exclusion.ownerId !== bank.ownerId || exclusion.deletedAt !== null,
    )) {
      throw new Error('题库批量排除状态无效。')
    }
    const uniqueExclusions = Array.from(new Map(exclusions.map((exclusion) => [exclusion.id, exclusion])).values())
    const database = await this.getDatabase()
    const transaction = database.transaction(
      [STORES.appMeta, STORES.deletionTombstones],
      'readwrite',
    )
    const appMetaStore = transaction.objectStore(STORES.appMeta)
    const tombstoneStore = transaction.objectStore(STORES.deletionTombstones)
    const requests: Promise<unknown>[] = [
      requestResult(appMetaStore.put(bank)),
      requestResult(tombstoneStore.delete(localDeletionTombstoneId(
        bank.ownerId,
        'question_bank_exclusion',
        bank.bankFingerprint,
      ))),
    ]
    for (const exclusion of uniqueExclusions) {
      requests.push(requestResult(appMetaStore.put(exclusion)))
      requests.push(requestResult(tombstoneStore.delete(localDeletionTombstoneId(
        exclusion.ownerId,
        'question_exclusion',
        exclusion.questionId,
      ))))
    }
    await Promise.all([...requests, transactionComplete(transaction)])
  }

  async saveQuestionExclusions(exclusions: QuestionExclusion[]): Promise<void> {
    const parsed = exclusions.map((exclusion) => questionExclusionSchema.parse(exclusion))
    if (parsed.length === 0) return
    const ownerId = parsed[0]!.ownerId
    if (parsed.some((exclusion) => exclusion.ownerId !== ownerId || exclusion.deletedAt !== null)) {
      throw new Error('题目批量排除状态无效。')
    }
    const uniqueExclusions = Array.from(new Map(parsed.map((exclusion) => [exclusion.id, exclusion])).values())
    const database = await this.getDatabase()
    const transaction = database.transaction(
      [STORES.appMeta, STORES.deletionTombstones],
      'readwrite',
    )
    const appMetaStore = transaction.objectStore(STORES.appMeta)
    const tombstoneStore = transaction.objectStore(STORES.deletionTombstones)
    const requests: Promise<unknown>[] = []
    for (const exclusion of uniqueExclusions) {
      requests.push(requestResult(appMetaStore.put(exclusion)))
      requests.push(requestResult(tombstoneStore.delete(localDeletionTombstoneId(
        exclusion.ownerId,
        'question_exclusion',
        exclusion.questionId,
      ))))
    }
    await Promise.all([...requests, transactionComplete(transaction)])
  }

  async upsertExpression(expression: SavedExpression): Promise<void> {
    assertStorageKey(expression.id, 'Expression')
    await this.put(STORES.expressions, expression)
  }

  async getExpression(expressionId: string): Promise<SavedExpression | null> {
    assertStorageKey(expressionId, 'Expression')
    return this.getParsed(
      STORES.expressions,
      expressionId,
      savedExpressionSchema,
    )
  }

  async listExpressions(): Promise<SavedExpression[]> {
    return this.getAllParsed(STORES.expressions, savedExpressionSchema)
  }

  async deleteExpression(
    expressionId: string,
    ownerId: string,
    deletedAt: string | null,
  ): Promise<void> {
    assertStorageKey(expressionId, 'Expression')
    assertStorageKey(ownerId, 'Expression owner')
    const database = await this.getDatabase()

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [STORES.expressions, STORES.deletionTombstones],
        'readwrite',
      )
      const expressions = transaction.objectStore(STORES.expressions)
      const request = expressions.get(expressionId)
      request.onsuccess = () => {
        try {
          const parsed = savedExpressionSchema.safeParse(request.result)
          if (
            !parsed.success ||
            !recordBelongsToAccount(parsed.data.ownerId, ownerId)
          ) {
            throw new Error('Saved expression not found.')
          }
          if (deletedAt !== null) {
            transaction.objectStore(STORES.deletionTombstones).put(
              createLocalDeletionTombstone(
                ownerId,
                'expression',
                expressionId,
                deletedAt,
              ),
            )
          }
          expressions.delete(expressionId)
        } catch (error) {
          transaction.abort()
          reject(toError(error))
        }
      }
      request.onerror = () =>
        reject(request.error ?? new Error('Unable to read the expression.'))
      transaction.oncomplete = () => resolve()
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Expression deletion aborted.'))
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Expression deletion failed.'))
    })
  }

  async upsertPersonalMaterial(material: PersonalMaterial): Promise<void> {
    const parsed = personalMaterialSchema.parse(material)
    assertStorageKey(parsed.id, 'Personal material')
    await this.put(STORES.personalMaterials, parsed)
  }

  async getPersonalMaterial(
    materialId: string,
    ownerId: string,
  ): Promise<PersonalMaterial | null> {
    assertStorageKey(materialId, 'Personal material')
    assertStorageKey(ownerId, 'Personal material owner')
    const material = await this.getParsed(
      STORES.personalMaterials,
      materialId,
      personalMaterialSchema,
    )
    return material?.ownerId === ownerId ? material : null
  }

  async listPersonalMaterials(
    ownerId: string,
    options: ListPersonalMaterialsOptions = {},
  ): Promise<PersonalMaterial[]> {
    assertStorageKey(ownerId, 'Personal material owner')
    const values = await this.getAllByIndex<unknown>(
      STORES.personalMaterials,
      PERSONAL_MATERIAL_INDEXES.ownerId,
      ownerId,
    )
    const materials: PersonalMaterial[] = []

    for (const value of values) {
      const parsed = personalMaterialSchema.safeParse(value)
      if (
        parsed.success &&
        parsed.data.ownerId === ownerId &&
        (options.includeDeleted === true || parsed.data.deletedAt === null)
      ) {
        materials.push(parsed.data)
      }
    }

    return materials.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
  }

  async deletePersonalMaterial(
    materialId: string,
    ownerId: string,
    deletedAt: string,
  ): Promise<void> {
    assertStorageKey(materialId, 'Personal material')
    assertStorageKey(ownerId, 'Personal material owner')
    const database = await this.getDatabase()

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        STORES.personalMaterials,
        'readwrite',
      )
      const store = transaction.objectStore(STORES.personalMaterials)
      const request = store.get(materialId)
      request.onsuccess = () => {
        try {
          const parsed = personalMaterialSchema.safeParse(request.result)
          if (!parsed.success || parsed.data.ownerId !== ownerId) {
            throw new Error('个人素材不存在，或不属于当前账号。')
          }
          if (parsed.data.deletedAt === deletedAt) return
          store.put(personalMaterialSchema.parse({
            ...parsed.data,
            updatedAt: deletedAt,
            version: parsed.data.version + 1,
            deletedAt,
          }))
        } catch (error) {
          transaction.abort()
          reject(toError(error))
        }
      }
      request.onerror = () =>
        reject(request.error ?? new Error('Unable to read personal material.'))
      transaction.oncomplete = () => resolve()
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Personal material deletion aborted.'))
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Personal material deletion failed.'))
    })
  }

  async listLocalDeletionTombstones(
    ownerId: string,
  ): Promise<LocalDeletionTombstone[]> {
    assertStorageKey(ownerId, 'Deletion tombstone owner')
    const values = await this.getAllByIndex<unknown>(
      STORES.deletionTombstones,
      DELETION_TOMBSTONE_INDEXES.ownerId,
      ownerId,
    )
    return values.flatMap((value) => {
      const parsed = localDeletionTombstoneSchema.safeParse(value)
      return parsed.success && parsed.data.ownerId === ownerId
        ? [parsed.data]
        : []
    })
  }

  async removeLocalDeletionTombstone(
    ownerId: string,
    entityType: LocalDeletionTombstone['entityType'],
    entityId: string,
  ): Promise<void> {
    assertStorageKey(ownerId, 'Deletion tombstone owner')
    assertStorageKey(entityId, 'Deletion tombstone entity')
    await this.delete(
      STORES.deletionTombstones,
      localDeletionTombstoneId(ownerId, entityType, entityId),
    )
  }

  async getPracticeTexts(): Promise<PracticeTexts | null> {
    const record = await this.get<unknown>(STORES.appMeta, 'practiceTexts')
    if (record === null || typeof record !== 'object') {
      return null
    }
    // appMeta 记录自带 keyPath 的 id 字段,解析前剥离,避免 strict schema 拒绝。
    const stored = record as Record<string, unknown>
    const parsed = practiceTextsSchema.safeParse({
      top: stored.top,
      middle: stored.middle,
      bottom: stored.bottom,
    })
    return parsed.success ? parsed.data : null
  }

  async savePracticeTexts(texts: PracticeTexts): Promise<void> {
    const parsed = practiceTextsSchema.parse(texts)
    await this.put(STORES.appMeta, { id: 'practiceTexts', ...parsed })
  }

  async getUserPreferences(ownerId: string): Promise<UserPreferences | null> {
    assertStorageKey(ownerId, 'User preferences owner')
    const record = await this.get<unknown>(
      STORES.appMeta,
      ['userPreferences', ownerId].join(':'),
    )
    if (record === null || typeof record !== 'object') return null
    const stored = record as Record<string, unknown>
    const parsed = userPreferencesSchema.safeParse({
      // Version is a storage migration marker. Parse legacy records with the
      // current schema so newly added defaults do not make startup fail.
      version: USER_PREFERENCES_VERSION,
      ownerId: stored.ownerId,
      theme: stored.theme,
      ttsVoicePreset: stored.ttsVoicePreset ?? 'backend-default',
      ttsVoiceMode: stored.ttsVoiceMode,
      ttsRate: stored.ttsRate,
      ttsPitch: stored.ttsPitch ?? 1,
      autoPlayQuestion: stored.autoPlayQuestion,
      defaultPart: stored.defaultPart,
      feedbackDetail: stored.feedbackDetail,
      memoryEnabled: stored.memoryEnabled,
      autoMatchPersonalMaterialsWithAi:
        stored.autoMatchPersonalMaterialsWithAi ??
        stored.sharePersonalMaterialsWithAi ??
        true,
      naturalUpgradeLevel: stored.naturalUpgradeLevel ?? 'medium',
      spokenEnglishStyle: stored.spokenEnglishStyle ?? 'british',
      reduceMotion: stored.reduceMotion,
      homeTitleOverride: stored.homeTitleOverride ?? null,
      homeSubtitleOverride: stored.homeSubtitleOverride ?? null,
      updatedAt: stored.updatedAt,
    })
    return parsed.success && parsed.data.ownerId === ownerId ? parsed.data : null
  }

  async saveUserPreferences(preferences: UserPreferences): Promise<void> {
    const parsed = userPreferencesSchema.parse(preferences)
    await this.put(STORES.appMeta, {
      id: ['userPreferences', parsed.ownerId].join(':'),
      ...parsed,
    })
  }

  async listUserPreferences(): Promise<UserPreferences[]> {
    return (await this.getAll<unknown>(STORES.appMeta)).flatMap((value) => {
      if (typeof value !== 'object' || value === null) return []
      const stored = value as Record<string, unknown>
      if (typeof stored.id !== 'string' || !stored.id.startsWith('userPreferences:')) return []
      const parsed = userPreferencesSchema.safeParse({
        version: USER_PREFERENCES_VERSION,
        ownerId: stored.ownerId,
        theme: stored.theme,
        ttsVoicePreset: stored.ttsVoicePreset ?? 'backend-default',
        ttsVoiceMode: stored.ttsVoiceMode,
        ttsRate: stored.ttsRate,
        ttsPitch: stored.ttsPitch ?? 1,
        autoPlayQuestion: stored.autoPlayQuestion,
        defaultPart: stored.defaultPart,
        feedbackDetail: stored.feedbackDetail,
        memoryEnabled: stored.memoryEnabled,
        autoMatchPersonalMaterialsWithAi:
          stored.autoMatchPersonalMaterialsWithAi ??
          stored.sharePersonalMaterialsWithAi ??
          true,
        naturalUpgradeLevel: stored.naturalUpgradeLevel ?? 'medium',
        spokenEnglishStyle: stored.spokenEnglishStyle ?? 'british',
        reduceMotion: stored.reduceMotion,
        homeTitleOverride: stored.homeTitleOverride ?? null,
        homeSubtitleOverride: stored.homeSubtitleOverride ?? null,
        updatedAt: stored.updatedAt,
      })
      return parsed.success ? [parsed.data] : []
    })
  }

  async enqueueSyncOperation(
    scopeId: string,
    operation: SyncOutboxOperation,
  ): Promise<'created' | 'already-enqueued'> {
    assertStorageKey(scopeId, 'Sync scope')
    const parsed = syncOutboxOperationSchema.parse(operation)
    const id = syncRecordId(scopeId, parsed.operationId)
    const record: StoredSyncOutboxOperation = { id, scopeId, ...parsed }
    const database = await this.getDatabase()

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORES.syncOutbox, 'readwrite')
      const store = transaction.objectStore(STORES.syncOutbox)
      const request = store.get(id)
      let outcome: 'created' | 'already-enqueued' = 'already-enqueued'

      request.onsuccess = () => {
        try {
          if (request.result === undefined) {
            outcome = 'created'
            store.put(record)
            return
          }
          const existing = parseStoredSyncOperation(request.result, scopeId)
          if (!sameSyncOperation(existing, parsed)) {
            throw new Error(
              'Sync operationId is already used by a different operation.',
            )
          }
        } catch (error) {
          transaction.abort()
          reject(toError(error))
        }
      }
      request.onerror = () => {
        reject(request.error ?? new Error('Unable to read the sync outbox.'))
      }
      transaction.oncomplete = () => resolve(outcome)
      transaction.onabort = () => {
        reject(transaction.error ?? new Error('Sync outbox transaction aborted.'))
      }
      transaction.onerror = () => {
        reject(transaction.error ?? new Error('Sync outbox transaction failed.'))
      }
    })
  }

  async listSyncOperations(
    scopeId: string,
    limit = 100,
  ): Promise<SyncOutboxOperation[]> {
    assertStorageKey(scopeId, 'Sync scope')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Sync outbox limit must be between 1 and 100.')
    }
    const records = await this.getAllByIndex<unknown>(
      STORES.syncOutbox,
      SYNC_OUTBOX_INDEXES.scopeId,
      scopeId,
    )
    return records
      .map((record) => parseStoredSyncOperation(record, scopeId))
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.operationId.localeCompare(right.operationId),
      )
      .slice(0, limit)
  }

  async removeSyncOperation(
    scopeId: string,
    operationId: string,
  ): Promise<void> {
    assertStorageKey(scopeId, 'Sync scope')
    assertStorageKey(operationId, 'Sync operation')
    await this.delete(STORES.syncOutbox, syncRecordId(scopeId, operationId))
  }

  async getSyncCursor(scopeId: string): Promise<number> {
    assertStorageKey(scopeId, 'Sync scope')
    const id = syncStateId(scopeId)
    const record = await this.get<unknown>(STORES.syncState, id)
    if (record === null) return 0
    return parseStoredSyncState(record, scopeId).cursor
  }

  async getSyncEntityState(
    scopeId: string,
    entityType: CloudSyncEntityType,
    entityId: string,
  ): Promise<SyncEntityState> {
    assertStorageKey(scopeId, 'Sync scope')
    assertStorageKey(entityId, 'Sync entity')
    const record = await this.get<unknown>(STORES.syncState, syncStateId(scopeId))
    if (record === null) return { version: 0, syncedUpdatedAt: null }
    return parseStoredSyncState(record, scopeId).entities[syncEntityStateKey(entityType, entityId)] ?? {
      version: 0,
      syncedUpdatedAt: null,
    }
  }

  async setSyncEntityState(
    scopeId: string,
    entityType: CloudSyncEntityType,
    entityId: string,
    state: SyncEntityState,
  ): Promise<void> {
    assertStorageKey(scopeId, 'Sync scope')
    assertStorageKey(entityId, 'Sync entity')
    if (!Number.isSafeInteger(state.version) || state.version < 0) {
      throw new Error('Sync entity version must be a non-negative integer.')
    }
    const id = syncStateId(scopeId)
    const database = await this.getDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORES.syncState, 'readwrite')
      const store = transaction.objectStore(STORES.syncState)
      const request = store.get(id)
      request.onsuccess = () => {
        try {
          const current = request.result === undefined
            ? { id, scopeId, cursor: 0, entities: {} }
            : parseStoredSyncState(request.result, scopeId)
          store.put({
            ...current,
            entities: {
              ...current.entities,
              [syncEntityStateKey(entityType, entityId)]: state,
            },
          } satisfies StoredSyncState)
        } catch (error) {
          transaction.abort()
          reject(toError(error))
        }
      }
      request.onerror = () => reject(request.error ?? new Error('Unable to read sync entity state.'))
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('Sync entity state transaction aborted.'))
      transaction.onerror = () => reject(transaction.error ?? new Error('Sync entity state transaction failed.'))
    })
  }

  async commitPulledSyncChange(
    scopeId: string,
    change: SyncChange,
    state: SyncEntityState,
  ): Promise<void> {
    assertStorageKey(scopeId, 'Sync scope')
    const parsedChange = syncChangeSchema.parse(change)
    if (
      state.version !== parsedChange.version ||
      !Number.isSafeInteger(state.version) ||
      state.version < 1
    ) {
      throw new Error('Pulled sync entity state is inconsistent.')
    }
    const id = syncStateId(scopeId)
    const database = await this.getDatabase()

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORES.syncState, 'readwrite')
      const store = transaction.objectStore(STORES.syncState)
      const request = store.get(id)
      request.onsuccess = () => {
        try {
          const current = request.result === undefined
            ? { id, scopeId, cursor: 0, entities: {} }
            : parseStoredSyncState(request.result, scopeId)
          if (parsedChange.cursor < current.cursor) {
            throw new Error('Sync cursor cannot move backwards.')
          }
          store.put({
            ...current,
            cursor: parsedChange.cursor,
            entities: {
              ...current.entities,
              [syncEntityStateKey(
                parsedChange.entityType,
                parsedChange.entityId,
              )]: state,
            },
          } satisfies StoredSyncState)
        } catch (error) {
          transaction.abort()
          reject(toError(error))
        }
      }
      request.onerror = () =>
        reject(request.error ?? new Error('Unable to read pulled sync state.'))
      transaction.oncomplete = () => resolve()
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Pulled sync commit aborted.'))
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Pulled sync commit failed.'))
    })
  }

  async setSyncCursor(scopeId: string, cursor: number): Promise<void> {
    assertStorageKey(scopeId, 'Sync scope')
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new Error('Sync cursor must be a non-negative integer.')
    }
    const id = syncStateId(scopeId)
    const database = await this.getDatabase()

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORES.syncState, 'readwrite')
      const store = transaction.objectStore(STORES.syncState)
      const request = store.get(id)

      request.onsuccess = () => {
        try {
          const current = request.result === undefined
            ? 0
            : parseStoredSyncState(request.result, scopeId).cursor
          if (cursor < current) {
            throw new Error('Sync cursor cannot move backwards.')
          }
          const entities = request.result === undefined
            ? {}
            : parseStoredSyncState(request.result, scopeId).entities
          store.put({ id, scopeId, cursor, entities } satisfies StoredSyncState)
        } catch (error) {
          transaction.abort()
          reject(toError(error))
        }
      }
      request.onerror = () => {
        reject(request.error ?? new Error('Unable to read the sync cursor.'))
      }
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => {
        reject(transaction.error ?? new Error('Sync cursor transaction aborted.'))
      }
      transaction.onerror = () => {
        reject(transaction.error ?? new Error('Sync cursor transaction failed.'))
      }
    })
  }

  async upsertAccount(account: AccountProfile): Promise<void> {
    assertStorageKey(account.id, 'Account')
    await this.put(STORES.accounts, accountProfileSchema.parse(account))
  }

  async getAccount(accountId: string): Promise<AccountProfile | null> {
    assertStorageKey(accountId, 'Account')
    return this.getParsed(STORES.accounts, accountId, accountProfileSchema)
  }

  async listAccounts(): Promise<AccountProfile[]> {
    return this.getAllParsed(STORES.accounts, accountProfileSchema)
  }

  async getCurrentAccountId(): Promise<string | null> {
    const record = await this.get<{ id: string; value: string }>(
      STORES.appMeta,
      'currentAccountId',
    )
    return record === null || typeof record.value !== 'string'
      ? null
      : record.value
  }

  async setCurrentAccountId(accountId: string): Promise<void> {
    assertStorageKey(accountId, 'Account')
    await this.put(STORES.appMeta, { id: 'currentAccountId', value: accountId })
  }

  async saveAudio(audioId: string, audio: Blob): Promise<void> {
    assertStorageKey(audioId, 'Audio')
    const record: StoredAudio = { id: audioId, blob: audio }
    await this.put(STORES.audio, record)
  }

  async getAudio(audioId: string): Promise<Blob | null> {
    assertStorageKey(audioId, 'Audio')
    const record = await this.get<StoredAudio>(STORES.audio, audioId)
    return record?.blob ?? null
  }

  async hasAudio(audioId: string): Promise<boolean> {
    assertStorageKey(audioId, 'Audio')

    const database = await this.getDatabase()
    const transaction = database.transaction(STORES.audio, 'readonly')
    const request = transaction.objectStore(STORES.audio).count(audioId)
    const [count] = await Promise.all([
      requestResult(request),
      transactionComplete(transaction),
    ])

    return count > 0
  }

  /** Delete audio only in response to an explicit application/user action. */
  async deleteAudio(audioId: string): Promise<void> {
    assertStorageKey(audioId, 'Audio')

    const database = await this.getDatabase()
    const transaction = database.transaction(STORES.audio, 'readwrite')
    const request = transaction.objectStore(STORES.audio).delete(audioId)
    await Promise.all([requestResult(request), transactionComplete(transaction)])
  }

  async saveImportBundle(bundle: ImportBundle): Promise<void> {
    const source = importSourceSchema.parse(bundle.source)
    const questions = bundle.questions.map((question) =>
      importedQuestionRecordSchema.parse(question),
    )

    if (source.fileSize !== bundle.originalFile.size) {
      throw new Error('Imported file size does not match its metadata.')
    }
    if (questions.some((question) => question.sourceId !== source.id)) {
      throw new Error('Every imported question must reference its source.')
    }

    const database = await this.getDatabase()
    const transaction = database.transaction(
      [STORES.importSources, STORES.importedFiles, STORES.importedQuestions],
      'readwrite',
    )
    const requests: Promise<unknown>[] = [
      requestResult(transaction.objectStore(STORES.importSources).put(source)),
      requestResult(
        transaction.objectStore(STORES.importedFiles).put({
          id: source.originalFileId,
          blob: bundle.originalFile,
        } satisfies StoredFile),
      ),
      ...questions.map((question) =>
        requestResult(
          transaction.objectStore(STORES.importedQuestions).put(question),
        ),
      ),
    ]

    await Promise.all([...requests, transactionComplete(transaction)])
  }

  async saveImportBundleAndReplaceQuestionBank(
    bundle: ImportBundle,
    replacement: ImportQuestionBankReplacement,
  ): Promise<void> {
    const source = importSourceSchema.parse(bundle.source)
    const questions = bundle.questions.map((question) =>
      importedQuestionRecordSchema.parse(question),
    )
    const bankExclusion = questionBankExclusionSchema.parse(replacement.bankExclusion)
    const questionExclusions = replacement.questionExclusions.map((exclusion) =>
      questionExclusionSchema.parse(exclusion),
    )
    if (bankExclusion.deletedAt !== null) {
      throw new Error('换季题库排除状态必须是当前生效状态。')
    }
    if (source.fileSize !== bundle.originalFile.size) {
      throw new Error('Imported file size does not match its metadata.')
    }
    if (questions.some((question) => question.sourceId !== source.id)) {
      throw new Error('Every imported question must reference its source.')
    }
    if (questionExclusions.some((exclusion) =>
      exclusion.ownerId !== bankExclusion.ownerId ||
      exclusion.questionSource !== 'imported' ||
      exclusion.reason !== 'clear-all' ||
      exclusion.deletedAt !== null,
    )) {
      throw new Error('换季题库排除状态无效。')
    }

    const uniqueQuestionExclusions = Array.from(
      new Map(questionExclusions.map((exclusion) => [exclusion.id, exclusion])).values(),
    )
    const database = await this.getDatabase()
    const transaction = database.transaction(
      [
        STORES.importSources,
        STORES.importedFiles,
        STORES.importedQuestions,
        STORES.appMeta,
        STORES.deletionTombstones,
      ],
      'readwrite',
    )
    const sourceStore = transaction.objectStore(STORES.importSources)
    const fileStore = transaction.objectStore(STORES.importedFiles)
    const questionStore = transaction.objectStore(STORES.importedQuestions)
    const appMetaStore = transaction.objectStore(STORES.appMeta)
    const tombstoneStore = transaction.objectStore(STORES.deletionTombstones)
    const requests: Promise<unknown>[] = [
      requestResult(sourceStore.put(source)),
      requestResult(fileStore.put({ id: source.originalFileId, blob: bundle.originalFile } satisfies StoredFile)),
      ...questions.map((question) => requestResult(questionStore.put(question))),
      requestResult(appMetaStore.put(bankExclusion)),
      requestResult(tombstoneStore.delete(localDeletionTombstoneId(
        bankExclusion.ownerId,
        'question_bank_exclusion',
        bankExclusion.bankFingerprint,
      ))),
    ]
    for (const exclusion of uniqueQuestionExclusions) {
      requests.push(requestResult(appMetaStore.put(exclusion)))
      requests.push(requestResult(tombstoneStore.delete(localDeletionTombstoneId(
        exclusion.ownerId,
        'question_exclusion',
        exclusion.questionId,
      ))))
    }
    await Promise.all([...requests, transactionComplete(transaction)])
  }

  async getImportSource(sourceId: string): Promise<ImportSource | null> {
    assertStorageKey(sourceId, 'Import source')
    return this.getParsed(STORES.importSources, sourceId, importSourceSchema)
  }

  async listImportSources(): Promise<ImportSource[]> {
    return this.getAllParsed(STORES.importSources, importSourceSchema)
  }

  async upsertImportSourceMetadata(source: ImportSource): Promise<void> {
    await this.put(STORES.importSources, importSourceSchema.parse(source))
  }

  async upsertImportedQuestion(record: ImportedQuestionRecord): Promise<void> {
    await this.put(STORES.importedQuestions, importedQuestionRecordSchema.parse(record))
  }

  async getImportedFile(fileId: string): Promise<Blob | null> {
    assertStorageKey(fileId, 'Imported file')
    const storedFile = await this.get<StoredFile>(STORES.importedFiles, fileId)
    return storedFile?.blob instanceof Blob ? storedFile.blob : null
  }

  async listImportedQuestions(ownerId: string): Promise<ImportedQuestionRecord[]> {
    assertStorageKey(ownerId, 'Imported question owner')
    const records = await this.getAllParsed(
      STORES.importedQuestions,
      importedQuestionRecordSchema,
    )
    const migrated: ImportedQuestionRecord[] = []
    const visible = records.flatMap((record) => {
      if (!recordBelongsToAccount(record.ownerId, ownerId)) return []
      if (
        record.ownerId === undefined &&
        ownerId === LOCAL_DEFAULT_USER_ID
      ) {
        const normalized = importedQuestionRecordSchema.parse({
          ...record,
          ownerId: LOCAL_DEFAULT_USER_ID,
        })
        migrated.push(normalized)
        return [normalized]
      }
      return [record]
    })

    if (migrated.length > 0) {
      const database = await this.getDatabase()
      const transaction = database.transaction(
        STORES.importedQuestions,
        'readwrite',
      )
      const store = transaction.objectStore(STORES.importedQuestions)
      const requests = migrated.map((record) => requestResult(store.put(record)))
      await Promise.all([...requests, transactionComplete(transaction)])
    }
    return visible
  }

  async saveUserKnowledgeBundle(bundle: UserKnowledgeDraft): Promise<void> {
    const source = userKnowledgeSourceSchema.parse(bundle.source)
    const entries = bundle.entries.map((entry) => userKnowledgeEntrySchema.parse(entry))
    if (entries.some((entry) => entry.sourceId !== source.id || entry.ownerId !== source.ownerId)) {
      throw new Error('Every knowledge entry must reference its source and owner.')
    }
    if (source.fileSize !== bundle.originalFile.size) {
      throw new Error('Knowledge source file size does not match its metadata.')
    }
    const previousEntries = await this.getAllParsed(
      STORES.userKnowledgeEntries,
      userKnowledgeEntrySchema,
    )
    const incomingIds = new Set(entries.map((entry) => entry.id))
    const database = await this.getDatabase()
    const transaction = database.transaction(
      [
        STORES.userKnowledgeSources,
        STORES.userKnowledgeEntries,
        STORES.userKnowledgeFiles,
        STORES.deletionTombstones,
      ],
      'readwrite',
    )
    const entryStore = transaction.objectStore(STORES.userKnowledgeEntries)
    const tombstoneStore = transaction.objectStore(STORES.deletionTombstones)
    const requests: Promise<unknown>[] = [
      requestResult(transaction.objectStore(STORES.userKnowledgeSources).put(source)),
      requestResult(transaction.objectStore(STORES.userKnowledgeFiles).put({
        id: source.originalFileId,
        blob: bundle.originalFile,
      } satisfies StoredFile)),
      ...entries.map((entry) => requestResult(
        entryStore.put(entry),
      )),
    ]
    for (const previous of previousEntries) {
      if (previous.sourceId === source.id && !incomingIds.has(previous.id)) {
        requests.push(requestResult(entryStore.delete(previous.id)))
      }
      if (previous.sourceId === source.id && incomingIds.has(previous.id)) {
        requests.push(requestResult(tombstoneStore.delete(localDeletionTombstoneId(
          previous.ownerId,
          'knowledge_entry',
          previous.id,
        ))))
      }
    }
    requests.push(requestResult(tombstoneStore.delete(localDeletionTombstoneId(
      source.ownerId,
      'knowledge_source',
      source.id,
    ))))
    await Promise.all([...requests, transactionComplete(transaction)])
  }

  async listUserKnowledgeSources(
    ownerId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<UserKnowledgeSource[]> {
    assertStorageKey(ownerId, 'Knowledge source owner')
    const records = await this.getAllParsed(STORES.userKnowledgeSources, userKnowledgeSourceSchema)
    return records.filter((source) => source.ownerId === ownerId &&
      (options.includeDeleted === true || source.deletedAt === null))
  }

  async listUserKnowledgeEntries(
    ownerId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<UserKnowledgeEntry[]> {
    assertStorageKey(ownerId, 'Knowledge entry owner')
    const records = await this.getAllParsed(STORES.userKnowledgeEntries, userKnowledgeEntrySchema)
    return records.filter((entry) => entry.ownerId === ownerId &&
      (options.includeDeleted === true || entry.deletedAt === null))
  }

  async updateUserKnowledgeSource(source: UserKnowledgeSource): Promise<void> {
    const parsed = userKnowledgeSourceSchema.parse(source)
    await this.put(STORES.userKnowledgeSources, parsed)
  }

  async updateUserKnowledgeEntry(entry: UserKnowledgeEntry): Promise<void> {
    const parsed = userKnowledgeEntrySchema.parse(entry)
    await this.put(STORES.userKnowledgeEntries, parsed)
  }

  async deleteUserKnowledgeSource(sourceId: string, ownerId: string, deletedAt: string): Promise<void> {
    assertStorageKey(sourceId, 'Knowledge source')
    assertStorageKey(ownerId, 'Knowledge source owner')
    const source = await this.getParsed(STORES.userKnowledgeSources, sourceId, userKnowledgeSourceSchema)
    if (source === null || source.ownerId !== ownerId) throw new Error('Knowledge source not found.')
    const timestamp = isoDateTimeSchema.parse(deletedAt)
    const entries = await this.listUserKnowledgeEntries(ownerId, { includeDeleted: true })
    const database = await this.getDatabase()
    const transaction = database.transaction(
      [STORES.userKnowledgeSources, STORES.userKnowledgeEntries, STORES.deletionTombstones],
      'readwrite',
    )
    const sourceStore = transaction.objectStore(STORES.userKnowledgeSources)
    const entryStore = transaction.objectStore(STORES.userKnowledgeEntries)
    const tombstoneStore = transaction.objectStore(STORES.deletionTombstones)
    const requests: Promise<unknown>[] = [
      requestResult(sourceStore.put({ ...source, status: 'disabled', deletedAt: timestamp, updatedAt: timestamp })),
      requestResult(tombstoneStore.put(createLocalDeletionTombstone(
        ownerId,
        'knowledge_source',
        sourceId,
        timestamp,
      ))),
    ]
    for (const entry of entries.filter((item) => item.sourceId === sourceId && item.deletedAt === null)) {
      requests.push(requestResult(entryStore.put({ ...entry, enabled: false, deletedAt: timestamp, updatedAt: timestamp })))
      requests.push(requestResult(tombstoneStore.put(createLocalDeletionTombstone(
        ownerId,
        'knowledge_entry',
        entry.id,
        timestamp,
      ))))
    }
    await Promise.all([...requests, transactionComplete(transaction)])
  }

  async deleteUserKnowledgeEntry(entryId: string, ownerId: string, deletedAt: string): Promise<void> {
    const entry = await this.getParsed(STORES.userKnowledgeEntries, entryId, userKnowledgeEntrySchema)
    if (entry === null || entry.ownerId !== ownerId) throw new Error('Knowledge entry not found.')
    const timestamp = isoDateTimeSchema.parse(deletedAt)
    const source = await this.getParsed(STORES.userKnowledgeSources, entry.sourceId, userKnowledgeSourceSchema)
    const remainingCount = source === null
      ? undefined
      : (await this.listUserKnowledgeEntries(ownerId)).filter((item) => item.sourceId === entry.sourceId && item.id !== entry.id).length
    const database = await this.getDatabase()
    const transaction = database.transaction(
      [STORES.userKnowledgeEntries, STORES.userKnowledgeSources, STORES.deletionTombstones],
      'readwrite',
    )
    const requests: Promise<unknown>[] = [
      requestResult(transaction.objectStore(STORES.userKnowledgeEntries).put({ ...entry, enabled: false, deletedAt: timestamp, updatedAt: timestamp })),
      requestResult(transaction.objectStore(STORES.deletionTombstones).put(createLocalDeletionTombstone(
        ownerId,
        'knowledge_entry',
        entryId,
        timestamp,
      ))),
    ]
    if (source !== null && remainingCount !== undefined) {
      requests.push(requestResult(transaction.objectStore(STORES.userKnowledgeSources).put({
        ...source,
        entryCount: remainingCount,
        status: remainingCount === 0 ? 'disabled' : source.status,
        updatedAt: timestamp,
      })))
    }
    await Promise.all([...requests, transactionComplete(transaction)])
  }

  async getUserKnowledgeFile(fileId: string): Promise<Blob | null> {
    assertStorageKey(fileId, 'Knowledge file')
    const stored = await this.get<StoredFile>(STORES.userKnowledgeFiles, fileId)
    return stored?.blob instanceof Blob ? stored.blob : null
  }

  async getTtsCacheEntry(cacheId: string): Promise<{
    metadata: TtsCacheEntry
    audio: Blob
  } | null> {
    assertStorageKey(cacheId, 'TTS cache')
    const record = await this.get<StoredTtsCache>(STORES.ttsCache, cacheId)
    if (record === null || !(record.audio instanceof Blob)) {
      return null
    }

    const { audio, ...metadata } = record
    const parsed = ttsCacheEntrySchema.safeParse(metadata)
    if (!parsed.success) {
      return null
    }

    return { metadata: parsed.data, audio }
  }

  async putTtsCacheEntry(
    metadata: TtsCacheEntry,
    audio: Blob,
  ): Promise<void> {
    const parsed = ttsCacheEntrySchema.parse(metadata)
    await this.put(STORES.ttsCache, { ...parsed, audio })
    await this.pruneTtsCache()
  }

  async getStorageUsage(): Promise<StorageUsageSummary> {
    const [
      sessions,
      expressions,
      audio,
      importSources,
      importedQuestions,
      importedFiles,
      ttsCache,
    ] = await Promise.all([
      this.getAll<unknown>(STORES.sessions),
      this.getAll<unknown>(STORES.expressions),
      this.getAll<StoredAudio>(STORES.audio),
      this.getAll<unknown>(STORES.importSources),
      this.getAll<unknown>(STORES.importedQuestions),
      this.getAll<StoredFile>(STORES.importedFiles),
      this.getAll<StoredTtsCache>(STORES.ttsCache),
    ])
    const audioBytes = audio.reduce(
      (total, item) => total + (item.blob instanceof Blob ? item.blob.size : 0),
      0,
    )
    const importedFileBytes = importedFiles.reduce(
      (total, item) => total + (item.blob instanceof Blob ? item.blob.size : 0),
      0,
    )
    const ttsCacheBytes = ttsCache.reduce(
      (total, item) => total + (item.audio instanceof Blob ? item.audio.size : 0),
      0,
    )
    const metadataBytes = estimateJsonBytes([
      ...sessions,
      ...expressions,
      ...importSources,
      ...importedQuestions,
    ])

    return {
      sessions: sessions.length,
      expressions: expressions.length,
      recordings: audio.length,
      importSources: importSources.length,
      importedQuestions: importedQuestions.length,
      importedFiles: importedFiles.length,
      ttsCacheEntries: ttsCache.length,
      audioBytes,
      importedFileBytes,
      ttsCacheBytes,
      estimatedTotalBytes:
        audioBytes + importedFileBytes + ttsCacheBytes + metadataBytes,
    }
  }

  async deleteSessionWithAudio(
    sessionId: string,
    ownerId: string,
    deletedAt: string | null,
  ): Promise<{ deletedAudio: number }> {
    assertStorageKey(sessionId, 'Session')
    assertStorageKey(ownerId, 'Session owner')
    const database = await this.getDatabase()
    let deletedAudio = 0

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [STORES.sessions, STORES.audio, STORES.deletionTombstones],
        'readwrite',
      )
      const sessions = transaction.objectStore(STORES.sessions)
      const request = sessions.get(sessionId)
      request.onsuccess = () => {
        try {
          const session = normalizeStoredTrainingSession(request.result)
          if (
            session === null ||
            !recordBelongsToAccount(session.ownerId, ownerId)
          ) {
            throw new Error('The practice session could not be found.')
          }
          const audioIds = [...new Set(
            session.attempts.flatMap((attempt) =>
              attempt.audio ? [attempt.audio.id] : [],
            ),
          )]
          deletedAudio = audioIds.length
          sessions.delete(sessionId)
          const audio = transaction.objectStore(STORES.audio)
          for (const audioId of audioIds) audio.delete(audioId)
          if (deletedAt !== null) {
            transaction.objectStore(STORES.deletionTombstones).put(
              createLocalDeletionTombstone(
                ownerId,
                'session',
                sessionId,
                deletedAt,
              ),
            )
          }
        } catch (error) {
          transaction.abort()
          reject(toError(error))
        }
      }
      request.onerror = () =>
        reject(request.error ?? new Error('Unable to read the session.'))
      transaction.oncomplete = () => resolve()
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Session deletion aborted.'))
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Session deletion failed.'))
    })
    return { deletedAudio }
  }

  async clearTtsCache(): Promise<number> {
    const entries = await this.getAll<StoredTtsCache>(STORES.ttsCache)
    const database = await this.getDatabase()
    const transaction = database.transaction(STORES.ttsCache, 'readwrite')
    const request = transaction.objectStore(STORES.ttsCache).clear()
    await Promise.all([requestResult(request), transactionComplete(transaction)])
    return entries.length
  }

  async getBackendConfig(): Promise<BackendConfig | null> {
    const stored = await this.get<unknown>(STORES.backendConfig, 'backend')
    if (stored === null || typeof stored !== 'object') return null
    const legacy = stored as Record<string, unknown>
    const parsed = backendConfigSchema.safeParse({
      id: legacy.id,
      baseUrl: legacy.baseUrl,
      updatedAt: legacy.updatedAt,
    })
    if (!parsed.success) return null

    // V1.4.1 移除了访问口令；读取旧记录时立即覆写，清除遗留字段。
    if ('accessToken' in legacy) {
      await this.saveBackendConfig(parsed.data)
    }
    return parsed.data
  }

  async saveBackendConfig(config: BackendConfig): Promise<void> {
    await this.put(STORES.backendConfig, backendConfigSchema.parse(config))
  }

  async clearBackendConfig(): Promise<void> {
    await this.delete(STORES.backendConfig, 'backend')
  }

  async getVoiceConfigVersion(): Promise<number | null> {
    const record = await this.get<{ id: string; value: number }>(
      STORES.appMeta,
      'ttsVoiceConfigVersion',
    )
    return record === null || typeof record.value !== 'number'
      ? null
      : record.value
  }

  async setVoiceConfigVersion(version: number): Promise<void> {
    await this.put(STORES.appMeta, { id: 'ttsVoiceConfigVersion', value: version })
  }

  /** Release this adapter's database connection without deleting any data. */
  async close(): Promise<void> {
    const databasePromise = this.databasePromise
    this.databasePromise = undefined

    if (databasePromise === undefined) {
      return
    }

    const database = await databasePromise
    database.close()
  }

  private async put<T extends { id: string }>(
    storeName: StoreName,
    value: T,
  ): Promise<void> {
    const database = await this.getDatabase()
    const transaction = database.transaction(storeName, 'readwrite')
    const request = transaction.objectStore(storeName).put(value)
    await Promise.all([requestResult(request), transactionComplete(transaction)])
  }

  private async get<T>(storeName: StoreName, id: string): Promise<T | null> {
    const database = await this.getDatabase()
    const transaction = database.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).get(id)
    const resultPromise = requestResult<unknown>(
      request as IDBRequest<unknown>,
    )
    const transactionPromise = transactionComplete(transaction)
    const result = await resultPromise
    await transactionPromise

    return result === undefined ? null : (result as T)
  }

  private async getAll<T>(storeName: StoreName): Promise<T[]> {
    const database = await this.getDatabase()
    const transaction = database.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).getAll()
    const [results] = await Promise.all([
      requestResult(request),
      transactionComplete(transaction),
    ])

    return results as T[]
  }

  private async getAllByIndex<T>(
    storeName: StoreName,
    indexName: string,
    query: IDBValidKey,
  ): Promise<T[]> {
    const database = await this.getDatabase()
    const transaction = database.transaction(storeName, 'readonly')
    const request = transaction
      .objectStore(storeName)
      .index(indexName)
      .getAll(query)
    const [results] = await Promise.all([
      requestResult(request),
      transactionComplete(transaction),
    ])

    return results as T[]
  }

  private async getParsed<T>(
    storeName: StoreName,
    id: string,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  ): Promise<T | null> {
    const value = await this.get<unknown>(storeName, id)
    if (value === null) {
      return null
    }

    const result = schema.safeParse(value)
    return result.success ? result.data : null
  }

  private async getAllParsed<T>(
    storeName: StoreName,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  ): Promise<T[]> {
    const values = await this.getAll<unknown>(storeName)
    const validValues: T[] = []

    for (const value of values) {
      const result = schema.safeParse(value)
      if (result.success) {
        validValues.push(result.data)
      }
    }

    return validValues
  }

  private async delete(storeName: StoreName, id: string): Promise<void> {
    assertStorageKey(id, 'Storage')
    const database = await this.getDatabase()
    const transaction = database.transaction(storeName, 'readwrite')
    const request = transaction.objectStore(storeName).delete(id)
    await Promise.all([requestResult(request), transactionComplete(transaction)])
  }

  private async pruneTtsCache(): Promise<void> {
    const entries = await this.getAll<StoredTtsCache>(STORES.ttsCache)
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    let retainedBytes = 0
    const remove: StoredTtsCache[] = []
    for (const [index, entry] of entries.entries()) {
      const entryBytes = entry.audio instanceof Blob ? entry.audio.size : 0
      const exceedsLimit =
        index >= MAX_TTS_CACHE_ENTRIES ||
        (index > 0 && retainedBytes + entryBytes > MAX_TTS_CACHE_BYTES)
      if (exceedsLimit) {
        remove.push(entry)
      } else {
        retainedBytes += entryBytes
      }
    }
    for (const entry of remove) {
      await this.delete(STORES.ttsCache, entry.id)
    }
  }

  private getDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise === undefined) {
      this.databasePromise = this.openDatabase().catch((error: unknown) => {
        this.databasePromise = undefined
        throw error
      })
    }

    return this.databasePromise
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.indexedDb.open(this.databaseName, DATABASE_VERSION)
      let blocked = false

      request.onupgradeneeded = () => {
        const database = request.result

        if (!database.objectStoreNames.contains(STORES.sessions)) {
          database.createObjectStore(STORES.sessions, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.expressions)) {
          database.createObjectStore(STORES.expressions, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.audio)) {
          database.createObjectStore(STORES.audio, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.importSources)) {
          database.createObjectStore(STORES.importSources, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.importedQuestions)) {
          database.createObjectStore(STORES.importedQuestions, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.importedFiles)) {
          database.createObjectStore(STORES.importedFiles, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.userKnowledgeSources)) {
          database.createObjectStore(STORES.userKnowledgeSources, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.userKnowledgeEntries)) {
          database.createObjectStore(STORES.userKnowledgeEntries, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.userKnowledgeFiles)) {
          database.createObjectStore(STORES.userKnowledgeFiles, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.apiConfigurations)) {
          database.createObjectStore(STORES.apiConfigurations, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.ttsCache)) {
          database.createObjectStore(STORES.ttsCache, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.backendConfig)) {
          database.createObjectStore(STORES.backendConfig, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.appMeta)) {
          database.createObjectStore(STORES.appMeta, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(STORES.accounts)) {
          database.createObjectStore(STORES.accounts, { keyPath: 'id' })
        }
        const personalMaterialsStore = database.objectStoreNames.contains(
          STORES.personalMaterials,
        )
          ? request.transaction?.objectStore(STORES.personalMaterials)
          : database.createObjectStore(STORES.personalMaterials, {
              keyPath: 'id',
            })
        if (personalMaterialsStore === undefined) {
          throw new Error('The personal materials store upgrade is unavailable.')
        }
        if (
          !personalMaterialsStore.indexNames.contains(
            PERSONAL_MATERIAL_INDEXES.ownerId,
          )
        ) {
          personalMaterialsStore.createIndex(
            PERSONAL_MATERIAL_INDEXES.ownerId,
            'ownerId',
            { unique: false },
          )
        }
        if (
          !personalMaterialsStore.indexNames.contains(
            PERSONAL_MATERIAL_INDEXES.updatedAt,
          )
        ) {
          personalMaterialsStore.createIndex(
            PERSONAL_MATERIAL_INDEXES.updatedAt,
            'updatedAt',
            { unique: false },
          )
        }
        const deletionTombstoneStore = database.objectStoreNames.contains(
          STORES.deletionTombstones,
        )
          ? request.transaction?.objectStore(STORES.deletionTombstones)
          : database.createObjectStore(STORES.deletionTombstones, {
              keyPath: 'id',
            })
        if (deletionTombstoneStore === undefined) {
          throw new Error('The deletion tombstone store upgrade is unavailable.')
        }
        if (
          !deletionTombstoneStore.indexNames.contains(
            DELETION_TOMBSTONE_INDEXES.ownerId,
          )
        ) {
          deletionTombstoneStore.createIndex(
            DELETION_TOMBSTONE_INDEXES.ownerId,
            'ownerId',
            { unique: false },
          )
        }
        const syncOutboxStore = database.objectStoreNames.contains(
          STORES.syncOutbox,
        )
          ? request.transaction?.objectStore(STORES.syncOutbox)
          : database.createObjectStore(STORES.syncOutbox, { keyPath: 'id' })
        if (syncOutboxStore === undefined) {
          throw new Error('The sync outbox store upgrade is unavailable.')
        }
        if (!syncOutboxStore.indexNames.contains(SYNC_OUTBOX_INDEXES.scopeId)) {
          syncOutboxStore.createIndex(
            SYNC_OUTBOX_INDEXES.scopeId,
            'scopeId',
            { unique: false },
          )
        }
        if (!database.objectStoreNames.contains(STORES.syncState)) {
          database.createObjectStore(STORES.syncState, { keyPath: 'id' })
        }
      }

      request.onerror = () => {
        reject(request.error ?? new Error('Unable to open the local database.'))
      }

      request.onblocked = () => {
        blocked = true
        reject(
          new Error(
            'The local database upgrade is blocked by another open app instance.',
          ),
        )
      }

      request.onsuccess = () => {
        const database = request.result

        if (blocked) {
          database.close()
          return
        }

        database.onversionchange = () => {
          database.close()
          this.databasePromise = undefined
        }

        resolve(database)
      }
    })
  }
}

function assertStorageKey(value: string, entityName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${entityName} id must not be empty.`)
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function localDeletionTombstoneId(
  ownerId: string,
  entityType: LocalDeletionTombstone['entityType'],
  entityId: string,
): string {
  return JSON.stringify(['deleted', ownerId, entityType, entityId])
}

function createLocalDeletionTombstone(
  ownerId: string,
  entityType: LocalDeletionTombstone['entityType'],
  entityId: string,
  deletedAt: string,
): LocalDeletionTombstone {
  return localDeletionTombstoneSchema.parse({
    id: localDeletionTombstoneId(ownerId, entityType, entityId),
    ownerId,
    entityType,
    entityId,
    deletedAt,
  })
}

function syncRecordId(scopeId: string, operationId: string): string {
  return JSON.stringify([scopeId, operationId])
}

function syncStateId(scopeId: string): string {
  return JSON.stringify(['cursor', scopeId])
}

function syncEntityStateKey(entityType: CloudSyncEntityType, entityId: string): string {
  return JSON.stringify([entityType, entityId])
}

function parseStoredSyncOperation(
  value: unknown,
  expectedScopeId: string,
): SyncOutboxOperation {
  if (value === null || typeof value !== 'object') {
    throw new Error('The sync outbox contains an invalid record.')
  }
  const record = value as Partial<StoredSyncOutboxOperation>
  const parsed = syncOutboxOperationSchema.safeParse({
    operationId: record.operationId,
    entityType: record.entityType,
    entityId: record.entityId,
    baseVersion: record.baseVersion,
    payload: record.payload,
    deletedAt: record.deletedAt,
    createdAt: record.createdAt,
  })
  if (
    !parsed.success ||
    record.scopeId !== expectedScopeId ||
    record.id !== syncRecordId(expectedScopeId, parsed.data.operationId)
  ) {
    throw new Error('The sync outbox contains an invalid record.')
  }
  return parsed.data
}

function parseStoredSyncState(
  value: unknown,
  expectedScopeId: string,
): StoredSyncState {
  if (value === null || typeof value !== 'object') {
    throw new Error('The stored sync cursor is invalid.')
  }
  const record = value as Partial<StoredSyncState>
  const rawEntities = record.entities ?? {}
  if (
    record.id !== syncStateId(expectedScopeId) ||
    record.scopeId !== expectedScopeId ||
    !Number.isSafeInteger(record.cursor) ||
    (record.cursor ?? -1) < 0
  ) {
    throw new Error('The stored sync cursor is invalid.')
  }
  const entities: Record<string, SyncEntityState> = {}
  for (const [key, state] of Object.entries(rawEntities)) {
    if (
      state === null ||
      typeof state !== 'object' ||
      !Number.isSafeInteger(state.version) ||
      state.version < 0 ||
      (state.syncedUpdatedAt !== null &&
        typeof state.syncedUpdatedAt !== 'string')
    ) {
      throw new Error('The stored sync entity state is invalid.')
    }
    entities[key] = state
  }
  return { id: record.id, scopeId: record.scopeId, cursor: record.cursor, entities } as StoredSyncState
}

function sameSyncOperation(
  left: SyncOutboxOperation,
  right: SyncOutboxOperation,
): boolean {
  return stableJson(left) === stableJson(right)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function estimateJsonBytes(value: unknown): number {
  if (Array.isArray(value) && value.length === 0) return 0
  try {
    return new Blob([JSON.stringify(value)]).size
  } catch {
    return 0
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      reject(request.error ?? new Error('The local database request failed.'))
    }
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => {
      reject(
        transaction.error ?? new Error('The local database transaction aborted.'),
      )
    }
    transaction.onerror = () => {
      reject(
        transaction.error ?? new Error('The local database transaction failed.'),
      )
    }
  })
}
