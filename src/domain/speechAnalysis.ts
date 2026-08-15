import { z } from 'zod'
import {
  acousticSpeechMetricsSchema,
  speechMetricsSchema,
  type AcousticSpeechMetrics,
  type SpeechMetrics,
} from './models'

const speechAnalysisInputSchema = z
  .object({
    transcript: z.string(),
    durationMs: z.number().finite().nonnegative(),
    acoustic: acousticSpeechMetricsSchema.nullable().optional(),
  })
  .strict()

const FILLER_PHRASES = [
  ['you', 'know'],
  ['i', 'mean'],
  ['sort', 'of'],
  ['kind', 'of'],
  ['um'],
  ['uh'],
  ['erm'],
  ['er'],
] as const

const tokenize = (transcript: string): string[] =>
  transcript
    .toLocaleLowerCase('en-US')
    .match(/[a-z]+(?:['’][a-z]+)*/g)
    ?.map((word) => word.replace('’', "'")) ?? []

const countPhrase = (words: readonly string[], phrase: readonly string[]) => {
  let count = 0

  for (let index = 0; index <= words.length - phrase.length; index += 1) {
    if (phrase.every((word, offset) => words[index + offset] === word)) {
      count += 1
    }
  }

  return count
}

const countRepeatedWords = (words: readonly string[]) => {
  const repetitions = new Map<string, number>()

  for (let index = 1; index < words.length; index += 1) {
    const current = words[index]
    const previous = words[index - 1]

    if (current !== undefined && current === previous) {
      repetitions.set(current, (repetitions.get(current) ?? 0) + 1)
    }
  }

  return [...repetitions.entries()].map(([word, count]) => ({ word, count }))
}

/**
 * Produces deliberately limited, transcript-based fluency metrics.
 * It never claims to measure pronunciation or an IELTS band score.
 */
export const analyzeSpeech = (input: {
  transcript: string
  durationMs: number
  acoustic?: AcousticSpeechMetrics | null
}): SpeechMetrics => {
  const parsedInput = speechAnalysisInputSchema.parse(input)
  const words = tokenize(parsedInput.transcript)
  const fillerWords = FILLER_PHRASES.map((phrase) => ({
    phrase: phrase.join(' '),
    count: countPhrase(words, phrase),
  })).filter(({ count }) => count > 0)
  const repeatedWords = countRepeatedWords(words)
  const fillerCount = fillerWords.reduce((total, item) => total + item.count, 0)
  const repeatedWordCount = repeatedWords.reduce(
    (total, item) => total + item.count,
    0,
  )
  const wordsPerMinute =
    parsedInput.durationMs > 0 && words.length > 0
      ? Math.round((words.length * 60_000) / parsedInput.durationMs)
      : null

  const caveats = [
    'Word count, filler words and repetitions are estimated from the transcript.',
  ]

  if (wordsPerMinute !== null) {
    caveats.push(
      'Words per minute is approximate and depends on transcript accuracy and recorded duration.',
    )
  }

  if (parsedInput.acoustic !== undefined && parsedInput.acoustic !== null) {
    caveats.push(
      'Pause and silence values are approximate local audio signals, not pronunciation or band scores.',
    )
  }

  return speechMetricsSchema.parse({
    durationMs: parsedInput.durationMs,
    wordCount: words.length,
    wordsPerMinute,
    fillerWords,
    fillerCount,
    repeatedWords,
    repeatedWordCount,
    acoustic: parsedInput.acoustic ?? null,
    caveats,
  })
}
