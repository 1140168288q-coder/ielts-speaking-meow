import { describe, expect, it } from 'vitest'
import { buildUserKnowledgeContext, retrieveUserKnowledge, type UserKnowledgeEntry } from './userKnowledge'
import type { Question } from './models'

const q: Question = { id: 'p1-home', part: 1, topic: 'Home', prompt: 'What do you like about your home?' }
const entry: UserKnowledgeEntry = {
  id: 'entry-home', sourceId: 'source-notes', ownerId: 'alice', title: 'Home answers',
  body: 'Answer directly, then add one concrete detail.', originalExcerpt: 'Answer directly',
  sourcePage: 1, sourceSection: 'Part 1', part: 1, topics: ['home'], keywords: ['home'],
  tags: ['structure'], functions: ['structure'], level: 'basic', confidence: 'high', enabled: true,
  createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', deletedAt: null,
}

describe('user knowledge retrieval', () => {
  it('returns owner-scoped enabled entries with stable source markers', () => {
    const result = retrieveUserKnowledge(q, [entry], [{ id: 'source-notes', ownerId: 'alice', fileName: 'notes.txt', mimeType: 'text/plain', fileSize: 10, format: 'txt', extractionMode: 'plain-text', originalFileId: 'file-notes', sourceSha256: 'a'.repeat(64), title: 'Notes', status: 'ready', entryCount: 1, importedAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', deletedAt: null }])
    expect(result).toHaveLength(1)
    expect(buildUserKnowledgeContext(q, [entry])).toContain('id=entry-home')
  })
})
