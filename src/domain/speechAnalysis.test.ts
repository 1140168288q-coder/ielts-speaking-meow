import { describe, expect, it } from 'vitest'
import { analyzeSpeech } from './speechAnalysis'

describe('analyzeSpeech', () => {
  it('calculates duration, fillers and adjacent repetitions without speech-rate values', () => {
    const result = analyzeSpeech({
      transcript: 'Um, I I really enjoy it, you know.',
      durationMs: 60_000,
    })

    expect(result).toMatchObject({
      durationMs: 60_000,
      wordCount: 8,
      wordsPerMinute: null,
      fillerCount: 2,
      repeatedWordCount: 1,
    })
    expect(result.fillerWords).toEqual([
      { phrase: 'you know', count: 1 },
      { phrase: 'um', count: 1 },
    ])
    expect(result.repeatedWords).toEqual([{ word: 'i', count: 1 }])
  })

  it('returns a safe empty result when no transcript is available', () => {
    const result = analyzeSpeech({ transcript: '', durationMs: 12_000 })

    expect(result.wordCount).toBe(0)
    expect(result.wordsPerMinute).toBeNull()
    expect(result.fillerCount).toBe(0)
    expect(result.repeatedWordCount).toBe(0)
  })

  it('does not mistake filler text inside another word for a filler', () => {
    const result = analyzeSpeech({
      transcript: 'Her early answer was useful.',
      durationMs: 5_000,
    })

    expect(result.fillerCount).toBe(0)
  })

  it('rejects invalid duration instead of producing invalid metrics', () => {
    expect(() =>
      analyzeSpeech({ transcript: 'A short answer.', durationMs: -1 }),
    ).toThrow()
  })

  it('never manufactures pronunciation or IELTS scores', () => {
    const result = analyzeSpeech({
      transcript: 'This is my answer.',
      durationMs: 4_000,
    })

    expect(result).not.toHaveProperty('pronunciationScore')
    expect(result).not.toHaveProperty('ieltsBand')
  })
})
