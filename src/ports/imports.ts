import type {
  ImportedQuestionRecord,
  ImportSource,
  TtsCacheEntry,
} from '../domain'

/**
 * V1.1 遗留的用户侧 API 配置类型。自 Backend 化后不再写入,仅保留
 * 接口与存储以兼容既有数据。
 */
export type ApiCapability = 'text-ai' | 'stt' | 'voice-ai'

export type ApiConfiguration = {
  id: ApiCapability
} & Record<string, unknown>

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

/** V1.1 遗留的用户侧 API 配置存储,自 Backend 化后仅用于数据兼容。 */
export interface ApiConfigurationStorage {
  getApiConfiguration(
    capability: ApiCapability,
  ): Promise<ApiConfiguration | null>
  listApiConfigurations(): Promise<ApiConfiguration[]>
  upsertApiConfiguration(configuration: ApiConfiguration): Promise<void>
  deleteApiConfiguration(capability: ApiCapability): Promise<void>
}

export interface TtsCacheStorage {
  getTtsCacheEntry(cacheId: string): Promise<{
    metadata: TtsCacheEntry
    audio: Blob
  } | null>
  putTtsCacheEntry(metadata: TtsCacheEntry, audio: Blob): Promise<void>
}
