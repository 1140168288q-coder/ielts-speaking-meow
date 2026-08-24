import type { SavedExpression } from '../../domain'
import type { SyncOutboxOperation } from '../../domain/cloudSync'
import { IndexedDbStorage } from './indexedDbStorage'

const CREATED_AT = '2026-08-21T10:00:00.000Z'

const operation: SyncOutboxOperation = {
  operationId: 'operation-1',
  entityType: 'personal_material',
  entityId: 'material-1',
  baseVersion: 0,
  payload: { title: 'My hometown', nested: { useful: true } },
  deletedAt: null,
  createdAt: CREATED_AT,
}

const legacyExpression: SavedExpression = {
  id: 'legacy-expression-v6',
  ownerId: 'local-user',
  text: 'It helps me clear my head.',
  topic: 'Leisure',
  questionId: 'p1-free-time',
  sessionId: 'session-legacy',
  sourceAttempt: 2,
  createdAt: CREATED_AT,
}

let sequence = 0
let databaseName = ''
let adapters: IndexedDbStorage[] = []

beforeEach(() => {
  databaseName = `ielts-speaking-meow-sync-test-${++sequence}`
  adapters = []
})

afterEach(async () => {
  await Promise.all(adapters.map((adapter) => adapter.close()))
  await deleteDatabase(databaseName)
})

describe('IndexedDbStorage cloud sync', () => {
  it('persists account-scoped outbox operations and cursors after reopening', async () => {
    const storage = createAdapter()

    await expect(storage.enqueueSyncOperation('cloud-alice', operation)).resolves.toBe(
      'created',
    )
    await storage.enqueueSyncOperation('cloud-bob', {
      ...operation,
      payload: { title: 'Bob material' },
    })
    await storage.setSyncCursor('cloud-alice', 17)
    await storage.close()

    const reopened = createAdapter()
    expect(await reopened.listSyncOperations('cloud-alice')).toEqual([operation])
    expect(await reopened.listSyncOperations('cloud-bob')).toEqual([
      { ...operation, payload: { title: 'Bob material' } },
    ])
    expect(await reopened.getSyncCursor('cloud-alice')).toBe(17)
    expect(await reopened.getSyncCursor('cloud-bob')).toBe(0)
  })

  it('persists per-entity versions without losing them when the cursor advances', async () => {
    const storage = createAdapter()
    await storage.setSyncEntityState('cloud-alice', 'session', 'session-1', {
      version: 3,
      syncedUpdatedAt: CREATED_AT,
    })
    await storage.setSyncCursor('cloud-alice', 9)
    await storage.close()

    const reopened = createAdapter()
    await expect(
      reopened.getSyncEntityState('cloud-alice', 'session', 'session-1'),
    ).resolves.toEqual({ version: 3, syncedUpdatedAt: CREATED_AT })
    await expect(
      reopened.getSyncEntityState('cloud-bob', 'session', 'session-1'),
    ).resolves.toEqual({ version: 0, syncedUpdatedAt: null })
    await expect(reopened.getSyncCursor('cloud-alice')).resolves.toBe(9)
  })

  it('treats an identical operationId as idempotent but rejects changed content', async () => {
    const storage = createAdapter()
    await storage.enqueueSyncOperation('cloud-alice', operation)

    await expect(
      storage.enqueueSyncOperation('cloud-alice', {
        ...operation,
        payload: { nested: { useful: true }, title: 'My hometown' },
      }),
    ).resolves.toBe('already-enqueued')
    await expect(
      storage.enqueueSyncOperation('cloud-alice', {
        ...operation,
        payload: { title: 'Different payload' },
      }),
    ).rejects.toThrow('operationId')
    expect(await storage.listSyncOperations('cloud-alice')).toEqual([operation])
  })

  it('removes only the requested account operation and never rewinds a cursor', async () => {
    const storage = createAdapter()
    await storage.enqueueSyncOperation('cloud-alice', operation)
    await storage.enqueueSyncOperation('cloud-bob', operation)

    await storage.removeSyncOperation('cloud-alice', operation.operationId)
    expect(await storage.listSyncOperations('cloud-alice')).toEqual([])
    expect(await storage.listSyncOperations('cloud-bob')).toEqual([operation])

    await storage.setSyncCursor('cloud-alice', 8)
    await expect(storage.setSyncCursor('cloud-alice', 7)).rejects.toThrow(
      'cannot move backwards',
    )
    expect(await storage.getSyncCursor('cloud-alice')).toBe(8)
  })

  it('migrates a v6 database without rewriting existing data', async () => {
    await seedVersionSixDatabase(databaseName)

    const storage = createAdapter()
    expect(await storage.listExpressions()).toEqual([legacyExpression])
    expect(await storage.listSyncOperations('cloud-alice')).toEqual([])
    expect(await storage.getSyncCursor('cloud-alice')).toBe(0)
    await storage.close()

    const database = await openDatabase(databaseName)
    expect(database.version).toBe(8)
    expect(database.objectStoreNames.contains('syncOutbox')).toBe(true)
    expect(database.objectStoreNames.contains('syncState')).toBe(true)
    expect(database.objectStoreNames.contains('deletionTombstones')).toBe(true)
    const transaction = database.transaction('syncOutbox', 'readonly')
    expect(Array.from(transaction.objectStore('syncOutbox').indexNames)).toContain(
      'scopeId',
    )
    await transactionComplete(transaction)
    database.close()
  })
})

function createAdapter(): IndexedDbStorage {
  const adapter = new IndexedDbStorage({ databaseName })
  adapters.push(adapter)
  return adapter
}

async function seedVersionSixDatabase(name: string): Promise<void> {
  const database = await openDatabase(name, 6, (upgradeDatabase) => {
    for (const storeName of [
      'sessions',
      'expressions',
      'audio',
      'importSources',
      'importedQuestions',
      'importedFiles',
      'apiConfigurations',
      'ttsCache',
      'backendConfig',
      'appMeta',
      'accounts',
      'personalMaterials',
    ]) {
      upgradeDatabase.createObjectStore(storeName, { keyPath: 'id' })
    }
  })
  const transaction = database.transaction('expressions', 'readwrite')
  transaction.objectStore('expressions').put(legacyExpression)
  await transactionComplete(transaction)
  database.close()
}

function openDatabase(
  name: string,
  version?: number,
  upgrade?: (database: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined
      ? indexedDB.open(name)
      : indexedDB.open(name, version)
    request.onupgradeneeded = () => upgrade?.(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Unable to open test database.'))
    request.onblocked = () => reject(new Error('Test database open was blocked.'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Test transaction aborted.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Test transaction failed.'))
  })
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(request.error ?? new Error('Unable to delete the test database.'))
    request.onblocked = () =>
      reject(new Error('Test database deletion was blocked.'))
  })
}
