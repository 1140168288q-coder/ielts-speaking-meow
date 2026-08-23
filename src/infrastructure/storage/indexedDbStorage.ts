import {
  accountProfileSchema,
  backendConfigSchema,
  importedQuestionRecordSchema,
  importSourceSchema,
  normalizeStoredTrainingSession,
  personalMaterialSchema,
  practiceTextsSchema,
  savedExpressionSchema,
  ttsCacheEntrySchema,
  type AccountProfile,
  type BackendConfig,
  type ImportedQuestionRecord,
  type ImportSource,
  type PersonalMaterial,
  type PracticeTexts,
  type SavedExpression,
  type TrainingSession,
  type TtsCacheEntry,
} from '../../domain'
import {
  syncOutboxOperationSchema,
  type CloudSyncEntityType,
  type SyncOutboxOperation,
} from '../../domain/cloudSync'
import type { AccountStorage } from '../../ports/accounts'
import type { BackendConfigStorage } from '../../ports/backend'
import type {
  ImportBundle,
  ImportStorage,
  TtsCacheStorage,
} from '../../ports/imports'
import type {
  AudioStorage,
  CloudSyncStorage,
  SyncEntityState,
  ListPersonalMaterialsOptions,
  LocalDataMaintenance,
  LocalStorage,
  StorageUsageSummary,
} from '../../ports/storage'

const DATABASE_VERSION = 7
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
  apiConfigurations: 'apiConfigurations',
  ttsCache: 'ttsCache',
  backendConfig: 'backendConfig',
  appMeta: 'appMeta',
  accounts: 'accounts',
  personalMaterials: 'personalMaterials',
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
    LocalDataMaintenance
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

  async deleteExpression(expressionId: string): Promise<void> {
    assertStorageKey(expressionId, 'Expression')
    await this.delete(STORES.expressions, expressionId)
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
  ): Promise<void> {
    const material = await this.getPersonalMaterial(materialId, ownerId)
    if (material === null || material.deletedAt !== null) {
      return
    }

    const deletedAt = new Date().toISOString()
    await this.upsertPersonalMaterial({
      ...material,
      updatedAt: deletedAt,
      version: material.version + 1,
      deletedAt,
    })
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

  async getImportSource(sourceId: string): Promise<ImportSource | null> {
    assertStorageKey(sourceId, 'Import source')
    return this.getParsed(STORES.importSources, sourceId, importSourceSchema)
  }

  async listImportSources(): Promise<ImportSource[]> {
    return this.getAllParsed(STORES.importSources, importSourceSchema)
  }

  async getImportedFile(fileId: string): Promise<Blob | null> {
    assertStorageKey(fileId, 'Imported file')
    const storedFile = await this.get<StoredFile>(STORES.importedFiles, fileId)
    return storedFile?.blob instanceof Blob ? storedFile.blob : null
  }

  async listImportedQuestions(): Promise<ImportedQuestionRecord[]> {
    return this.getAllParsed(
      STORES.importedQuestions,
      importedQuestionRecordSchema,
    )
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
  ): Promise<{ deletedAudio: number }> {
    assertStorageKey(sessionId, 'Session')
    const session = await this.getSession(sessionId)
    const audioIds = [...new Set(
      session?.attempts.flatMap((attempt) =>
        attempt.audio ? [attempt.audio.id] : [],
      ) ?? [],
    )]
    const database = await this.getDatabase()
    const transaction = database.transaction(
      [STORES.sessions, STORES.audio],
      'readwrite',
    )
    const requests: Promise<unknown>[] = [
      requestResult(transaction.objectStore(STORES.sessions).delete(sessionId)),
      ...audioIds.map((audioId) =>
        requestResult(transaction.objectStore(STORES.audio).delete(audioId)),
      ),
    ]
    await Promise.all([...requests, transactionComplete(transaction)])
    return { deletedAudio: audioIds.length }
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
