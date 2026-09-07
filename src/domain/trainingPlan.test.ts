import { describe, expect, it } from 'vitest'
import type { AiFeedback, Question, TrainingSession } from './models'
import { buildTrainingPlan, trainingPlanSchema } from './trainingPlan'

const question: Question = {
  id: 'p2-helpful-person',
  part: 2,
  topic: 'People',
  prompt: 'Describe a person who has helped you.',
  cuePoints: ['who this person is', 'how they helped you', 'how you felt'],
}

const feedback: AiFeedback = {
  summary: '回答切题。',
  strengths: [],
  problems: ['结尾还可以补一个具体感受。', '可以把原因说得更清楚。'],
  grammarSuggestions: ['过去经历要保持时态一致。'],
  vocabularySuggestions: [],
  referenceAnswers: [
    { label: '简单优化版', text: 'My teacher helped me with a project.' },
    { label: '自然提升版', text: 'My teacher gave me practical help with a project.' },
  ],
  naturalUpgradeSuggestions: { addableContent: [], advancedChanges: [] },
  answerFramework: [],
}

describe('trainingPlan', () => {
  it('builds a short source-backed plan without generating an answer', () => {
    const plan = buildTrainingPlan({
      question,
      teachingDocs: [{
        doc: {
          id: 'doc-1',
          part: 2,
          title: '经历题的具体细节',
          body: '先交代背景，再说行动和感受。',
          keywords: [],
          tags: [],
          functions: ['structure'],
          topics: [],
          questionTypes: [],
          level: 'basic',
          source: 'product-authored',
          confidence: 'high',
          reusable: true,
          sourceSection: 'test',
          reviewedAt: '2026-08-01',
        },
        score: 10,
        reason: 'Part 2 · answer-planning · 题型匹配',
      }],
      aiFeedback: feedback,
    })

    expect(trainingPlanSchema.parse(plan)).toEqual(plan)
    expect(plan.actions).toHaveLength(2)
    expect(plan.sources.some((source) => source.kind === 'teaching')).toBe(true)
    expect(plan.actions.join(' ')).not.toContain('My teacher')
    expect(plan.outcome.status).toBe('pending')
  })

  it('falls back to offline actions and records a completed outcome', () => {
    const session: TrainingSession = {
      id: 'session-1',
      questionId: question.id,
      part: 2,
      status: 'completed',
      attempts: [],
      localFeedback: [],
      aiFeedback: null,
      secondAttemptAnalysis: { correctedSentences: [], memoryCandidates: [] },
      confirmedMemoryFacts: [],
      comparison: null,
      createdAt: '2026-08-01T08:00:00.000Z',
      updatedAt: '2026-08-01T08:01:00.000Z',
    }
    const plan = buildTrainingPlan({ question, completedSession: session })

    expect(plan.sources[0]?.kind).toBe('fallback')
    expect(plan.outcome).toEqual({
      status: 'completed',
      evidence: ['已保存 0 次回答，可回看本次练习。'],
    })
  })
})
