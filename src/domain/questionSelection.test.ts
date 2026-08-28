import { describe, expect, it } from 'vitest'
import type { Question } from './models'
import { filterPracticeQuestions, pickRandomQuestion } from './questionSelection'

const questions: Question[] = [
  {
    id: 'p1-home-001',
    part: 1,
    topic: 'Home',
    prompt: 'Do you like your home?',
    category: '必考分类',
  },
  {
    id: 'p1-music-001',
    part: 1,
    topic: 'Music',
    prompt: 'Do you listen to music?',
    category: '高频分类',
  },
  {
    id: 'p2-home-001',
    part: 2,
    topic: 'Home',
    prompt: 'Describe a home you like.',
    cuePoints: ['where it is', 'why you like it'],
  },
]

describe('question selection', () => {
  it('combines part, topic, and done filters', () => {
    expect(filterPracticeQuestions(
      questions,
      { 'p1-home-001': true },
      { part: 1, topic: 'Home', done: 'done' },
    ).map((question) => question.id)).toEqual(['p1-home-001'])

    expect(filterPracticeQuestions(
      questions,
      { 'p1-home-001': true },
      { part: 1, done: 'undone' },
    ).map((question) => question.id)).toEqual(['p1-music-001'])
  })

  it('returns a random question only from the already-filtered range', () => {
    const filtered = filterPracticeQuestions(
      questions,
      {},
      { part: 1, query: 'music' },
    )
    expect(pickRandomQuestion(filtered, 0)).toEqual(questions[1])
    expect(pickRandomQuestion([], 0.5)).toBeNull()
  })
})
