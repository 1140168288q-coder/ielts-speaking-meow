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
 * Produces deliberately limited, answer-text metrics for local fallback only.
 * It never claims to measure pronunciation, speech rate, pauses or an IELTS
 * band score; V1.7 does not compute speech-rate values at all.
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

  return speechMetricsSchema.parse({
    durationMs: parsedInput.durationMs,
    wordCount: words.length,
    // V1.7 不再计算或展示语速;只保留历史记录中的旧值。
    wordsPerMinute: null,
    fillerWords,
    fillerCount,
    repeatedWords,
    repeatedWordCount,
    acoustic: parsedInput.acoustic ?? null,
    caveats: [
      'Word count, filler words and repetitions are estimated from the submitted answer text.',
    ],
  })
}
