import { describe, expect, it } from 'vitest'
import {
  aiFeedbackSchema,
  answerVersionOptionSchema,
  feedbackSummarySchema,
  practiceTextsSchema,
  questionBankSchema,
  questionSchema,
  savedExpressionSchema,
} from './models'

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
  const feedback = {
    summary: '回答切题，重点改进过去时态。',
    strengths: ['有具体例子。'],
    problems: ['过去时态混用。'],
    grammarSuggestions: ['先想好动词过去式。'],
    vocabularySuggestions: [],
    improvedAnswer: 'I like reading books because they help me relax.',
    referenceAnswers: [
      { label: '简单自然版', text: 'I like reading books because they help me relax.' },
      { label: '自然提升版', text: 'I enjoy reading books because they help me unwind.' },
      { label: '另一种表达版', text: 'Reading is my favourite way to relax.' },
    ],
  }

  it('accepts the V1.7 text-analysis contract', () => {
    const result = aiFeedbackSchema.safeParse(feedback)
    expect(result.success).toBe(true)
  })

  it('rejects more than three reference answers or suggestion items', () => {
    expect(
      aiFeedbackSchema.safeParse({
        ...feedback,
        problems: ['one', 'two', 'three', 'four'],
      }).success,
    ).toBe(false)
    expect(
      aiFeedbackSchema.safeParse({
        ...feedback,
        referenceAnswers: [
          ...feedback.referenceAnswers,
          { label: '第四个版本', text: 'A fourth version.' },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects fields outside the contract such as band scores or speech metrics', () => {
    const result = aiFeedbackSchema.safeParse({
      ...feedback,
      ieltsBand: 6.5,
      pronunciationScore: 8.5,
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

describe('feedback summary and answer version schemas', () => {
  it('accepts a Chinese summary with a problem and a suggestion', () => {
    const result = feedbackSummarySchema.safeParse({
      problem: '回答中填充词较多。',
      suggestion: '用短暂停顿代替填充词。',
    })
    expect(result.success).toBe(true)
  })

  it('keeps the legacy answer-version contract for reading V1.6 sessions', () => {
    const result = answerVersionOptionSchema.safeParse({
      style: '基础稳妥',
      text: 'I like reading at home.',
      hint: 'I like ...',
    })
    expect(result.success).toBe(true)
  })
})

describe('practice texts schema', () => {
  it('allows each line to be left blank', () => {
    const result = practiceTextsSchema.safeParse({
      top: '',
      middle: '',
      bottom: '',
    })
    expect(result.success).toBe(true)
  })
})
