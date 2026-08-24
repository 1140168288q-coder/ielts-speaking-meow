import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createDefaultUserPreferences,
  updateUserPreferences,
} from '../../domain/userPreferences'
import { IndexedDbStorage } from './indexedDbStorage'

let sequence = 0
let databaseName = ''
let adapters: IndexedDbStorage[] = []

beforeEach(() => {
  sequence += 1
  databaseName = `ielts-speaking-meow-preferences-${sequence}`
  adapters = []
})

afterEach(async () => {
  await Promise.all(adapters.map((adapter) => adapter.close()))
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(request.error ?? new Error('Unable to delete test database.'))
    request.onblocked = () => reject(new Error('Test database deletion was blocked.'))
  })
})

function createAdapter(): IndexedDbStorage {
  const adapter = new IndexedDbStorage({ databaseName })
  adapters.push(adapter)
  return adapter
}

describe('IndexedDbStorage user preferences', () => {
  it('persists preferences across reopen and isolates owners', async () => {
    const storage = createAdapter()
    const ownerA = updateUserPreferences(
      createDefaultUserPreferences('owner-a'),
      { theme: 'dark', sharePersonalMaterialsWithAi: true },
      new Date('2026-08-24T08:00:00.000Z'),
    )
    const ownerB = updateUserPreferences(
      createDefaultUserPreferences('owner-b'),
      { theme: 'light', memoryEnabled: false },
      new Date('2026-08-24T08:01:00.000Z'),
    )

    await storage.saveUserPreferences(ownerA)
    await storage.saveUserPreferences(ownerB)
    await storage.close()

    const reopened = createAdapter()
    expect(await reopened.getUserPreferences('owner-a')).toEqual(ownerA)
    expect(await reopened.getUserPreferences('owner-b')).toEqual(ownerB)
    expect(await reopened.getUserPreferences('owner-c')).toBeNull()
  })

  it('rejects a blank owner key before opening the database', async () => {
    const storage = createAdapter()
    await expect(storage.getUserPreferences('')).rejects.toThrow(
      'User preferences owner',
    )
  })
})
