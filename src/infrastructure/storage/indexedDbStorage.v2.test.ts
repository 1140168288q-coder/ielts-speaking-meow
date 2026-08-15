import type {
  ImportedQuestionRecord,
  ImportSource,
  SavedExpression,
  TrainingSession,
} from '../../domain'
import type { ImportBundle } from '../../ports/imports'
import { IndexedDbStorage } from './indexedDbStorage'

const NOW = '2026-08-10T08:00:00.000Z'

const legacySession: TrainingSession = {
  id: 'legacy-session',
  questionId: 'p1-home-001',
  status: 'first-ready',
  attempts: [],
  localFeedback: [],
  aiFeedback: null,
  comparison: null,
  createdAt: NOW,
  updatedAt: NOW,
}

const legacyExpression: SavedExpression = {
  id: 'legacy-expression',
  text: 'It helps me unwind after a busy day.',
  topic: 'Home',
  questionId: legacySession.questionId,
  sessionId: legacySession.id,
  sourceAttempt: 2,
  createdAt: NOW,
}

let databaseSequence = 0
let databaseName = ''
let adapters: IndexedDbStorage[] = []

beforeEach(() => {
  databaseSequence += 1
  databaseName = `ielts-speaking-meow-v2-storage-test-${databaseSequence}`
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

describe('IndexedDbStorage v1 to v2 migration', () => {
  it('adds the v2 stores without rewriting legacy sessions, expressions, or audio', async () => {
    const legacyAudio = new Blob(['legacy original recording'], {
      type: 'audio/webm',
    })
    await seedVersionOneDatabase(databaseName, legacyAudio)

    const storage = createAdapter()

    expect(await storage.getSession(legacySession.id)).toEqual(legacySession)
    expect(await storage.getExpression(legacyExpression.id)).toEqual(
      legacyExpression,
    )
    const restoredAudio = await storage.getAudio('legacy-audio')
    expect(restoredAudio?.type).toBe('audio/webm')
    expect(await restoredAudio?.text()).toBe('legacy original recording')

    await storage.close()
    const database = await openDatabase(databaseName)
    expect(database.version).toBe(4)
    expect(Array.from(database.objectStoreNames).sort()).toEqual(
      [
        'apiConfigurations',
        'appMeta',
        'audio',
        'backendConfig',
        'expressions',
        'importSources',
        'importedFiles',
        'importedQuestions',
        'sessions',
        'ttsCache',
      ].sort(),
    )
    const v2StoreNames = [
      'importSources',
      'importedQuestions',
      'importedFiles',
      'apiConfigurations',
      'ttsCache',
    ]
    const schemaTransaction = database.transaction(v2StoreNames, 'readonly')
    for (const storeName of v2StoreNames) {
      expect(schemaTransaction.objectStore(storeName).keyPath).toBe('id')
    }
    database.close()

    const reopened = createAdapter()
    expect(await reopened.listSessions()).toEqual([legacySession])
    expect(await reopened.listExpressions()).toEqual([legacyExpression])
    expect(await reopened.hasAudio('legacy-audio')).toBe(true)
  })

  it('can atomically save and reopen an import bundle immediately after migration', async () => {
    await seedVersionOneDatabase(
      databaseName,
      new Blob(['legacy audio'], { type: 'audio/webm' }),
    )
    const storage = createAdapter()
    const bundle = createImportBundle('migrated-import', 'txt')

    await storage.saveImportBundle(bundle)
    await storage.close()

    const reopened = createAdapter()
    expect(await reopened.getImportSource(bundle.source.id)).toEqual(
      bundle.source,
    )
    expect(await reopened.listImportedQuestions()).toEqual(bundle.questions)
    const restoredFile = await reopened.getImportedFile(
      bundle.source.originalFileId,
    )
    expect(restoredFile?.type).toBe(bundle.originalFile.type)
    expect(await restoredFile?.text()).toBe(await bundle.originalFile.text())
    expect(await reopened.getSession(legacySession.id)).toEqual(legacySession)
  })

  it('isolates malformed legacy metadata while preserving the original audio store', async () => {
    await seedVersionOneDatabase(
      databaseName,
      new Blob(['irreplaceable legacy audio'], { type: 'audio/webm' }),
    )
    const legacyDatabase = await openDatabase(databaseName, 1)
    const corruptTransaction = legacyDatabase.transaction(
      ['sessions', 'expressions'],
      'readwrite',
    )
    corruptTransaction.objectStore('sessions').put({
      id: 'corrupt-legacy-session',
      attempts: 'not-an-array',
    })
    corruptTransaction.objectStore('expressions').put({
      id: 'corrupt-legacy-expression',
      text: '',
    })
    await transactionComplete(corruptTransaction)
    legacyDatabase.close()

    const migrated = createAdapter()
    expect(await migrated.listSessions()).toEqual([legacySession])
    expect(await migrated.getSession('corrupt-legacy-session')).toBeNull()
    expect(await migrated.listExpressions()).toEqual([legacyExpression])
    expect(
      await migrated.getExpression('corrupt-legacy-expression'),
    ).toBeNull()
    expect(await migrated.hasAudio('legacy-audio')).toBe(true)
    expect(await (await migrated.getAudio('legacy-audio'))?.text()).toBe(
      'irreplaceable legacy audio',
    )

    await migrated.close()
    const rawDatabase = await openDatabase(databaseName)
    expect(await countRecords(rawDatabase, 'sessions')).toBe(2)
    expect(await countRecords(rawDatabase, 'expressions')).toBe(2)
    expect(await countRecords(rawDatabase, 'audio')).toBe(1)
    rawDatabase.close()
  })
})

describe('IndexedDbStorage v2 import integrity', () => {
  it('filters corrupt records independently without deleting valid or corrupt data', async () => {
    const storage = createAdapter()
    const bundle = createImportBundle('valid-import', 'md')
    await storage.saveImportBundle(bundle)
    await storage.close()

    const database = await openDatabase(databaseName)
    const transaction = database.transaction(
      [
        'importSources',
        'importedQuestions',
        'importedFiles',
        'apiConfigurations',
      ],
      'readwrite',
    )
    transaction.objectStore('importSources').put({ id: 'corrupt-source' })
    transaction.objectStore('importedQuestions').put({
      id: 'p1-corrupt-record',
      sourceId: bundle.source.id,
    })
    transaction.objectStore('importedFiles').put({
      id: 'corrupt-file',
      blob: 'not a Blob',
    })
    transaction.objectStore('apiConfigurations').put({
      id: 'text-ai',
      endpoint: 'http://insecure.example.test',
      apiKey: 'must-not-be-accepted-from-indexeddb',
    })
    await transactionComplete(transaction)
    database.close()

    const reopened = createAdapter()
    expect(await reopened.listImportSources()).toEqual([bundle.source])
    expect(await reopened.getImportSource('corrupt-source')).toBeNull()
    expect(await reopened.listImportedQuestions()).toEqual(bundle.questions)
    expect(await reopened.getImportedFile('corrupt-file')).toBeNull()
    // V1.1 遗留的 apiConfigurations store 自 Backend 化后不再读写:
    // 即使其中有疑似密钥字段的历史记录,也不参与任何读取路径,原样保留。
    await reopened.close()
    const rawDatabase = await openDatabase(databaseName)
    expect(await countRecords(rawDatabase, 'importSources')).toBe(2)
    expect(await countRecords(rawDatabase, 'importedQuestions')).toBe(3)
    expect(await countRecords(rawDatabase, 'importedFiles')).toBe(2)
    expect(await countRecords(rawDatabase, 'apiConfigurations')).toBe(1)
    rawDatabase.close()
  })

  it('rolls back every new record when the import transaction aborts', async () => {
    const storage = createAdapter()
    const existing = createImportBundle('existing-import', 'txt')
    const failing = createImportBundle('failing-import', 'pdf')
    await storage.saveImportBundle(existing)

    const originalPut = Object.getOwnPropertyDescriptor(
      IDBObjectStore.prototype,
      'put',
    )?.value as IDBObjectStore['put'] | undefined
    if (originalPut === undefined) {
      throw new Error('IndexedDB put implementation is unavailable in the test.')
    }
    let injectedFailure = false
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (
          !injectedFailure &&
          this.name === 'importedQuestions' &&
          (value as { sourceId?: unknown }).sourceId === failing.source.id
        ) {
          injectedFailure = true
          const transaction = this.transaction
          const failure = new DOMException(
            'Simulated import write failure.',
            'AbortError',
          )
          const failedRequest = {
            onerror: null,
            onsuccess: null,
            get error() {
              return failure
            },
          } as unknown as IDBRequest<IDBValidKey>
          queueMicrotask(() => {
            transaction.abort()
            failedRequest.onerror?.(new Event('error'))
          })
          return failedRequest
        }

        return key === undefined
          ? originalPut.call(this, value)
          : originalPut.call(this, value, key)
      })

    await expect(storage.saveImportBundle(failing)).rejects.toThrow(
      'Simulated import write failure.',
    )
    putSpy.mockRestore()

    expect(await storage.listImportSources()).toEqual([existing.source])
    expect(await storage.listImportedQuestions()).toEqual(existing.questions)
    expect(
      await storage.getImportedFile(failing.source.originalFileId),
    ).toBeNull()
    expect(
      await storage.getImportedFile(existing.source.originalFileId),
    ).not.toBeNull()
  })

  it('rejects inconsistent bundles before writing any partial records', async () => {
    const storage = createAdapter()
    const wrongSize = createImportBundle('wrong-size', 'png')
    wrongSize.source = {
      ...wrongSize.source,
      fileSize: wrongSize.source.fileSize + 1,
    }

    await expect(storage.saveImportBundle(wrongSize)).rejects.toThrow(
      'Imported file size does not match its metadata.',
    )

    const wrongSource = createImportBundle('wrong-source', 'jpg')
    wrongSource.questions[0] = {
      ...wrongSource.questions[0]!,
      sourceId: 'another-source',
    }
    await expect(storage.saveImportBundle(wrongSource)).rejects.toThrow(
      'Every imported question must reference its source.',
    )

    expect(await storage.listImportSources()).toEqual([])
    expect(await storage.listImportedQuestions()).toEqual([])
    expect(
      await storage.getImportedFile(wrongSize.source.originalFileId),
    ).toBeNull()
    expect(
      await storage.getImportedFile(wrongSource.source.originalFileId),
    ).toBeNull()
  })
})

