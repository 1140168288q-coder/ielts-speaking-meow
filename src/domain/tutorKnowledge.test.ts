import { describe, expect, it } from 'vitest'
import type { Question } from './models'
import {
  TUTOR_KNOWLEDGE_VERSION,
  TUTOR_KNOWLEDGE_SOURCE_FILE,
  TUTOR_KNOWLEDGE_SOURCE_SHA256,
  buildTutorContext,
  listTutorKnowledgeDocuments,
  retrieveTutorKnowledge,
} from './tutorKnowledge'

const questions: Question[] = [
  {
    id: 'p1-technology',
    part: 1,
    topic: 'technology',
    prompt: 'Do you often use mobile apps?',
  },
  {
    id: 'p2-place',
    part: 2,
    topic: 'a quiet place',
    prompt: 'Describe a quiet place you enjoy visiting',
    cuePoints: ['Where it is', 'What you do there', 'Why you like it'],
    relatedPart3Ids: [],
  },
  {
    id: 'p3-transport',
    part: 3,
    topic: 'public transport',
    prompt: 'How can governments improve public transport?',
  },
]

describe('versioned tutor knowledge', () => {
  it('ships a reviewed, source-labelled and duplicate-free local corpus', () => {
    const docs = listTutorKnowledgeDocuments()
    const ids = new Set(docs.map((doc) => doc.id))

    expect(TUTOR_KNOWLEDGE_VERSION).toMatch(/^2026\.08-v3$/)
    expect(docs.length).toBeGreaterThanOrEqual(30)
    expect(ids.size).toBe(docs.length)
    expect(docs.every((doc) => /^\d{4}-\d{2}-\d{2}$/.test(doc.reviewedAt))).toBe(true)
    expect(docs.every((doc) => doc.source === 'product-authored' || doc.source === 'official-guidance')).toBe(true)
    expect(TUTOR_KNOWLEDGE_SOURCE_FILE).toBe('雅思口语备考知识库_流利优先.md')
    expect(TUTOR_KNOWLEDGE_SOURCE_SHA256).toMatch(/^[a-f0-9]{64}$/)
    expect(docs.every((doc) => doc.functions.length > 0 && doc.sourceSection.length > 0)).toBe(true)

    const official = docs.filter((doc) => doc.source === 'official-guidance')
    expect(official.length).toBeGreaterThan(0)
    expect(official.every((doc) => doc.sourceUrl?.startsWith('https://ielts.org/'))).toBe(true)
  })

  it.each(questions)('returns deterministic Part-safe results for $id', (question) => {
    const first = retrieveTutorKnowledge(question, 3)
    const second = retrieveTutorKnowledge(question, 3)

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
    expect(first.length).toBeLessThanOrEqual(3)
    expect(first.every(({ doc }) => doc.part === 'all' || doc.part === question.part)).toBe(true)

    const context = buildTutorContext(question, 3)
    expect(context.length).toBeLessThan(2_000)
    expect(context).not.toMatch(/band|score|pronunciation/i)
  })

  it('honours a smaller retrieval limit', () => {
    expect(retrieveTutorKnowledge(questions[2] as Question, 1)).toHaveLength(1)
  })

  it('supports need and learner-level metadata without retrieving scoring or pronunciation chunks', () => {
    const docs = retrieveTutorKnowledge(questions[1] as Question, 8, {
      learnerLevel: 'basic',
      need: 'answer-planning',
    })

    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every(({ doc }) =>
      !doc.functions.includes('scoring') && !doc.functions.includes('pronunciation'),
    )).toBe(true)
  })
})
