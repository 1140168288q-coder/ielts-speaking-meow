import type {
  PracticeTexts,
  SavedExpression,
  TrainingSession,
} from '../domain/models'
import type { QuestionPracticeState } from '../domain/questionPracticeState'
import type { PersonalMaterial } from '../domain/personalMaterials'
import type { AudioStorage, LocalStorage } from '../ports/storage'
import { StorageBackupService } from './storageBackupService'

const NOW = '2026-08-14T08:00:00.000Z'

class MemoryStorage implements LocalStorage, AudioStorage {
  readonly sessions = new Map<string, TrainingSession>()
  readonly expressions = new Map<string, SavedExpression>()
  readonly questionStates = new Map<string, QuestionPracticeState>()
  readonly materials = new Map<string, PersonalMaterial>()
  readonly audio = new Map<string, Blob>()

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
})
