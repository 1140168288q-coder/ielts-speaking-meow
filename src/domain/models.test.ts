import { describe, expect, it } from 'vitest'
import {
  aiFeedbackSchema,
  questionBankSchema,
  questionSchema,
  savedExpressionSchema,
} from './models'

const feedbackItem = {
  category: 'fluency' as const,
  kind: 'focus' as const,
  title: 'Use a short pause',
  observation: 'The answer contains a clear filler word.',
  action: 'Pause silently before the next phrase.',
  evidence: 'um ×1',
}

describe('question schemas', () => {
  it('requires cue points for a Part 2 question', () => {
    const result = questionSchema.safeParse({
      id: 'p2-place-001',
      part: 2,
      topic: 'Places',
      prompt: 'Describe a place you enjoy visiting.',
    })

    expect(result.success).toBe(false)
  })

  it('requires a complete question bank with unique ids', () => {
    const result = questionBankSchema.safeParse([
      {
        id: 'p1-home-001',
        part: 1,
        topic: 'Home',
        prompt: 'Where do you live?',
      },
      {
        id: 'p1-home-001',
        part: 1,
        topic: 'Home',
        prompt: 'What do you like about your home?',
      },
      {
        id: 'p2-place-001',
        part: 2,
        topic: 'Places',
        prompt: 'Describe a place you enjoy visiting.',
        cuePoints: ['where it is', 'why you enjoy it'],
      },
      {
        id: 'p3-cities-001',
        part: 3,
        topic: 'Cities',
        prompt: 'How can cities improve public spaces?',
      },
    ])

    expect(result.success).toBe(false)
  })
})

describe('AI feedback schema', () => {
  it('accepts a small structured response', () => {
    const result = aiFeedbackSchema.safeParse({
      keyIssues: [feedbackItem],
      secondAttemptTips: ['Pause briefly before the main reason.'],
      revisions: {
        minimalFix: 'I go there twice a week.',
        naturalVersion: null,
        stretchVersion: null,
      },
    })

    expect(result.success).toBe(true)
  })

  it('rejects more than three issues or tips', () => {
    const tooManyIssues = aiFeedbackSchema.safeParse({
      keyIssues: Array.from({ length: 4 }, () => feedbackItem),
      secondAttemptTips: [],
      revisions: {
        minimalFix: null,
        naturalVersion: null,
        stretchVersion: null,
      },
    })
    const tooManyTips = aiFeedbackSchema.safeParse({
      keyIssues: [],
      secondAttemptTips: ['one', 'two', 'three', 'four'],
      revisions: {
        minimalFix: null,
        naturalVersion: null,
        stretchVersion: null,
      },
    })

    expect(tooManyIssues.success).toBe(false)
    expect(tooManyTips.success).toBe(false)
  })

  it('rejects vendor-specific fields outside the contract', () => {
    const result = aiFeedbackSchema.safeParse({
      keyIssues: [],
      secondAttemptTips: [],
      revisions: {
        minimalFix: null,
        naturalVersion: null,
        stretchVersion: null,
      },
      modelScore: 8.5,
    })

    expect(result.success).toBe(false)
  })
})

describe('saved expression schema', () => {
  it('keeps the source practice and creation time', () => {
    const expression = savedExpressionSchema.parse({
      id: 'expression-1',
      text: 'It gives me a chance to unwind.',
      topic: 'Weekends',
      questionId: 'p1-weekends-001',
      sessionId: 'session-1',
      sourceAttempt: 2,
      createdAt: '2026-08-09T10:00:00.000Z',
    })

    expect(expression.sourceAttempt).toBe(2)
  })
})
