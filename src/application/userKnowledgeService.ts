import {
  LOCAL_DEFAULT_USER_ID,
  userKnowledgeEntrySchema,
  userKnowledgeSourceSchema,
  type UserKnowledgeEntry,
  type UserKnowledgeSource,
} from '../domain'
import { chunkKnowledgeText, type UserKnowledgeDraft } from '../domain/userKnowledge'
import type { MaterialExtraction } from './imports/materialExtractor'
import type { UserKnowledgeStorage } from '../ports/userKnowledge'
import type {
  UserKnowledgeOrganizer,
  UserKnowledgeOrganizeRequest,
  UserKnowledgeCandidate,
} from '../ports/ai'

export interface UserKnowledgeDraftWithExtraction {
  file: File
  source: UserKnowledgeSource
  extraction: MaterialExtraction
  chunks: UserKnowledgeOrganizeRequest['chunks']
}

export interface UserKnowledgeServiceOptions {
  storage: UserKnowledgeStorage
  extractor: { extract(file: File): Promise<MaterialExtraction> }
  getCurrentUserId?: () => string
  now?: () => Date
}

/** Local-first lifecycle for private teaching knowledge: extract -> draft -> confirm -> atomic save. */
export class UserKnowledgeService {
  private readonly getCurrentUserId: () => string
  private readonly now: () => Date

  constructor(private readonly options: UserKnowledgeServiceOptions) {
    this.getCurrentUserId = options.getCurrentUserId ?? (() => LOCAL_DEFAULT_USER_ID)
    this.now = options.now ?? (() => new Date())
  }

  async prepare(file: File): Promise<UserKnowledgeDraftWithExtraction> {
    const extraction = await this.options.extractor.extract(file)
    const sourceHash = await sha256(file)
    const sourceToken = sourceHash.slice(0, 32)
    const ownerId = this.getCurrentUserId()
    const ownerToken = stableTextKey(ownerId).slice(0, 8)
    const now = this.now().toISOString()
    const source = userKnowledgeSourceSchema.parse({
      id: `knowledge-${ownerToken}-${sourceToken}`,
      ownerId,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      format: extraction.format,
      extractionMode: extraction.mode,
      originalFileId: `knowledge-file-${ownerToken}-${sourceToken}`,
      sourceSha256: sourceHash,
      title: file.name.replace(/\.[^.]+$/u, '').slice(0, 160) || '我的知识资料',
      status: 'draft',
      entryCount: 0,
      importedAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    if (extraction.text.length > 48_000) {
      throw new Error('知识库整理上限为 48,000 字符，请按章节或页码拆分文件后再导入。')
    }
    const chunks = chunkKnowledgeText(extraction.pages)
    if (chunks.length === 0) {
      throw new Error('文件中没有足够长的可整理文本，请换一个文件或补充内容。')
    }
    if (chunks.length >= 24 && chunks.reduce((total, chunk) => total + chunk.text.length, 0) < extraction.text.length * 0.85) {
      throw new Error('文件分块超过 24 个，请按章节或页码拆分文件后再整理。')
    }
    return { file, source, extraction, chunks }
  }

  async organize(
    draft: UserKnowledgeDraftWithExtraction,
    organizer: UserKnowledgeOrganizer,
  ): Promise<UserKnowledgeCandidate[]> {
    if (draft.chunks.length === 0) throw new Error('没有可整理的文本分块。')
    return organizer.organizeKnowledge({
      fileName: draft.source.fileName,
      sourceHash: draft.source.sourceSha256,
      chunks: draft.chunks,
      idempotencyKey: `knowledge-organize-${draft.source.ownerId}-${draft.source.sourceSha256}`,
    })
  }

  localCandidates(draft: UserKnowledgeDraftWithExtraction): UserKnowledgeCandidate[] {
    return draft.chunks.slice(0, 12).map((chunk) => ({
      title: chunk.section ?? `知识条目 ${chunk.index + 1}`,
      body: chunk.text.slice(0, 2_000),
      originalExcerpt: chunk.text.slice(0, 600),
      sourcePage: chunk.pageNumber,
      sourceSection: chunk.section,
      part: 'all' as const,
      topics: [],
      keywords: [],
      tags: ['本地整理'],
      functions: ['topic'] as const,
      level: 'developing' as const,
      confidence: 'low' as const,
    }))
  }

  async commit(
    draft: UserKnowledgeDraftWithExtraction,
    candidates: UserKnowledgeCandidate[],
  ): Promise<{ source: UserKnowledgeSource; entries: UserKnowledgeEntry[] }> {
    if (draft.source.ownerId !== this.getCurrentUserId()) {
      throw new Error('当前账号已变化，请重新导入这份知识资料。')
    }
    if (candidates.length === 0) throw new Error('请至少保留一条知识条目。')
    const now = this.now().toISOString()
    const ownerToken = stableTextKey(draft.source.ownerId).slice(0, 8)
    const entries = candidates.slice(0, 60).map((candidate, index) => {
      const entryKey = stableTextKey(`${candidate.title}\u0000${candidate.body}`)
      return userKnowledgeEntrySchema.parse({
        id: `knowledge-entry-${ownerToken}-${draft.source.sourceSha256.slice(0, 16)}-${entryKey}-${index + 1}`,
        sourceId: draft.source.id,
        ownerId: draft.source.ownerId,
        title: candidate.title,
        body: candidate.body,
        originalExcerpt: candidate.originalExcerpt,
        sourcePage: candidate.sourcePage,
        sourceSection: candidate.sourceSection,
        part: candidate.part,
        topics: candidate.topics,
        keywords: candidate.keywords,
        tags: candidate.tags,
        functions: candidate.functions,
        level: candidate.level,
        confidence: candidate.confidence,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
    })
    const source = userKnowledgeSourceSchema.parse({
      ...draft.source,
      status: 'ready',
      entryCount: entries.length,
      updatedAt: now,
    })
    const bundle: UserKnowledgeDraft = {
      source,
      entries,
      originalFile: draft.file,
    }
    await this.options.storage.saveUserKnowledgeBundle(bundle)
    return { source, entries }
  }
}

async function sha256(file: Blob): Promise<string> {
  if (globalThis.crypto?.subtle !== undefined) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  const text = new TextDecoder().decode(await file.arrayBuffer())
  const short = stableTextKey(text)
  return short.repeat(8).slice(0, 64)
}

function stableTextKey(value: string): string {
  let first = 2166136261
  let second = 2654435761
  for (const character of value) {
    const code = character.charCodeAt(0)
    first = Math.imul(first ^ code, 16777619)
    second = Math.imul(second ^ code, 2246822519)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}
