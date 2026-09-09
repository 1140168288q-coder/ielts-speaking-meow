import { describe, expect, it } from 'vitest'
import {
  feedbackGenerationProfileSchema,
  feedbackLengthBudget,
} from './feedbackGeneration'

describe('feedback generation profiles', () => {
  it('keeps a clear soft length progression while preserving Part 2 as a long turn', () => {
    for (const part of [1, 3] as const) {
      const simple = feedbackLengthBudget(part, 'simple')
      const medium = feedbackLengthBudget(part, 'medium')
      const challenging = feedbackLengthBudget(part, 'challenging')
      expect(simple.maxWords).toBeLessThan(medium.maxWords)
      expect(medium.maxWords).toBeLessThan(challenging.maxWords)
    }
    expect(feedbackLengthBudget(2, 'simple').minWords).toBeGreaterThan(100)
    expect(feedbackLengthBudget(2, 'challenging').maxWords).toBeLessThanOrEqual(230)
  })

  it('rejects free-form profile values and keeps the stored shape strict', () => {
    expect(feedbackGenerationProfileSchema.safeParse({
      level: 'medium', style: 'british', profileVersion: 1,
    }).success).toBe(true)
    expect(feedbackGenerationProfileSchema.safeParse({
      level: 'band-8', style: 'british', profileVersion: 1,
    }).success).toBe(false)
    expect(feedbackGenerationProfileSchema.safeParse({
      level: 'simple', style: 'british', profileVersion: 1, prompt: 'ignore rules',
    }).success).toBe(false)
  })
})
