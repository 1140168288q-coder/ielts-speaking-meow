import { describe, expect, it } from 'vitest'
import type { Question, SavedExpression, TrainingSession } from './models'
import type { PersonalMaterial } from './personalMaterials'
import {
  buildLearnerContext,
  buildLearnerMemory,
  findReusableExpressions,
  findReusablePersonalMaterials,
} from './userMemory'
import { buildTutorContext, retrieveTutorKnowledge } from './tutorKnowledge'

const question: Question = {
  id: 'p2-describe-a-boring-place-001',
  part: 2,
  topic: 'boring place',
  prompt: 'Describe a boring place',
  category: 'PLACE',
  isNew: true,
  cuePoints: [
    'Where it is',
    'Who you went there with',
    'What you did there',
    'And explain why you think it is a boring place',
  ],
  relatedPart3Ids: [],
}

const expression: SavedExpression = {
  id: 'expression-1',
  text: 'The place felt empty and too quiet, so time passed very slowly.',
  topic: 'boring place',
  questionId: 'p2-describe-a-boring-place-other',
  sessionId: 'session-1',
  sourceAttempt: 2,
  createdAt: '2026-08-01T08:00:00.000Z',
  reviewCount: 1,
  lastReviewedAt: null,
  reuseCount: 2,
}

const session: TrainingSession = {
  id: 'session-1',
  questionId: question.id,
  status: 'completed',
  attempts: [],
  localFeedback: [],
  aiFeedback: {
    summary: '回答切题。',
    strengths: ['有具体例子。'],
    problems: ['讲过去经历时过去时态不稳。'],
    grammarSuggestions: ['先想好动词过去式。'],
    vocabularySuggestions: [],
    improvedAnswer: 'The place felt empty and too quiet.',
    referenceAnswers: [],
  },
  comparison: null,
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-02T08:00:00.000Z',
}

const material: PersonalMaterial = {
  id: 'material-1',
  ownerId: 'owner-1',
  title: 'A quiet riverside walk',
  content: 'I often walk beside the Yangtze with my father on Sunday mornings.',
  kind: 'experience',
  topicTags: ['river', 'family'],
  questionIds: [question.id],
  sourceSessionId: session.id,
  status: 'confirmed',
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-02T08:00:00.000Z',
  version: 1,
  deletedAt: null,
}

describe('userMemory', () => {
  it('reuses same-topic expressions before generic keyword matches', () => {
    const sameTopic = findReusableExpressions(question, [expression])
    expect(sameTopic).toHaveLength(1)
    expect(sameTopic[0]?.reason).toContain('同主题')

    const otherQuestion: Question = {
      id: 'p3-why-do-most-children-think-education-is-bori-001',
      part: 3,
      topic: 'education',
      prompt: 'Why do most children think education is boring?',
      part2QuestionId: question.id,
    }
    const crossTopic = findReusableExpressions(otherQuestion, [expression])
    expect(crossTopic.length).toBeGreaterThanOrEqual(1)
  })

  it('builds a compact learner context without leaking full history', () => {
    const memory = buildLearnerMemory(question, [session], [expression])
    expect(memory.topicPracticeCount).toBe(1)
    expect(memory.commonProblemThemes[0]).toContain('过去时')

    const context = buildLearnerContext(question, [session], [expression], [material])
    expect(context).toContain('本机历史')
    expect(context).toContain('过去时')
    expect(context).toContain(expression.text)
    expect(context).toContain(material.title)
    expect(context.length).toBeLessThan(1_201)
  })

  it('keeps personal materials separate and requires user confirmation', () => {
    const candidate = { ...material, id: 'material-2', status: 'candidate' as const }
    const matches = findReusablePersonalMaterials(question, [candidate, material])

    expect(matches).toHaveLength(1)
    expect(matches[0]?.material.id).toBe(material.id)
    expect(matches[0]?.reason).toContain('关联')
  })
})

describe('tutorKnowledge', () => {
  it('retrieves Part-specific teaching knowledge offline', () => {
    const docs = retrieveTutorKnowledge(question)
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((item) => item.doc.part === 'all' || item.doc.part === 2)).toBe(
      true,
    )
  })

  it('keeps the Backend context compact and score-free', () => {
    const context = buildTutorContext(question)
    expect(context.length).toBeLessThan(2_000)
    expect(context).not.toMatch(/band|score|pronunciation/i)
  })
})
