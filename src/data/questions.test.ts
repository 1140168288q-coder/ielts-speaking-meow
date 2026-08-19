import { describe, expect, it } from 'vitest'
import { legacyQuestionsById, questionBank, questionBankMeta } from './questions'

describe('questionBank', () => {
  it('contains the parsed 2026 May-August bank for every IELTS Speaking part', () => {
    expect(questionBankMeta.seasonLabel).toBe('2026-05')
    for (const part of [1, 2, 3] as const) {
      expect(
        questionBank.filter((question) => question.part === part).length,
      ).toBeGreaterThanOrEqual(20)
    }
  })

  it('has unique stable ids and unique Part 1 topics with new/old markers', () => {
    const ids = questionBank.map((question) => question.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(questionBank.every((question) => question.isNew !== undefined)).toBe(true)
    expect(
      new Set(
        questionBank
          .filter((question) => question.part === 1)
          .map((question) => question.topic),
      ).size,
    ).toBe(43)
  })

  it('provides useful cue points for every Part 2 question', () => {
    const partTwoQuestions = questionBank.filter(
      (question) => question.part === 2,
    )
    expect(partTwoQuestions.length).toBe(60)
    expect(partTwoQuestions.every((question) => question.cuePoints.length >= 2)).toBe(
      true,
    )
  })

  it('links every built-in Part 2 cue card to its Part 3 follow-ups and back', () => {
    const byId = new Map(questionBank.map((question) => [question.id, question]))
    const partTwoQuestions = questionBank.filter(
      (question) => question.part === 2,
    )
    const partThreeQuestions = questionBank.filter(
      (question) => question.part === 3,
    )

    expect(partThreeQuestions.length).toBeGreaterThan(300)
    for (const question of partTwoQuestions) {
      expect(question.relatedPart3Ids?.length ?? 0).toBeGreaterThan(0)
      for (const followUpId of question.relatedPart3Ids ?? []) {
        const followUp = byId.get(followUpId)
        expect(followUp?.part).toBe(3)
        expect(
          followUp !== undefined && 'part2QuestionId' in followUp
            ? followUp.part2QuestionId
            : null,
        ).toBe(question.id)
      }
    }
    expect(
      partThreeQuestions.every(
        (question) => question.part2QuestionId !== undefined,
      ),
    ).toBe(true)
  })

  it('keeps V1.4 legacy questions only for resolving old history records', () => {
    expect(legacyQuestionsById.has('p1-home-001')).toBe(true)
    expect(questionBank.some((question) => question.id === 'p1-home-001')).toBe(
      false,
    )
  })
})
