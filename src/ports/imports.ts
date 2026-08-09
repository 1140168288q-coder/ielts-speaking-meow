import type {
  ApiCapability,
  ApiConfiguration,
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

/** Non-secret provider settings. API keys use SecureSecretStorage instead. */
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
