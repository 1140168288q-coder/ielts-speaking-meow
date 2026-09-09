import { describe, expect, it } from 'vitest'
import type { MaterialExtraction } from './imports/materialExtractor'
import { UserKnowledgeService } from './userKnowledgeService'
import type { UserKnowledgeDraft, UserKnowledgeEntry, UserKnowledgeSource } from '../domain/userKnowledge'
import type { UserKnowledgeStorage } from '../ports/userKnowledge'
import type { UserKnowledgeCandidate } from '../ports/ai'

class CaptureKnowledgeStorage implements UserKnowledgeStorage {
  bundles: UserKnowledgeDraft[] = []
  saveUserKnowledgeBundle(bundle: UserKnowledgeDraft): Promise<void> { this.bundles.push(bundle); return Promise.resolve() }
  listUserKnowledgeSources(): Promise<UserKnowledgeSource[]> { return Promise.resolve([]) }
  listUserKnowledgeEntries(): Promise<UserKnowledgeEntry[]> { return Promise.resolve([]) }
  updateUserKnowledgeSource(): Promise<void> { return Promise.resolve() }
  updateUserKnowledgeEntry(): Promise<void> { return Promise.resolve() }
  deleteUserKnowledgeSource(): Promise<void> { return Promise.resolve() }
  deleteUserKnowledgeEntry(): Promise<void> { return Promise.resolve() }
  getUserKnowledgeFile(): Promise<Blob | null> { return Promise.resolve(null) }
}

const extraction: MaterialExtraction = {
  format: 'txt',
  mode: 'plain-text',
  text: 'Use a direct answer and one clear reason in Part 1.',
  pages: [{ pageNumber: 1, text: 'Use a direct answer and one clear reason in Part 1.', usedOcr: false }],
  warnings: [],
}

describe('UserKnowledgeService', () => {
  it('scopes stable source, file and entry ids by owner', async () => {
    const file = Object.assign(new Blob(['same private notes'], { type: 'text/plain' }), {
      name: 'notes.txt',
    }) as File
    const storage = new CaptureKnowledgeStorage()
    const create = (ownerId: string) => new UserKnowledgeService({
      storage,
      extractor: { extract: () => Promise.resolve(extraction) },
      getCurrentUserId: () => ownerId,
      now: () => new Date('2026-09-09T00:00:00.000Z'),
    })
    const first = create('owner-a')
    const second = create('owner-b')
    const firstDraft = await first.prepare(file)
    const secondDraft = await second.prepare(file)
    expect(firstDraft.source.id).not.toBe(secondDraft.source.id)
    expect(firstDraft.source.originalFileId).not.toBe(secondDraft.source.originalFileId)

    const candidate: UserKnowledgeCandidate = {
      title: 'Part 1 structure',
      body: 'Answer directly and add one clear reason.',
      originalExcerpt: 'Answer directly and add one clear reason.',
      sourcePage: 1,
      sourceSection: null,
      part: 1 as const,
      topics: ['Part 1'],
      keywords: ['reason'],
      tags: ['structure'],
      functions: ['structure'],
      level: 'basic' as const,
      confidence: 'high' as const,
    }
    const firstResult = await first.commit(firstDraft, [candidate])
    const secondResult = await second.commit(secondDraft, [candidate])
    expect(firstResult.entries[0]?.id).not.toBe(secondResult.entries[0]?.id)
  })
})
