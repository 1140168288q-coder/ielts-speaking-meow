import { beforeEach, describe, expect, it } from 'vitest'
import type { BackendConfig } from '../../domain'
import { IndexedDbStorage } from './indexedDbStorage'

let databaseSequence = 0
let databaseName = ''
let adapters: IndexedDbStorage[] = []

beforeEach(() => {
  databaseSequence += 1
  databaseName = `ielts-speaking-meow-backend-config-${databaseSequence}`
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

function config(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    id: 'backend',
    baseUrl: 'http://192.168.0.26:8000',
    updatedAt: '2026-08-14T08:00:00.000Z',
    ...overrides,
  }
}

describe('IndexedDbStorage backend config', () => {
  it('saves and reloads the runtime backend config', async () => {
    const storage = createAdapter()
    expect(await storage.getBackendConfig()).toBeNull()

    await storage.saveBackendConfig(config())
    await storage.close()

    const reopened = createAdapter()
    expect(await reopened.getBackendConfig()).toEqual(config())
  })

  it('rejects malformed stored configs without throwing', async () => {
    const storage = createAdapter()
    await storage.saveBackendConfig(config())
    await storage.close()

    const database = await openDatabase(databaseName)
    const transaction = database.transaction('backendConfig', 'readwrite')
    transaction.objectStore('backendConfig').put({
      id: 'backend',
      baseUrl: 'not-a-url',
    })
    await transactionComplete(transaction)
    database.close()

    const reopened = createAdapter()
    expect(await reopened.getBackendConfig()).toBeNull()
  })

  it('purges the removed access-token field from a legacy record', async () => {
    const storage = createAdapter()
    await storage.saveBackendConfig(config())
    await storage.close()

    const database = await openDatabase(databaseName)
    const transaction = database.transaction('backendConfig', 'readwrite')
    transaction.objectStore('backendConfig').put({
      ...config(),
      accessToken: 'legacy-token-must-be-removed',
    })
    await transactionComplete(transaction)
    database.close()

    const reopened = createAdapter()
    expect(await reopened.getBackendConfig()).toEqual(config())
    await reopened.close()

    const inspected = await openDatabase(databaseName)
    const read = inspected.transaction('backendConfig').objectStore('backendConfig').get('backend')
    const stored = await new Promise<Record<string, unknown>>((resolve, reject) => {
      read.onsuccess = () => resolve(read.result as Record<string, unknown>)
      read.onerror = () =>
        reject(read.error ?? new Error('Unable to inspect Backend config.'))
    })
    inspected.close()
    expect(stored).not.toHaveProperty('accessToken')
  })
})

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
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
      reject(request.error ?? new Error('Unable to delete test database.'))
    request.onblocked = () =>
      reject(new Error('Test database deletion was blocked.'))
  })
}
