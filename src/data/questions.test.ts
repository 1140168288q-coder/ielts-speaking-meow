import { describe, expect, it } from 'vitest'
import { questionBank } from './questions'

describe('questionBank', () => {
  it('contains a useful starter set for every IELTS Speaking part', () => {
    for (const part of [1, 2, 3] as const) {
      expect(
        questionBank.filter((question) => question.part === part).length,
      ).toBeGreaterThanOrEqual(6)
    }
  })

  it('has unique stable ids', () => {
    const ids = questionBank.map((question) => question.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('provides useful cue points for every Part 2 question', () => {
    const partTwoQuestions = questionBank.filter(
      (question) => question.part === 2,
    )

    expect(partTwoQuestions.every((question) => question.cuePoints.length >= 2)).toBe(
      true,
    )
  })
})
