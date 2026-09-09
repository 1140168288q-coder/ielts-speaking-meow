import type {
  ImportedQuestionRecord,
  ImportSource,
  TtsCacheEntry,
} from '../domain'
import type { QuestionBankExclusion, QuestionExclusion } from '../domain/questionManagement'

export interface ImportBundle {
  source: ImportSource
  originalFile: Blob
  questions: ImportedQuestionRecord[]
}

/**
 * The state transition used by “导入并换季”. The imported bundle and these
 * exclusion records are committed together by IndexedDB so a failed write
 * leaves the previous active bank untouched.
 */
export interface ImportQuestionBankReplacement {
  bankExclusion: QuestionBankExclusion
  questionExclusions: QuestionExclusion[]
}

/** Durable local storage for user-imported private material. */
export interface ImportStorage {
  saveImportBundle(bundle: ImportBundle): Promise<void>
  saveImportBundleAndReplaceQuestionBank?(
    bundle: ImportBundle,
    replacement: ImportQuestionBankReplacement,
  ): Promise<void>
  getImportSource(sourceId: string): Promise<ImportSource | null>
  listImportSources(): Promise<ImportSource[]>
  getImportedFile(fileId: string): Promise<Blob | null>
  listImportedQuestions(ownerId: string): Promise<ImportedQuestionRecord[]>
  upsertImportSourceMetadata?(source: ImportSource): Promise<void>
  upsertImportedQuestion?(record: ImportedQuestionRecord): Promise<void>
}

export interface TtsCacheStorage {
  getTtsCacheEntry(cacheId: string): Promise<{
    metadata: TtsCacheEntry
    audio: Blob
  } | null>
  putTtsCacheEntry(metadata: TtsCacheEntry, audio: Blob): Promise<void>
  /**
   * 已落盘的 TTS 音色配置版本。缓存键包含 voiceConfigVersion,
   * 版本升级时清理一次旧缓存,避免换音色/改语速后仍命中旧音频。
   */
  getVoiceConfigVersion(): Promise<number | null>
  setVoiceConfigVersion(version: number): Promise<void>
}
