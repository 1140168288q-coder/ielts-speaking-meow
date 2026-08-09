import type { SavedExpression, TrainingSession } from '../../domain/models'
import type { AudioStorage, LocalStorage } from '../../ports/storage'

const DATABASE_VERSION = 1
const DEFAULT_DATABASE_NAME = 'ielts-speaking-meow'

const STORES = {
  sessions: 'sessions',
  expressions: 'expressions',
  audio: 'audio',
} as const

type StoreName = (typeof STORES)[keyof typeof STORES]

interface StoredAudio {
  id: string
  blob: Blob
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
export class IndexedDbStorage implements LocalStorage, AudioStorage {
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
    return this.get<TrainingSession>(STORES.sessions, sessionId)
  }

  async listSessions(): Promise<TrainingSession[]> {
    return this.getAll<TrainingSession>(STORES.sessions)
  }

  async upsertExpression(expression: SavedExpression): Promise<void> {
    assertStorageKey(expression.id, 'Expression')
    await this.put(STORES.expressions, expression)
  }

  async getExpression(expressionId: string): Promise<SavedExpression | null> {
    assertStorageKey(expressionId, 'Expression')
    return this.get<SavedExpression>(STORES.expressions, expressionId)
  }

  async listExpressions(): Promise<SavedExpression[]> {
    return this.getAll<SavedExpression>(STORES.expressions)
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
