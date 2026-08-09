import type {
  ImportQuestionCandidate,
  ImportedQuestionRecord,
  ImportSource,
} from '../../domain'
import type { ImportBundle, ImportStorage } from '../../ports/imports'
import {
  createFile,
  createImportFileFixture,
  SYNTHETIC_QUESTION,
} from '../../test/fixtures/importFiles'
import { ImportMaterialService } from './importMaterialService'
import { MaterialExtractor } from './materialExtractor'

const NOW = new Date('2026-08-10T08:30:00.000Z')

class CapturingImportStorage implements ImportStorage {
  readonly bundles: ImportBundle[] = []
  failure: Error | null = null

  saveImportBundle(bundle: ImportBundle): Promise<void> {
    if (this.failure !== null) {
      return Promise.reject(this.failure)
    }
    this.bundles.push(bundle)
    return Promise.resolve()
  }

  getImportSource(): Promise<ImportSource | null> {
    return Promise.resolve(null)
  }

  listImportSources(): Promise<ImportSource[]> {
    return Promise.resolve([])
  }

  getImportedFile(): Promise<Blob | null> {
    return Promise.resolve(null)
  }

  listImportedQuestions(): Promise<ImportedQuestionRecord[]> {
    return Promise.resolve([])
  }
}

function createService(storage: CapturingImportStorage) {
  return new ImportMaterialService({
    storage,
    extractor: new MaterialExtractor(null),
    now: () => NOW,
    createId: () => 'fixture-token',
  })
}

describe('ImportMaterialService', () => {
  it('prepares a local preview without persisting private source material', async () => {
    const storage = new CapturingImportStorage()
    const service = createService(storage)
    const file = createImportFileFixture('txt')

    const draft = await service.prepare(file)

    expect(storage.bundles).toEqual([])
    expect(draft.file).toBe(file)
    expect(draft.source).toEqual({
      id: 'import-fixture-token',
      fileName: 'questions.txt',
      mimeType: 'text/plain',
      fileSize: file.size,
      format: 'txt',
      extractionMode: 'plain-text',
      extractedText: `Part 1\nTopic: Home\n${SYNTHETIC_QUESTION}`,
      originalFileId: 'import-file-fixture-token',
      importedAt: NOW.toISOString(),
    })
    expect(draft.candidates).toEqual([
      expect.objectContaining({
        part: 1,
        topic: 'Home',
        prompt: SYNTHETIC_QUESTION,
      }),
    ])
  })

  it('commits the confirmed questions and original file as one storage bundle', async () => {
    const storage = new CapturingImportStorage()
    const service = createService(storage)
    const draft = await service.prepare(createImportFileFixture('md'))

    const questions = await service.commit(draft, draft.candidates)

    expect(questions).toEqual([
      {
        id: 'p1-import-fixture-token-1',
        sourceId: draft.source.id,
        question: {
          id: 'p1-import-fixture-token-1',
          part: 1,
          topic: 'Home',
          prompt: SYNTHETIC_QUESTION,
        },
        sourcePage: null,
        createdAt: NOW.toISOString(),
      },
    ])
    expect(storage.bundles).toEqual([
      {
        source: draft.source,
        originalFile: draft.file,
        questions,
      },
    ])
  })

  it('adds speakable fallback cue points to a confirmed Part 2 candidate', async () => {
    const storage = new CapturingImportStorage()
    const service = createService(storage)
    const draft = await service.prepare(
      createFile(
        [
          'Part 2\nTopic: Places\nDescribe a peaceful place you enjoy visiting.',
        ],
        'part-two.txt',
        'text/plain',
      ),
    )

    const questions = await service.commit(draft, draft.candidates)
    const question = questions[0]?.question

    expect(question?.part).toBe(2)
    if (question?.part === 2) {
      expect(question.cuePoints).toEqual([
        'Explain the main details.',
        'Say why this is meaningful to you.',
      ])
    }
  })

  it('preserves an explicitly confirmed duplicate as a separate record', async () => {
    const storage = new CapturingImportStorage()
    const service = createService(storage)
    const draft = await service.prepare(createImportFileFixture('txt'))
    const duplicate: ImportQuestionCandidate = {
      ...draft.candidates[0]!,
      id: 'candidate-explicit-duplicate',
    }

    const questions = await service.commit(draft, [
      draft.candidates[0]!,
      duplicate,
    ])

    expect(questions.map((record) => record.id)).toEqual([
      'p1-import-fixture-token-1',
      'p1-import-fixture-token-2',
    ])
    expect(questions[0]?.question.prompt).toBe(questions[1]?.question.prompt)
  })

  it('rejects invalid edited candidates before opening storage', async () => {
    const storage = new CapturingImportStorage()
    const service = createService(storage)
    const draft = await service.prepare(createImportFileFixture('txt'))
    const invalid = {
      ...draft.candidates[0]!,
      prompt: ' ',
    }

    await expect(service.commit(draft, [invalid])).rejects.toThrow()
    expect(storage.bundles).toEqual([])
  })

  it('does not report a successful import when the atomic storage write fails', async () => {
    const storage = new CapturingImportStorage()
    storage.failure = new Error('Simulated atomic storage failure.')
    const service = createService(storage)
    const draft = await service.prepare(createImportFileFixture('txt'))

    await expect(service.commit(draft, draft.candidates)).rejects.toThrow(
      'Simulated atomic storage failure.',
    )
    expect(storage.bundles).toEqual([])
  })

  it('does not persist an import when no valid question is confirmed', async () => {
    const storage = new CapturingImportStorage()
    const service = createService(storage)
    const draft = await service.prepare(createImportFileFixture('txt'))

    await expect(service.commit(draft, [])).rejects.toThrow(
      '至少选择一道有效题目',
    )
    expect(storage.bundles).toEqual([])
  })
})
