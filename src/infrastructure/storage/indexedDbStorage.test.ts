import type { SavedExpression, TrainingSession } from '../../domain/models'
import { IndexedDbStorage } from './indexedDbStorage'

const CREATED_AT = '2026-08-09T10:00:00.000+08:00'
const UPDATED_AT = '2026-08-09T10:05:00.000+08:00'

const sessionFixture: TrainingSession = {
  id: 'session-1',
  questionId: 'p1-home',
  status: 'first-ready',
  attempts: [],
  localFeedback: [],
  aiFeedback: null,
  comparison: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
}

const expressionFixture: SavedExpression = {
  id: 'expression-1',
  text: 'I tend to unwind by reading at home.',
  topic: 'Home',
  questionId: 'p1-home',
  sessionId: sessionFixture.id,
  sourceAttempt: 2,
  createdAt: CREATED_AT,
}

let databaseSequence = 0
let databaseName = ''
let adapters: IndexedDbStorage[] = []

function createAdapter(): IndexedDbStorage {
  const adapter = new IndexedDbStorage({ databaseName })
  adapters.push(adapter)
  return adapter
}

beforeEach(() => {
  databaseSequence += 1
  databaseName = `ielts-speaking-meow-storage-test-${databaseSequence}`
  adapters = []
})

afterEach(async () => {
  await Promise.all(adapters.map((adapter) => adapter.close()))
  await deleteDatabase(databaseName)
})

