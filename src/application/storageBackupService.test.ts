import type {
  PracticeTexts,
  Question,
  SavedExpression,
  TrainingSession,
} from '../domain/models'
import type { AccountProfile } from '../domain/accounts'
import type { ImportedQuestionRecord, ImportSource } from '../domain/imports'
import type { QuestionPracticeState } from '../domain/questionPracticeState'
import type { PersonalMaterial } from '../domain/personalMaterials'
import type { ImportBundle } from '../ports/imports'
import type { AudioStorage, LocalStorage } from '../ports/storage'
import { StorageBackupService } from './storageBackupService'

const NOW = '2026-08-14T08:00:00.000Z'

class MemoryStorage implements LocalStorage, AudioStorage {
  readonly sessions = new Map<string, TrainingSession>()
  readonly expressions = new Map<string, SavedExpression>()
  readonly questionStates = new Map<string, QuestionPracticeState>()
  readonly materials = new Map<string, PersonalMaterial>()
  readonly audio = new Map<string, Blob>()
  readonly accounts = new Map<string, AccountProfile>()
  currentAccountId: string | null = null
  readonly importSources = new Map<string, ImportSource>()
  readonly importedQuestions = new Map<string, ImportedQuestionRecord>()
  readonly importedFiles = new Map<string, Blob>()

  upsertSession(session: TrainingSession): Promise<void> {
    this.sessions.set(session.id, structuredClone(session))
    return Promise.resolve()
  }
  getSession(id: string): Promise<TrainingSession | null> {
    return Promise.resolve(this.sessions.get(id) ?? null)
  }
  listSessions(): Promise<TrainingSession[]> {
    return Promise.resolve([...this.sessions.values()])
  }
  listQuestionPracticeStates(ownerId: string): Promise<QuestionPracticeState[]> {
    return Promise.resolve(
      [...this.questionStates.values()].filter((state) => state.ownerId === ownerId),
    )
  }
  saveQuestionPracticeState(state: QuestionPracticeState): Promise<void> {
    this.questionStates.set(state.id, structuredClone(state))
    return Promise.resolve()
  }
  upsertExpression(expression: SavedExpression): Promise<void> {
    this.expressions.set(expression.id, structuredClone(expression))
    return Promise.resolve()
  }
  getExpression(id: string): Promise<SavedExpression | null> {
    return Promise.resolve(this.expressions.get(id) ?? null)
  }
  listExpressions(): Promise<SavedExpression[]> {
    return Promise.resolve([...this.expressions.values()])
  }

  deleteExpression(expressionId: string): Promise<void> {
    this.expressions.delete(expressionId)
    return Promise.resolve()
  }
  upsertPersonalMaterial(material: PersonalMaterial): Promise<void> {
    this.materials.set(material.id, structuredClone(material))
    return Promise.resolve()
  }
  getPersonalMaterial(
    materialId: string,
    ownerId: string,
  ): Promise<PersonalMaterial | null> {
    const material = this.materials.get(materialId)
    return Promise.resolve(material?.ownerId === ownerId ? material : null)
  }
  listPersonalMaterials(ownerId: string): Promise<PersonalMaterial[]> {
    return Promise.resolve(
      [...this.materials.values()].filter(
        (material) => material.ownerId === ownerId,
      ),
    )
  }
  deletePersonalMaterial(
    materialId: string,
    ownerId: string,
  ): Promise<void> {
    if (this.materials.get(materialId)?.ownerId === ownerId) {
      this.materials.delete(materialId)
    }
    return Promise.resolve()
  }
  upsertAccount(account: AccountProfile): Promise<void> {
    this.accounts.set(account.id, structuredClone(account))
    return Promise.resolve()
  }
  getAccount(accountId: string): Promise<AccountProfile | null> {
    return Promise.resolve(this.accounts.get(accountId) ?? null)
  }
  listAccounts(): Promise<AccountProfile[]> {
    return Promise.resolve([...this.accounts.values()].map((account) => structuredClone(account)))
  }
  getCurrentAccountId(): Promise<string | null> {
    return Promise.resolve(this.currentAccountId)
  }
  setCurrentAccountId(accountId: string): Promise<void> {
    this.currentAccountId = accountId
    return Promise.resolve()
  }
  saveImportBundle(bundle: ImportBundle): Promise<void> {
    this.importSources.set(bundle.source.id, structuredClone(bundle.source))
    this.importedFiles.set(bundle.source.originalFileId, bundle.originalFile)
    for (const question of bundle.questions) {
      this.importedQuestions.set(question.id, structuredClone(question))
    }
    return Promise.resolve()
  }
  getImportSource(sourceId: string): Promise<ImportSource | null> {
    return Promise.resolve(this.importSources.get(sourceId) ?? null)
  }
  listImportSources(): Promise<ImportSource[]> {
    return Promise.resolve([...this.importSources.values()].map((source) => structuredClone(source)))
  }
  getImportedFile(fileId: string): Promise<Blob | null> {
    return Promise.resolve(this.importedFiles.get(fileId) ?? null)
  }
  listImportedQuestions(ownerId: string): Promise<ImportedQuestionRecord[]> {
    return Promise.resolve(
      [...this.importedQuestions.values()]
        .filter((question) => question.ownerId === ownerId)
        .map((question) => structuredClone(question)),
    )
  }
  getPracticeTexts(): Promise<PracticeTexts | null> {
    return Promise.resolve(null)
  }
  savePracticeTexts(): Promise<void> {
    return Promise.resolve()
  }
  saveAudio(id: string, audio: Blob): Promise<void> {
    this.audio.set(id, audio)
    return Promise.resolve()
  }
  getAudio(id: string): Promise<Blob | null> {
    return Promise.resolve(this.audio.get(id) ?? null)
  }
  hasAudio(id: string): Promise<boolean> {
    return Promise.resolve(this.audio.has(id))
  }
  deleteAudio(id: string): Promise<void> {
    this.audio.delete(id)
    return Promise.resolve()
  }
}

