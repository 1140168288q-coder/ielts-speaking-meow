import type { ExtractedPage } from './materialExtractor'
import { parseQuestionCandidates } from './questionCandidateParser'

describe('parseQuestionCandidates', () => {
  it('keeps Part, topic, cue points, source page, and source order', () => {
    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        usedOcr: false,
        text: [
          '# Part 1',
          '## Topic: Home',
          '1. What do you like about your home?',
          '2. How often do you spend time at home?',
        ].join('\n'),
      },
      {
        pageNumber: 2,
        usedOcr: true,
        text: [
          'Part 2',
          'Topic: Places',
          'Describe a peaceful place you enjoy visiting.',
          '- where it is',
          '- what it looks like',
          '- why you enjoy visiting it',
        ].join('\n'),
      },
      {
        pageNumber: 3,
        usedOcr: false,
        text: [
          'IELTS Speaking Part 3',
          'Topic: Cities',
          'How can cities create better public spaces?',
        ].join('\n'),
      },
    ]

    expect(parseQuestionCandidates(pages)).toEqual([
      {
        id: 'candidate-1',
        part: 1,
        topic: 'Home',
        prompt: 'What do you like about your home?',
        cuePoints: [],
        sourcePage: 1,
      },
      {
        id: 'candidate-2',
        part: 1,
        topic: 'Home',
        prompt: 'How often do you spend time at home?',
        cuePoints: [],
        sourcePage: 1,
      },
      {
        id: 'candidate-3',
        part: 2,
        topic: 'Places',
        prompt: 'Describe a peaceful place you enjoy visiting.',
        cuePoints: [
          'where it is',
          'what it looks like',
          'why you enjoy visiting it',
        ],
        sourcePage: 2,
      },
      {
        id: 'candidate-4',
        part: 3,
        topic: 'Cities',
        prompt: 'How can cities create better public spaces?',
        cuePoints: [],
        sourcePage: 3,
      },
    ])
  })

  it('splits adjacent questions but ignores surrounding prose', () => {
    const candidates = parseQuestionCandidates([
      {
        pageNumber: null,
        usedOcr: false,
        text: [
          'Part 1',
          'Travel',
          'Use these questions for speaking practice.',
          'Where do you usually travel? Why do you enjoy that place?',
          'This paragraph is explanatory material, not a question.',
        ].join('\n'),
      },
    ])

    expect(candidates.map((candidate) => candidate.prompt)).toEqual([
      'Where do you usually travel?',
      'Why do you enjoy that place?',
    ])
    expect(candidates.every((candidate) => candidate.topic === 'Travel')).toBe(
      true,
    )
  })

  it('preserves repeated candidates for the preview to mark as duplicates', () => {
    const text = [
      'Part 1',
      'Topic: Home',
      'What do you like about your home?',
      'What do you like about your home?',
    ].join('\n')

    const candidates = parseQuestionCandidates([
      { pageNumber: 1, text, usedOcr: false },
    ])

    expect(candidates).toHaveLength(2)
    expect(candidates[0]?.prompt).toBe(candidates[1]?.prompt)
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      'candidate-1',
      'candidate-2',
    ])
  })

  it('caps a hostile document at 300 preview candidates', () => {
    const questions = Array.from(
      { length: 305 },
      (_, index) => `What is your answer number ${index + 1}?`,
    )

    const candidates = parseQuestionCandidates([
      {
        pageNumber: 1,
        text: `Part 1\nTopic: Limits\n${questions.join('\n')}`,
        usedOcr: false,
      },
    ])

    expect(candidates).toHaveLength(300)
    expect(candidates.at(-1)?.prompt).toBe('What is your answer number 300?')
  })
})
