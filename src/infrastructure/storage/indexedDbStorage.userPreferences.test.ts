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

  it('fills greeting overrides for legacy records saved before the fields existed', async () => {
    const legacy = {
      version: 1,
      ownerId: 'owner-legacy',
      theme: 'system',
      ttsVoiceMode: 'natural-first',
      ttsRate: 0.92,
      autoPlayQuestion: true,
      defaultPart: 1,
      feedbackDetail: 'focused',
      memoryEnabled: true,
      sharePersonalMaterialsWithAi: false,
      reduceMotion: false,
      updatedAt: '2026-08-01T08:00:00.000Z',
    }
    // 直接写入一条缺少新字段的旧记录,模拟升级场景。
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(databaseName)
      open.onupgradeneeded = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('appMeta')) {
          db.createObjectStore('appMeta', { keyPath: 'id' })
        }
      }
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction('appMeta', 'readwrite')
        tx.objectStore('appMeta').put({
          id: 'userPreferences:owner-legacy',
          ...legacy,
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('write failed'))
      }
      open.onerror = () => reject(open.error ?? new Error('open failed'))
    })

    const loaded = await createAdapter().getUserPreferences('owner-legacy')
    expect(loaded).not.toBeNull()
    expect(loaded?.homeTitleOverride).toBeNull()
    expect(loaded?.homeSubtitleOverride).toBeNull()
  })
})
