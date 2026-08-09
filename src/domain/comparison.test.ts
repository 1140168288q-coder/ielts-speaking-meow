import { describe, expect, it } from 'vitest'
import { compareAttempts, createLocalFeedback } from './comparison'
import { analyzeSpeech } from './speechAnalysis'

describe('createLocalFeedback', () => {
  it('returns no more than three actionable items', () => {
    const metrics = analyzeSpeech({
      transcript: 'Um um I I I mean mean this is is my answer you know.',
      durationMs: 180_000,
    })

    const feedback = createLocalFeedback(metrics)

    expect(feedback.length).toBeLessThanOrEqual(3)
    expect(feedback.every((item) => item.action.length > 0)).toBe(true)
  })

  it('asks for a transcript when transcript-based checks cannot run', () => {
    const feedback = createLocalFeedback(
      analyzeSpeech({ transcript: '', durationMs: 10_000 }),
    )

    expect(feedback).toHaveLength(1)
    expect(feedback[0]?.title).toBe('Add or correct the transcript')
  })
})

describe('compareAttempts', () => {
  it('compares the two attempts and highlights measurable improvements', () => {
    const first = analyzeSpeech({
      transcript: 'Um I I enjoy this place, you know.',
      durationMs: 20_000,
    })
    const second = analyzeSpeech({
      transcript: 'I enjoy this place because it is peaceful.',
      durationMs: 20_000,
    })

    const comparison = compareAttempts(first, second)

    expect(comparison.fillerCount).toEqual({
      first: 2,
      second: 0,
      delta: -2,
    })
    expect(comparison.repeatedWordCount?.delta).toBe(-1)
    expect(comparison.feedback).toHaveLength(2)
    expect(comparison.feedback.every((item) => item.kind === 'improvement')).toBe(
      true,
    )
  })

  it.each([
    ['', 'Um I I have a complete answer.'],
    ['Um I I have a complete answer.', ''],
  ])(
    'does not infer transcript-based changes when either transcript is empty',
    (firstTranscript, secondTranscript) => {
      const comparison = compareAttempts(
        analyzeSpeech({ transcript: firstTranscript, durationMs: 10_000 }),
        analyzeSpeech({ transcript: secondTranscript, durationMs: 10_000 }),
      )

      expect(comparison.wordsPerMinute).toBeNull()
      expect(comparison.fillerCount).toBeNull()
      expect(comparison.repeatedWordCount).toBeNull()
      expect(comparison.feedback).toHaveLength(1)
      expect(comparison.feedback[0]).toMatchObject({
        kind: 'notice',
        title: 'Complete both transcripts before comparing',
      })
      expect(comparison.feedback[0]?.action).toMatch(
        /complete both attempt transcripts/i,
      )
    },
  )
})
