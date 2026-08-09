import {
  actionableFeedbackListSchema,
  attemptComparisonSchema,
  type ActionableFeedback,
  type AttemptComparison,
  type MetricDelta,
  type SpeechMetrics,
} from './models'

const metricDelta = (first: number, second: number): MetricDelta => ({
  first,
  second,
  delta: second - first,
})

const evidenceForRepeatedWords = (metrics: SpeechMetrics) =>
  metrics.repeatedWords
    .map(({ word, count }) => `${word} ×${count + 1}`)
    .join(', ')

/** Returns no more than three concrete prompts for the next attempt. */
export const createLocalFeedback = (
  metrics: SpeechMetrics,
): ActionableFeedback[] => {
  const candidates: ActionableFeedback[] = []

  if (metrics.fillerCount > 0) {
    candidates.push({
      category: 'fluency',
      kind: 'focus',
      title: 'Replace filler words with a short pause',
      observation: `The transcript contains ${metrics.fillerCount} clear filler ${metrics.fillerCount === 1 ? 'instance' : 'instances'}.`,
      action:
        'Before the second attempt, mark one breathing point and pause briefly instead of filling the gap.',
      evidence: metrics.fillerWords
        .map(({ phrase, count }) => `${phrase} ×${count}`)
        .join(', '),
    })
  }

  if (metrics.repeatedWordCount > 0) {
    candidates.push({
      category: 'fluency',
      kind: 'focus',
      title: 'Reset after an accidental repetition',
      observation: `There are ${metrics.repeatedWordCount} immediately repeated ${metrics.repeatedWordCount === 1 ? 'word' : 'words'}.`,
      action:
        'If a word gets stuck, pause once and restart the short phrase rather than repeating the same word again.',
      evidence: evidenceForRepeatedWords(metrics),
    })
  }

  if (metrics.wordCount === 0) {
    candidates.push({
      category: 'coherence',
      kind: 'notice',
      title: 'Add or correct the transcript',
      observation:
        'There are no transcript words available, so transcript-based fluency checks cannot run yet.',
      action:
        'Retry transcription or type what you said, then review the local analysis again.',
      evidence: null,
    })
  } else if (
    metrics.wordsPerMinute !== null &&
    (metrics.wordsPerMinute < 80 || metrics.wordsPerMinute > 200)
  ) {
    candidates.push({
      category: 'fluency',
      kind: 'notice',
      title: 'Review the pace by listening back',
      observation: `The transcript-based estimate is ${metrics.wordsPerMinute} words per minute, which is an unusually ${metrics.wordsPerMinute < 80 ? 'slow' : 'fast'} pace estimate.`,
      action:
        'Listen to the recording and adjust the second attempt only if the pace makes the answer hard to follow.',
      evidence: `${metrics.wordCount} words in ${Math.round(metrics.durationMs / 1_000)} seconds`,
    })
  }

  return actionableFeedbackListSchema.parse(candidates.slice(0, 3))
}

const createComparisonFeedback = (
  first: SpeechMetrics,
  second: SpeechMetrics,
): ActionableFeedback[] => {
  if (first.wordCount === 0 || second.wordCount === 0) {
    return actionableFeedbackListSchema.parse([
      {
        category: 'coherence',
        kind: 'notice',
        title: 'Complete both transcripts before comparing',
        observation:
          'A transcript with words is required for both attempts, so filler and repetition changes are unavailable while either one is empty.',
        action:
          'Retry transcription or manually complete both attempt transcripts, then compare the answers again.',
        evidence: null,
      },
    ])
  }

  const candidates: ActionableFeedback[] = []
  const fillerDelta = second.fillerCount - first.fillerCount
  const repetitionDelta = second.repeatedWordCount - first.repeatedWordCount

  if (fillerDelta < 0) {
    candidates.push({
      category: 'fluency',
      kind: 'improvement',
      title: 'Fewer filler words in the second attempt',
      observation: `Clear filler instances fell from ${first.fillerCount} to ${second.fillerCount}.`,
      action:
        'Keep using short silent pauses when planning the next phrase.',
      evidence: `${fillerDelta} filler instances`,
    })
  } else if (fillerDelta > 0) {
    candidates.push({
      category: 'fluency',
      kind: 'focus',
      title: 'Filler words increased in the second attempt',
      observation: `Clear filler instances rose from ${first.fillerCount} to ${second.fillerCount}.`,
      action:
        'Try the second answer again with one idea per breath and allow a silent planning pause.',
      evidence: `+${fillerDelta} filler instances`,
    })
  }

  if (repetitionDelta < 0) {
    candidates.push({
      category: 'fluency',
      kind: 'improvement',
      title: 'Fewer immediate word repetitions',
      observation: `Immediate repetitions fell from ${first.repeatedWordCount} to ${second.repeatedWordCount}.`,
      action:
        'Keep the same reset-and-pause technique in future answers.',
      evidence: `${repetitionDelta} repeated words`,
    })
  } else if (repetitionDelta > 0) {
    candidates.push({
      category: 'fluency',
      kind: 'focus',
      title: 'Immediate repetitions increased',
      observation: `Immediate repetitions rose from ${first.repeatedWordCount} to ${second.repeatedWordCount}.`,
      action:
        'When you repeat a word, stop once and restart only the current phrase.',
      evidence: `+${repetitionDelta} repeated words`,
    })
  }

  if (
    first.wordsPerMinute !== null &&
    second.wordsPerMinute !== null &&
    Math.abs(second.wordsPerMinute - first.wordsPerMinute) >= 25
  ) {
    candidates.push({
      category: 'fluency',
      kind: 'notice',
      title: 'The speaking pace changed noticeably',
      observation: `The estimate changed from ${first.wordsPerMinute} to ${second.wordsPerMinute} words per minute.`,
      action:
        'Listen to both recordings and keep the pace that sounds clearer and easier to sustain.',
      evidence: `${second.wordsPerMinute - first.wordsPerMinute > 0 ? '+' : ''}${second.wordsPerMinute - first.wordsPerMinute} WPM`,
    })
  }

  if (candidates.length === 0) {
    candidates.push({
      category: 'fluency',
      kind: 'notice',
      title: 'The measured fluency indicators stayed stable',
      observation:
        'Clear fillers and immediate repetitions did not change between attempts.',
      action:
        'Listen for clarity and choose one useful phrase from the second answer to save.',
      evidence: null,
    })
  }

  return actionableFeedbackListSchema.parse(candidates.slice(0, 3))
}

export const compareAttempts = (
  first: SpeechMetrics,
  second: SpeechMetrics,
): AttemptComparison => {
  const hasComparableTranscripts =
    first.wordCount > 0 && second.wordCount > 0
  const wordsPerMinute =
    first.wordsPerMinute === null || second.wordsPerMinute === null
      ? null
      : metricDelta(first.wordsPerMinute, second.wordsPerMinute)

  return attemptComparisonSchema.parse({
    durationMs: metricDelta(first.durationMs, second.durationMs),
    wordsPerMinute,
    fillerCount: hasComparableTranscripts
      ? metricDelta(first.fillerCount, second.fillerCount)
      : null,
    repeatedWordCount: hasComparableTranscripts
      ? metricDelta(first.repeatedWordCount, second.repeatedWordCount)
      : null,
    feedback: createComparisonFeedback(first, second),
  })
}
