import { describe, expect, it, vi } from 'vitest'
import { questionBank } from '../../data/questions'
import { makeBackendHealth } from '../../test/fixtures/backendHealth'
import { BackendClient } from './backendClient'
import { BackendHealthCache } from './backendHealth'
import { BackendTextProvider } from './backendTextProvider'

const VALID_FEEDBACK = {
  keyIssues: [
    {
      category: 'fluency',
      kind: 'improvement',
      title: 'Pauses',
      observation: 'Long pauses between sentences.',
      action: 'Use linking phrases.',
      evidence: null,
    },
  ],
  secondAttemptTips: ['Speak at a steady pace'],
  revisions: {
    minimalFix: null,
    naturalVersion: 'I usually read novels.',
    stretchVersion: null,
  },
}

function createProvider(responseBody: unknown, status = 200): BackendTextProvider {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  const client = new BackendClient({
    baseUrl: 'http://backend.test',
    isNative: () => false,
    fetch: fetch,
  })
  return new BackendTextProvider(client)
}

function firstQuestion() {
  const question = questionBank[0]
  if (!question) {
    throw new Error('question bank must not be empty')
  }
  return question
}

function feedbackRequest() {
  return {
    question: firstQuestion(),
    transcript: 'I like reading books in my free time.',
    metrics: {
      durationMs: 12_000,
      wordCount: 8,
      wordsPerMinute: 40,
      fillerWords: [],
      fillerCount: 0,
      repeatedWords: [],
      repeatedWordCount: 0,
      caveats: [],
    },
  }
}

describe('BackendTextProvider', () => {
  it('is optimistic about Text AI without a health cache', () => {
    const provider = createProvider({})
    expect(provider.isConfigured()).toBe(true)
  })

  it('reflects the health cache state for Text AI', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(makeBackendHealth({
          deepseek: false,
          volc_stt: true,
          volc_tts: true,
        })),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = new BackendClient({
      baseUrl: 'http://backend.test',
      isNative: () => false,
      fetch,
    })
    const health = new BackendHealthCache(client)
    await health.refresh()

    const provider = new BackendTextProvider(client, health)
    expect(provider.isConfigured()).toBe(false)

    health.invalidate()
    expect(provider.isConfigured()).toBe(true)
  })

  it('returns validated feedback for getFeedback', async () => {
    const provider = createProvider(VALID_FEEDBACK)
    const feedback = await provider.getFeedback(feedbackRequest())
    expect(feedback.keyIssues).toHaveLength(1)
    expect(feedback.keyIssues[0]?.category).toBe('fluency')
  })

  it('rejects malformed feedback shapes', async () => {
    const provider = createProvider({ keyIssues: 'not-a-list' })
    await expect(provider.getFeedback(feedbackRequest()))
      .rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('returns validated comparison feedback', async () => {
    const provider = createProvider(VALID_FEEDBACK)
    const part2 = questionBank.find((question) => question.part === 2)
    if (!part2) {
      throw new Error('question bank must contain a Part 2 question')
    }
    const result = await provider.compareAttempts({
      question: part2,
      firstTranscript: 'I went to Beijing.',
      secondTranscript: 'I went to Beijing with my family.',
      localComparison: {
        durationMs: { first: 1000, second: 1500, delta: 500 },
        wordsPerMinute: null,
        fillerCount: null,
        repeatedWordCount: null,
        feedback: [],
      },
    })
    expect(result.keyIssues).toHaveLength(1)
  })

  it('maps organized questions into import candidates', async () => {
    const provider = createProvider({
      questions: [
        {
          part: 2,
          topic: 'Travel',
          prompt: 'Describe a memorable trip.',
          cuePoints: ['where you went', 'what you did'],
          sourcePage: null,
        },
      ],
    })
    const candidates = await provider.extractQuestions({
      fileName: 'notes.txt',
      extractedText: 'I visited Beijing last year.',
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.id).toBe('ai-candidate-1')
    expect(candidates[0]?.part).toBe(2)
  })

  it('rejects malformed organize responses', async () => {
    const provider = createProvider({})
    await expect(
      provider.extractQuestions({ fileName: 'x.txt', extractedText: 'text' }),
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })
})
