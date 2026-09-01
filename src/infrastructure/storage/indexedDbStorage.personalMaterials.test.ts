import type { PersonalMaterial, SavedExpression } from '../../domain'

import { IndexedDbStorage } from './indexedDbStorage'

const CREATED_AT = '2026-08-21T08:00:00.000Z'
const UPDATED_AT = '2026-08-21T09:00:00.000Z'
const DELETED_AT = '2026-08-21T10:00:00.000Z'

const aliceMaterial: PersonalMaterial = {
  id: 'material-alice-grandmother',
  ownerId: 'user-alice',
  title: '外婆教我做饭',
  content: 'My grandmother taught me how to make dumplings one summer.',
  kind: 'experience',
  sourcePart: 1,
  topicTags: ['family', 'food'],
  questionIds: ['p2-skill-from-older-person'],
  sourceSessionId: 'session-alice-cooking',
  status: 'confirmed',
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  version: 1,
  deletedAt: null,
}

const bobMaterial: PersonalMaterial = {
  ...aliceMaterial,
  id: 'material-bob-city-park',
  ownerId: 'user-bob',
  title: '家附近的公园',
  content: 'There is a quiet park near my home where I go running.',
  kind: 'place',
  topicTags: ['park', 'exercise'],
  questionIds: ['p2-place-to-relax'],
  sourceSessionId: null,
}

const legacyExpression: SavedExpression = {
  id: 'legacy-expression-v5',
  ownerId: 'user-alice',
  text: 'It gives me a sense of calm.',
  topic: 'Places',
  questionId: 'p2-place-to-relax',
  sessionId: 'session-legacy',
  sourceAttempt: 2,
  sourcePart: 1,
  createdAt: CREATED_AT,
}

let databaseSequence = 0
let databaseName = ''
let adapters: IndexedDbStorage[] = []

beforeEach(() => {
  databaseSequence += 1
  databaseName = `ielts-speaking-meow-materials-test-${databaseSequence}`
  adapters = []
})

afterEach(async () => {
  await Promise.all(adapters.map((adapter) => adapter.close()))
  await deleteDatabase(databaseName)
})

function createAdapter(): IndexedDbStorage {
  const adapter = new IndexedDbStorage({ databaseName })
  adapters.push(adapter)
  return adapter
}

describe('IndexedDbStorage personal materials', () => {
  it('round-trips a strictly validated material after reopening', async () => {
    const storage = createAdapter()

    await storage.upsertPersonalMaterial(aliceMaterial)
    await storage.close()

    const reopened = createAdapter()
    expect(
      await reopened.getPersonalMaterial(aliceMaterial.id, aliceMaterial.ownerId),
    ).toEqual(aliceMaterial)
    expect(await reopened.listPersonalMaterials(aliceMaterial.ownerId)).toEqual([
      aliceMaterial,
    ])

    await expect(
      reopened.upsertPersonalMaterial({
        ...aliceMaterial,
        unexpected: true,
      } as PersonalMaterial),
    ).rejects.toThrow()
  })

  it('queries and guards records by owner', async () => {
    const storage = createAdapter()
    await storage.upsertPersonalMaterial(aliceMaterial)
    await storage.upsertPersonalMaterial(bobMaterial)

    expect(await storage.listPersonalMaterials('user-alice')).toEqual([
      aliceMaterial,
    ])
    expect(await storage.listPersonalMaterials('user-bob')).toEqual([
      bobMaterial,
    ])
    expect(
      await storage.getPersonalMaterial(aliceMaterial.id, 'user-bob'),
    ).toBeNull()

    await expect(
      storage.deletePersonalMaterial(
        aliceMaterial.id,
        'user-bob',
        DELETED_AT,
      ),
    ).rejects.toThrow('不属于当前账号')
    expect(
      await storage.getPersonalMaterial(aliceMaterial.id, 'user-alice'),
    ).toEqual(aliceMaterial)
  })

  it('soft-deletes a material and retains its tombstone', async () => {
    const storage = createAdapter()
    await storage.upsertPersonalMaterial(aliceMaterial)

    await storage.deletePersonalMaterial(
      aliceMaterial.id,
      'user-alice',
      DELETED_AT,
    )

    expect(await storage.listPersonalMaterials('user-alice')).toEqual([])
    const deleted = await storage.getPersonalMaterial(
      aliceMaterial.id,
      'user-alice',
    )
    expect(deleted).toMatchObject({
      id: aliceMaterial.id,
      ownerId: 'user-alice',
      status: 'confirmed',
      version: 2,
    })
    expect(deleted?.deletedAt).toBe(DELETED_AT)
    expect(deleted?.updatedAt).toBe(deleted?.deletedAt)
    expect(
      await storage.listPersonalMaterials('user-alice', {
        includeDeleted: true,
      }),
    ).toEqual([deleted])

    await storage.deletePersonalMaterial(
      aliceMaterial.id,
      'user-alice',
      DELETED_AT,
    )
    expect(
      await storage.getPersonalMaterial(aliceMaterial.id, 'user-alice'),
    ).toEqual(deleted)
  })

  it('migrates a v5 database without rewriting existing stores', async () => {
    await seedVersionFiveDatabase(databaseName)

    const storage = createAdapter()
    expect(await storage.listExpressions()).toEqual([legacyExpression])
    expect(await storage.listPersonalMaterials('user-alice')).toEqual([])
    await storage.close()

    const database = await openDatabase(databaseName)
    expect(database.version).toBe(8)
    expect(database.objectStoreNames.contains('personalMaterials')).toBe(true)
    const transaction = database.transaction('personalMaterials', 'readonly')
    const store = transaction.objectStore('personalMaterials')
    expect(Array.from(store.indexNames).sort()).toEqual(
      ['ownerId', 'updatedAt'].sort(),
    )
    await transactionComplete(transaction)
    database.close()
  })
})

async function seedVersionFiveDatabase(name: string): Promise<void> {
  const database = await openDatabase(name, 5, (upgradeDatabase) => {
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
    const request =
      version === undefined ? indexedDB.open(name) : indexedDB.open(name, version)
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