function createImportBundle(
  marker: string,
  format: ImportSource['format'],
): ImportBundle {
  const sourceId = `source-${marker}`
  const originalFile = new Blob([`synthetic ${marker} fixture`], {
    type: mimeTypeFor(format),
  })
  const source: ImportSource = {
    id: sourceId,
    fileName: `${marker}.${format}`,
    mimeType: originalFile.type,
    fileSize: originalFile.size,
    format,
    extractionMode: extractionModeFor(format),
    extractedText: 'Part 1\nTopic: Home\nWhat do you like about your home?',
    originalFileId: `file-${marker}`,
    importedAt: NOW,
  }
  const firstQuestionId = `p1-${marker}-one`
  const secondQuestionId = `p2-${marker}-two`
  const questions: ImportedQuestionRecord[] = [
    {
      id: firstQuestionId,
      sourceId,
      question: {
        id: firstQuestionId,
        part: 1,
        topic: 'Home',
        prompt: 'What do you like about your home?',
      },
      sourcePage: null,
      createdAt: NOW,
    },
    {
      id: secondQuestionId,
      sourceId,
      question: {
        id: secondQuestionId,
        part: 2,
        topic: 'Places',
        prompt: 'Describe a peaceful place you enjoy visiting.',
        cuePoints: ['where it is', 'why you enjoy visiting it'],
      },
      sourcePage: format === 'pdf' ? 2 : null,
      createdAt: NOW,
    },
  ]

  return { source, originalFile, questions }
}

