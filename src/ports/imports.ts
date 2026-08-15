import type {
  ImportedQuestionRecord,
  ImportSource,
  TtsCacheEntry,
} from '../domain'

export interface ImportBundle {
  source: ImportSource
  originalFile: Blob
  questions: ImportedQuestionRecord[]
}

/** Durable local storage for user-imported private material. */
export interface ImportStorage {
  saveImportBundle(bundle: ImportBundle): Promise<void>
  getImportSource(sourceId: string): Promise<ImportSource | null>
  listImportSources(): Promise<ImportSource[]>
  getImportedFile(fileId: string): Promise<Blob | null>
  listImportedQuestions(): Promise<ImportedQuestionRecord[]>
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
