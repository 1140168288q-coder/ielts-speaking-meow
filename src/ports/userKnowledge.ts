import type {
  UserKnowledgeDraft,
  UserKnowledgeEntry,
  UserKnowledgeSource,
} from '../domain/userKnowledge'

export interface UserKnowledgeStorage {
  saveUserKnowledgeBundle(bundle: UserKnowledgeDraft): Promise<void>
  listUserKnowledgeSources(ownerId: string, options?: { includeDeleted?: boolean }): Promise<UserKnowledgeSource[]>
  listUserKnowledgeEntries(ownerId: string, options?: { includeDeleted?: boolean }): Promise<UserKnowledgeEntry[]>
  updateUserKnowledgeSource(source: UserKnowledgeSource): Promise<void>
  updateUserKnowledgeEntry(entry: UserKnowledgeEntry): Promise<void>
  deleteUserKnowledgeSource(sourceId: string, ownerId: string, deletedAt: string): Promise<void>
  deleteUserKnowledgeEntry(entryId: string, ownerId: string, deletedAt: string): Promise<void>
  getUserKnowledgeFile(fileId: string): Promise<Blob | null>
}