function extractionModeFor(
  format: ImportSource['format'],
): ImportSource['extractionMode'] {
  switch (format) {
    case 'txt':
    case 'md':
      return 'plain-text'
    case 'docx':
      return 'docx'
    case 'pdf':
      return 'pdf-text'
    case 'jpg':
    case 'png':
      return 'image-ocr'
  }
}

function mimeTypeFor(format: ImportSource['format']): string {
  switch (format) {
    case 'txt':
      return 'text/plain'
    case 'md':
      return 'text/markdown'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'pdf':
      return 'application/pdf'
    case 'jpg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
  }
}

async function seedVersionOneDatabase(
  name: string,
  audio: Blob,
): Promise<void> {
  const database = await openDatabase(name, 1, (upgradeDatabase) => {
    upgradeDatabase.createObjectStore('sessions', { keyPath: 'id' })
    upgradeDatabase.createObjectStore('expressions', { keyPath: 'id' })
    upgradeDatabase.createObjectStore('audio', { keyPath: 'id' })
  })
  const transaction = database.transaction(
    ['sessions', 'expressions', 'audio'],
    'readwrite',
  )
  transaction.objectStore('sessions').put(legacySession)
  transaction.objectStore('expressions').put(legacyExpression)
  transaction.objectStore('audio').put({ id: 'legacy-audio', blob: audio })
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

function countRecords(
  database: IDBDatabase,
  storeName: string,
): Promise<number> {
  const transaction = database.transaction(storeName, 'readonly')
  const request = transaction.objectStore(storeName).count()
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Unable to count test records.'))
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
