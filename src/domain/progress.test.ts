import { questionBank } from '../data/questions'
import { trainingSessionSchema, type SavedExpression } from './models'
import {
  buildProgressSummary,
  recommendQuestion,
  selectExpressionReviewQueue,
} from './progress'

const AT = '2026-08-14T08:00:00.000Z'

function session(
  id: string,
  questionId: string,
  first: { filler: number; repeated: number; longPauses: number },
  second?: { filler: number; repeated: number; longPauses: number },
) {
  const attempt = (
    attemptNumber: 1 | 2,
    metrics: { filler: number; repeated: number; longPauses: number },
  ) => ({
    id: `${id}-attempt-${attemptNumber}`,
    attemptNumber,
    audio: {
      id: `${id}-audio-${attemptNumber}`,
      relativePath: `audio/${id}-${attemptNumber}.webm`,
      mimeType: 'audio/webm',
      durationMs: 30_000,
      createdAt: AT,
    },
    transcript: {
      status: 'ready' as const,
      text: 'I enjoy reading at home.',
      originalText: null,
      source: 'manual' as const,
      errorCode: null,
      updatedAt: AT,
    },
    metrics: {
      durationMs: 30_000,
      wordCount: 6,
      wordsPerMinute: 12,
      fillerWords: [],
      fillerCount: metrics.filler,
      repeatedWords: [],
      repeatedWordCount: metrics.repeated,
      acoustic: {
        analysisVersion: 1 as const,
        analyzedDurationMs: 30_000,
        activeSpeechMs: 20_000,
        silenceRatio: 1 / 3,
        pauseCount: metrics.longPauses,
        longPauseCount: metrics.longPauses,
        averagePauseMs: metrics.longPauses ? 900 : null,
      },
      caveats: [],
    },
    createdAt: AT,
    updatedAt: AT,
  })

  const attempts = second ? [attempt(1, first), attempt(2, second)] : [attempt(1, first)]
  return trainingSessionSchema.parse({
    id,
    questionId,
    status: second ? 'completed' : 'first-review',
    attempts,
    localFeedback: [],
    aiFeedback: null,
    aiComparison: null,
    comparison: second
      ? {
          durationMs: { first: 30_000, second: 30_000, delta: 0 },
          wordsPerMinute: { first: 12, second: 12, delta: 0 },
          fillerCount: { first: first.filler, second: second.filler, delta: second.filler - first.filler },
          repeatedWordCount: { first: first.repeated, second: second.repeated, delta: second.repeated - first.repeated },
          silenceRatio: null,
          longPauseCount: { first: first.longPauses, second: second.longPauses, delta: second.longPauses - first.longPauses },
          feedback: [],
        }
      : null,
    createdAt: AT,
    updatedAt: AT,
  })
}

describe('local progress', () => {
  it('summarizes second-attempt follow-through and only explainable speech signals', () => {
    const sessions = [
      session('one', 'p1-where-is-your-hometown-001', { filler: 3, repeated: 1, longPauses: 2 }, { filler: 1, repeated: 0, longPauses: 1 }),
      session('two', 'p1-where-is-your-hometown-001', { filler: 2, repeated: 0, longPauses: 0 }),
    ]
    const summary = buildProgressSummary(sessions, questionBank)

    expect(summary).toMatchObject({
      startedSessions: 2,
      completedSessions: 1,
      secondAttemptSessions: 1,
      secondAttemptRate: 50,
      improvedSessions: 1,
      improvementRate: 100,
      averageFillerDelta: -2,
      averageLongPauseDelta: -1,
    })
    expect(summary.activeTopics[0]).toEqual({ topic: 'Hometown', practiceCount: 2 })
    expect(summary.recurringFocus.map((item) => item.key)).toContain('filler')
  })

  it('recommends an unpracticed topic and avoids simply repeating the latest question', () => {
    const practiced = [
      session('recent', 'p1-where-is-your-hometown-001', { filler: 0, repeated: 0, longPauses: 0 }),
    ]
    const result = recommendQuestion(questionBank, practiced)

    expect(result?.question.id).not.toBe('p1-where-is-your-hometown-001')
    expect(result?.reason).toContain('还没练过')
  })

  it('selects never-reviewed and seven-day-old expressions for a small review queue', () => {
    const base: SavedExpression = {
      id: 'expression-1',
      text: 'It helps me unwind.',
      topic: 'Home',
      questionId: 'p1-home-001',
      sessionId: 'session-1',
      sourceAttempt: 2,
      sourcePart: 1,
      createdAt: '2026-08-01T08:00:00.000Z',
    }
    const queue = selectExpressionReviewQueue(
      [
        base,
        { ...base, id: 'expression-2', lastReviewedAt: '2026-08-13T08:00:00.000Z', reviewCount: 1 },
        { ...base, id: 'expression-3', lastReviewedAt: '2026-08-01T08:00:00.000Z', reviewCount: 2 },
      ],
      new Date(AT),
    )

    expect(queue.map((item) => item.id)).toEqual(['expression-1', 'expression-3'])
  })
})