const session: TrainingSession = {
  id: 'backup-session',
  questionId: 'p1-home-001',
  part: 1,
  status: 'first-review',
  attempts: [
    {
      id: 'backup-attempt',
      attemptNumber: 1,
      audio: {
        id: 'backup-audio',
        relativePath: 'indexeddb://audio/backup-audio',
        mimeType: 'audio/webm',
        durationMs: 2_000,
        createdAt: NOW,
      },
      transcript: {
        status: 'ready',
        text: 'I like reading at home.',
        originalText: null,
        source: 'manual',
        errorCode: null,
        updatedAt: NOW,
      },
      metrics: {
        durationMs: 2_000,
        wordCount: 6,
        wordsPerMinute: 180,
        fillerWords: [],
        fillerCount: 0,
        repeatedWords: [],
        repeatedWordCount: 0,
        acoustic: null,
        caveats: ['Approximate transcript metrics.'],
      },
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  localFeedback: [],
  aiFeedback: null,
  secondAttemptAnalysis: null,
  confirmedMemoryFacts: [],
  aiComparison: null,
  comparison: null,
  createdAt: NOW,
  updatedAt: NOW,
}

const expression: SavedExpression = {
  id: 'backup-expression',
  text: 'I like reading at home.',
  topic: 'Home',
  questionId: session.questionId,
  sessionId: session.id,
  sourceAttempt: 1,
  sourcePart: 1,
  createdAt: NOW,
}

const account: AccountProfile = {
  id: 'account-alice',
  userId: '00000000-0000-4000-8000-00000000000a',
  displayName: 'Alice',
  pinHash: null,
  createdAt: NOW,
  lastLoginAt: NOW,
}

const material: PersonalMaterial = {
  id: 'material-alice-home',
  ownerId: account.userId,
  title: 'My hometown',
  content: 'A quiet street near my home.',
  kind: 'place',
  sourcePart: 1,
  topicTags: ['hometown'],
  questionIds: ['p1-import-home'],
  sourceSessionId: null,
  status: 'confirmed',
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  deletedAt: null,
}

const importedQuestion: Question = {
  id: 'p1-import-home',
  part: 1,
  topic: 'Hometown',
  prompt: 'What do you like about your hometown?',
  difficulty: 'foundation',
  source: '用户导入材料',
}

const importSource: ImportSource = {
  id: 'source-alice-notes',
  fileName: 'notes.txt',
  mimeType: 'text/plain',
  fileSize: 15,
  format: 'txt',
  extractionMode: 'plain-text',
  extractedText: 'Hometown notes.',
  originalFileId: 'file-alice-notes',
  importedAt: NOW,
}

const importedQuestionRecord: ImportedQuestionRecord = {
  id: importedQuestion.id,
  sourceId: importSource.id,
  ownerId: account.userId,
  question: importedQuestion,
  sourcePage: null,
  createdAt: NOW,
}

describe('StorageBackupService', () => {
  it('round-trips sessions, expressions and the original recording', async () => {
    const source = new MemoryStorage()
    await source.upsertSession(session)
    await source.upsertExpression(expression)
    await source.saveAudio(
      'backup-audio',
      new Blob(['irreplaceable recording'], { type: 'audio/webm' }),
    )
    const exporter = new StorageBackupService(source, source, () => new Date(NOW))
    const backup = await exporter.exportBackup()

    const destination = new MemoryStorage()
    const importer = new StorageBackupService(destination, destination)
    await expect(importer.importBackup(backup)).resolves.toEqual({
      sessions: 1,
      expressions: 1,
      recordings: 1,
      personalMaterials: 0,
      importedQuestions: 0,
      accounts: 0,
      skippedNewer: 0,
    })
    expect(await destination.getSession(session.id)).toEqual(session)
    expect(await destination.getExpression(expression.id)).toEqual(expression)
    expect(await (await destination.getAudio('backup-audio'))?.text()).toBe(
      'irreplaceable recording',
    )
  })

  it('rejects backups that omit referenced recordings before writing metadata', async () => {
    const destination = new MemoryStorage()
    const importer = new StorageBackupService(destination, destination)
    const invalid = new Blob([
      JSON.stringify({
        format: 'ielts-speaking-meow-backup',
        formatVersion: 1,
        exportedAt: NOW,
        sessions: [session],
        expressions: [],
        audio: [],
      }),
    ])

    await expect(importer.importBackup(invalid)).rejects.toThrow(
      '备份缺少练习所需录音',
    )
    expect(destination.sessions.size).toBe(0)
  })

  it('keeps a newer local session when importing an older backup', async () => {
    const source = new MemoryStorage()
    await source.upsertSession(session)
    await source.saveAudio(
      'backup-audio',
      new Blob(['older recording'], { type: 'audio/webm' }),
    )
    const backup = await new StorageBackupService(
      source,
      source,
      () => new Date(NOW),
    ).exportBackup()

    const destination = new MemoryStorage()
    const newer = {
      ...session,
      status: 'completed' as const,
      updatedAt: '2026-08-14T09:00:00.000Z',
    }
    await destination.upsertSession(newer)

    await expect(
      new StorageBackupService(destination, destination).importBackup(backup),
    ).resolves.toMatchObject({
      sessions: 0,
      skippedNewer: 1,
    })
    expect((await destination.getSession(session.id))?.status).toBe('completed')
  })

  it('restores account-scoped materials and imported question dependencies', async () => {
    const source = new MemoryStorage()
    await source.upsertAccount(account)
    await source.setCurrentAccountId(account.id)
    await source.upsertSession({ ...session, ownerId: account.userId })
    await source.saveAudio(
      'backup-audio',
      new Blob(['Hometown recording.'], { type: 'audio/webm' }),
    )
    await source.upsertPersonalMaterial(material)
    await source.saveImportBundle({
      source: importSource,
      originalFile: new Blob(['Hometown notes.'], { type: 'text/plain' }),
      questions: [importedQuestionRecord],
    })

    const backup = await new StorageBackupService(
      source,
      source,
      () => new Date(NOW),
    ).exportBackup()
    const destination = new MemoryStorage()
    const result = await new StorageBackupService(destination, destination).importBackup(backup)

    expect(result).toMatchObject({
      accounts: 1,
      personalMaterials: 1,
      importedQuestions: 1,
    })
    expect(await destination.getAccount(account.id)).toEqual(account)
    expect(await destination.getCurrentAccountId()).toBe(account.id)
    expect(await destination.listPersonalMaterials(account.userId)).toEqual([material])
    expect(await destination.listImportedQuestions(account.userId)).toEqual([
      importedQuestionRecord,
    ])
    expect(await (await destination.getImportedFile(importSource.originalFileId))?.text()).toBe(
      'Hometown notes.',
    )
  })
})
