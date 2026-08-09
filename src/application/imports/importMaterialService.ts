import {
  candidateToQuestion,
  importQuestionCandidateSchema,
  importSourceSchema,
  importedQuestionRecordSchema,
  type ImportQuestionCandidate,
  type ImportSource,
  type ImportedQuestionRecord,
} from '../../domain'
import type { ImportStorage } from '../../ports/imports'
import type { MaterialExtraction, MaterialExtractor } from './materialExtractor'
import { parseQuestionCandidates } from './questionCandidateParser'

export interface ImportDraft {
  file: File
  source: ImportSource
  extraction: MaterialExtraction
  candidates: ImportQuestionCandidate[]
}

export interface ImportMaterialServiceOptions {
  storage: ImportStorage
  extractor: MaterialExtractor
  now?: () => Date
  createId?: () => string
}

export class ImportMaterialService {
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(private readonly options: ImportMaterialServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? createRandomId
  }

  async prepare(file: File): Promise<ImportDraft> {
    const extraction = await this.options.extractor.extract(file)
    const sourceToken = this.createId()
    const source = importSourceSchema.parse({
      id: `import-${sourceToken}`,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      format: extraction.format,
      extractionMode: extraction.mode,
      extractedText: extraction.text,
      originalFileId: `import-file-${sourceToken}`,
      importedAt: this.now().toISOString(),
    })

    return {
      file,
      source,
      extraction,
      candidates: parseQuestionCandidates(extraction.pages),
    }
  }

  async commit(
    draft: ImportDraft,
    candidates: ImportQuestionCandidate[],
  ): Promise<ImportedQuestionRecord[]> {
    const createdAt = this.now().toISOString()
    const sourceToken = draft.source.id
      .replace(/^import-/, '')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 40)
    const validatedCandidates = candidates.map((candidate) =>
      importQuestionCandidateSchema.parse(candidate),
    )
    if (validatedCandidates.length === 0) {
      throw new Error('请至少选择一道有效题目，或先新增题目再导入。')
    }
    const questions = validatedCandidates.map((candidate, index) => {
      const questionId = `p${candidate.part}-import-${sourceToken}-${index + 1}`
      return importedQuestionRecordSchema.parse({
        id: questionId,
        sourceId: draft.source.id,
        question: candidateToQuestion(candidate, questionId),
        sourcePage: candidate.sourcePage,
        createdAt,
      })
    })

    await this.options.storage.saveImportBundle({
      source: draft.source,
      originalFile: draft.file,
      questions,
    })
    return questions
  }
}

function createRandomId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid !== undefined) {
    return uuid.toLowerCase()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
