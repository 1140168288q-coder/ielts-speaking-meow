import { describe, expect, it } from 'vitest'
import { legacyQuestionsById, questionBank, questionBankMeta } from './questions'

describe('questionBank', () => {
  it('contains the reviewed 2026 May-August source with integrity metadata', () => {
    expect(questionBank).toHaveLength(653)
    expect(questionBankMeta).toMatchObject({
      parserVersion: '2.2.0',
      seasonLabel: '2026-05',
      sourceFile: '更新版-2026年5-8月雅思口语新题库0526(1).pdf',
      sourceSha256:
        '02ea9e1fe4cdee302a8949552cfe7de6d260a7c498c0185b70aeaa677db896de',
      counts: { 1: 256, 2: 60, 3: 337 },
    })
  })

  it('keeps reviewed topics and OCR repairs semantic and speakable', () => {
    const byId = new Map(questionBank.map((question) => [question.id, question]))
    expect(
      byId.get('p2-describe-a-person-who-loves-to-grow-plants-e-001'),
    ).toMatchObject({
      topic: 'person who loves to grow plants at home or in the garden',
      prompt:
        'Describe a person who loves to grow plants (e.g. vegetables, flowers) at home or in the garden',
    })
    expect(
      byId.get('p2-describe-a-person-who-makes-plans-a-lot-and--001'),
    ).toMatchObject({
      topic: 'person who makes plans a lot and is good at planning',
    })
    expect(
      byId.get('p3-do-you-think-people-like-the-process-of-maki-001'),
    ).toMatchObject({
      prompt:
        'Do you think people like the process of making plans more, or the moment of carrying them out?',
    })

    expect(
      questionBank.some((question) => /recomme\s+nd/i.test(question.prompt)),
    ).toBe(false)
    expect(
      questionBank.some((question) => /\bAl\b/.test(question.prompt)),
    ).toBe(false)
    const liveSportsCard = questionBank.find(
      (question) =>
        question.part === 2 &&
        question.prompt === 'Describe a live sports event you watched and liked',
    )
    expect(liveSportsCard?.part).toBe(2)
    if (liveSportsCard?.part !== 2) {
      throw new Error('Expected reviewed live sports Part 2 cue card.')
    }
    expect(liveSportsCard.cuePoints).toContain('What it was')
    expect(liveSportsCard.cuePoints).toContain('When and where you watched it')
    expect(liveSportsCard.cuePoints).not.toContain('What it was When and where you watched it')
    const derivedTopics = questionBank
      .filter((question) => question.part !== 1)
      .map((question) => question.topic)
    expect(derivedTopics.every((topic) => topic.length <= 80)).toBe(true)
    expect(
      derivedTopics.every(
        (topic) =>
          !/(?:\b(?:a|an|the|and|or|but|of|to|in|on|at|for|from|with|by)|\b[A-Za-z]\.)$/i.test(
            topic,
          ),
      ),
    ).toBe(true)
  })

  it('has unique stable ids and preserves legitimate repeated wording', () => {
    const ids = questionBank.map((question) => question.id)
    const promptCounts = new Map<string, number>()
    for (const question of questionBank) {
      const key = `${question.part}:${question.prompt}`
      promptCounts.set(key, (promptCounts.get(key) ?? 0) + 1)
    }

    expect(new Set(ids).size).toBe(ids.length)
    expect(questionBank.every((question) => question.isNew !== undefined)).toBe(true)
    expect(
      new Set(
        questionBank
          .filter((question) => question.part === 1)
          .map((question) => question.topic),
      ).size,
    ).toBe(43)
    expect(
      [...promptCounts.values()].filter((count) => count > 1).sort(),
    ).toEqual([2, 2])
  })

  it('uses only source cue points and contains no PDF structure residue', () => {
    const partTwoQuestions = questionBank.filter(
      (question) => question.part === 2,
    )
    const allSourceText = questionBank.flatMap((question) =>
      question.part === 2
        ? [question.prompt, ...question.cuePoints]
        : [question.prompt],
    )

    expect(partTwoQuestions).toHaveLength(60)
    expect(partTwoQuestions.every((question) => question.cuePoints.length >= 2)).toBe(
      true,
    )
    expect(
      partTwoQuestions.flatMap((question) => question.cuePoints),
    ).not.toContain('Explain the main details.')
    expect(
      partTwoQuestions.flatMap((question) => question.cuePoints),
    ).not.toContain('Say why this is meaningful to you.')
    expect(
      allSourceText.every(
        (text) =>
          !/@@PAGE|^Warning:|You should say:|\.{5,}|\[(?:new|old)\]|,[A-Za-z]|\bpf\b|\be\.\s+g\./i.test(
            text,
          ),
      ),
    ).toBe(true)
  })

  it('links every Part 2 cue card to its Part 3 follow-ups and back', () => {
    const byId = new Map(questionBank.map((question) => [question.id, question]))
    const partTwoQuestions = questionBank.filter(
      (question) => question.part === 2,
    )
    const partThreeQuestions = questionBank.filter(
      (question) => question.part === 3,
    )
    const linkedPart3Ids = partTwoQuestions.flatMap(
      (question) => question.relatedPart3Ids ?? [],
    )

    expect(partThreeQuestions).toHaveLength(337)
    expect(linkedPart3Ids).toHaveLength(337)
    expect(new Set(linkedPart3Ids).size).toBe(337)
    expect(
      new Set(
        partTwoQuestions.map((question) => question.relatedPart3Ids?.length ?? 0),
      ).size,
    ).toBeGreaterThan(1)

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