describe('IndexedDbStorage', () => {
  it('upserts sessions and expressions and restores them after reopening', async () => {
    const storage = createAdapter()

    expect(await storage.getSession(sessionFixture.id)).toBeNull()
    expect(await storage.getExpression(expressionFixture.id)).toBeNull()
    expect(await storage.listSessions()).toEqual([])
    expect(await storage.listExpressions()).toEqual([])

    await storage.upsertSession(sessionFixture)
    await storage.upsertExpression(expressionFixture)

    const updatedSession: TrainingSession = {
      ...sessionFixture,
      status: 'feedback-ready',
      updatedAt: UPDATED_AT,
    }
    const updatedExpression: SavedExpression = {
      ...expressionFixture,
      text: 'I usually unwind by reading at home.',
    }

    await storage.upsertSession(updatedSession)
    await storage.upsertExpression(updatedExpression)
    await storage.close()

    const reopenedStorage = createAdapter()

    expect(await reopenedStorage.getSession(sessionFixture.id)).toEqual(
      updatedSession,
    )
    expect(await reopenedStorage.listSessions()).toEqual([updatedSession])
    expect(await reopenedStorage.getExpression(expressionFixture.id)).toEqual(
      updatedExpression,
    )
    expect(await reopenedStorage.listExpressions()).toEqual([
      updatedExpression,
    ])

    await reopenedStorage.deleteExpression(expressionFixture.id)
    expect(await reopenedStorage.getExpression(expressionFixture.id)).toBeNull()
  })

  it('persists original audio blobs until an explicit delete', async () => {
    const storage = createAdapter()
    const originalAudio = new Blob(['original recording'], {
      type: 'audio/webm',
    })

    await storage.saveAudio('audio-attempt-1', originalAudio)
    expect(await storage.hasAudio('audio-attempt-1')).toBe(true)
    await storage.close()

    const reopenedStorage = createAdapter()
    const restoredAudio = await reopenedStorage.getAudio('audio-attempt-1')

    expect(restoredAudio).not.toBeNull()
    expect(restoredAudio?.type).toBe('audio/webm')
    expect(await restoredAudio?.text()).toBe('original recording')

    await reopenedStorage.deleteAudio('audio-attempt-1')

    expect(await reopenedStorage.hasAudio('audio-attempt-1')).toBe(false)
    expect(await reopenedStorage.getAudio('audio-attempt-1')).toBeNull()
  })

  it('does not delete committed audio when saving a replacement fails', async () => {
    const storage = createAdapter()
    await storage.saveAudio(
      'protected-audio',
      new Blob(['committed recording'], { type: 'audio/webm' }),
    )

    const deleteSpy = vi.spyOn(storage, 'deleteAudio')
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementationOnce(() => {
        throw new DOMException(
          'Simulated storage quota failure.',
          'QuotaExceededError',
        )
      })

    await expect(
      storage.saveAudio(
        'protected-audio',
        new Blob(['replacement recording'], { type: 'audio/webm' }),
      ),
    ).rejects.toThrow('Simulated storage quota failure.')
    expect(deleteSpy).not.toHaveBeenCalled()

    putSpy.mockRestore()
    deleteSpy.mockRestore()

    const committedAudio = await storage.getAudio('protected-audio')
    expect(await committedAudio?.text()).toBe('committed recording')
  })

  it('does not delete committed audio when a read fails', async () => {
    const storage = createAdapter()
    await storage.saveAudio(
      'protected-audio',
      new Blob(['committed recording'], { type: 'audio/webm' }),
    )

    const deleteSpy = vi.spyOn(storage, 'deleteAudio')
    const getSpy = vi
      .spyOn(IDBObjectStore.prototype, 'get')
      .mockImplementationOnce(() => {
        throw new DOMException(
          'Simulated local read failure.',
          'UnknownError',
        )
      })

    await expect(storage.getAudio('protected-audio')).rejects.toThrow(
      'Simulated local read failure.',
    )
    expect(deleteSpy).not.toHaveBeenCalled()

    getSpy.mockRestore()
    deleteSpy.mockRestore()

    expect(await storage.hasAudio('protected-audio')).toBe(true)
    const committedAudio = await storage.getAudio('protected-audio')
    expect(await committedAudio?.text()).toBe('committed recording')
  })

  it('reports usage and deletes a session with only its referenced audio', async () => {
    const storage = createAdapter()
    const audioId = 'audio-session-1'
    await storage.saveAudio(
      audioId,
      new Blob(['private recording'], { type: 'audio/webm' }),
    )
    await storage.upsertSession({
      ...sessionFixture,
      status: 'first-review',
      attempts: [
        {
          id: 'attempt-session-1',
          attemptNumber: 1,
          audio: {
            id: audioId,
            relativePath: `indexeddb://audio/${audioId}`,
            mimeType: 'audio/webm',
            durationMs: 2_000,
            createdAt: CREATED_AT,
          },
          transcript: {
            status: 'ready',
            text: 'I like my home.',
            originalText: null,
            source: 'manual',
            errorCode: null,
            updatedAt: CREATED_AT,
          },
          metrics: {
            durationMs: 2_000,
            wordCount: 4,
            wordsPerMinute: 120,
            fillerWords: [],
            fillerCount: 0,
            repeatedWords: [],
            repeatedWordCount: 0,
            acoustic: null,
            caveats: ['Approximate transcript metrics.'],
          },
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
      ],
    })
    await storage.putTtsCacheEntry(
      { id: 'tts-1', mimeType: 'audio/mpeg', createdAt: CREATED_AT },
      new Blob(['voice'], { type: 'audio/mpeg' }),
    )

    const before = await storage.getStorageUsage()
    expect(before).toMatchObject({
      sessions: 1,
      recordings: 1,
      ttsCacheEntries: 1,
    })
    expect(before.audioBytes).toBeGreaterThan(0)

    await expect(storage.deleteSessionWithAudio(sessionFixture.id)).resolves.toEqual({
      deletedAudio: 1,
    })
    expect(await storage.getSession(sessionFixture.id)).toBeNull()
    expect(await storage.getAudio(audioId)).toBeNull()
    await expect(storage.clearTtsCache()).resolves.toBe(1)
    expect((await storage.getStorageUsage()).ttsCacheEntries).toBe(0)
  })
})

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => {
      reject(request.error ?? new Error('Unable to delete the test database.'))
    }
    request.onblocked = () => {
      reject(new Error('Test database deletion was blocked.'))
    }
  })
}
