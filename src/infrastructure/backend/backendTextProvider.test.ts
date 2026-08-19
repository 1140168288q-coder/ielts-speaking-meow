import { describe, expect, it, vi } from 'vitest'
import { questionBank } from '../../data/questions'
import { makeBackendHealth } from '../../test/fixtures/backendHealth'
import { BackendClient } from './backendClient'
import { BackendHealthCache } from './backendHealth'
import { BackendTextProvider } from './backendTextProvider'

const VALID_FEEDBACK = {
  summary: '回答切题，重点改进过去时态。',
  strengths: ['有具体例子。'],
  problems: ['过去时态混用。'],
  grammarSuggestions: ['先想好动词过去式。'],
  vocabularySuggestions: ['用 relaxing 代替 good。'],
  improvedAnswer: 'I like reading books because they help me relax.',
  referenceAnswers: [
    { label: '简单自然版', text: 'I like reading books because they help me relax.' },
    { label: '自然提升版', text: 'I enjoy reading books because they help me unwind.' },
    { label: '另一种表达版', text: 'Reading is my favourite way to relax after a busy day.' },
  ],
}

function createProvider(responseBody: unknown, status = 200): {
  provider: BackendTextProvider
  fetch: ReturnType<typeof vi.fn>
} {
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
  return { provider: new BackendTextProvider(client), fetch }
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
    answer: 'I like reading books in my free time.',
    answerDurationSeconds: 12,
  }
}

describe('BackendTextProvider', () => {
  it('is optimistic about Text AI without a health cache', () => {
    const { provider } = createProvider({})
    expect(provider.isConfigured()).toBe(true)
  })

  it('reflects the health cache state for Text AI', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(makeBackendHealth({
          deepseek: false,
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

  it('sends part, question, answer and optional duration to /v1/feedback', async () => {
    const { provider, fetch } = createProvider(VALID_FEEDBACK)
    const feedback = await provider.getFeedback(feedbackRequest())

    expect(feedback.summary).toBe('回答切题，重点改进过去时态。')
    expect(feedback.referenceAnswers).toHaveLength(3)
    expect(feedback.referenceAnswers[1]?.label).toBe('自然提升版')

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://backend.test/v1/feedback')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    const question = firstQuestion()
    expect(body).toEqual({
      part: question.part,
      question: {
        part: question.part,
        topic: question.topic,
        prompt: question.prompt,
        ...(question.category !== undefined
          ? { category: question.category }
          : {}),
        ...(question.isNew !== undefined ? { isNew: question.isNew } : {}),
      },
      answer: 'I like reading books in my free time.',
      answerDurationSeconds: 12,
    })
  })

  it('allows a null optional answer duration', async () => {
    const { provider, fetch } = createProvider(VALID_FEEDBACK)
    await provider.getFeedback({
      question: firstQuestion(),
      answer: 'I like reading books.',
      answerDurationSeconds: null,
    })
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.answerDurationSeconds).toBeNull()
  })

  it('rejects malformed feedback shapes', async () => {
    const { provider } = createProvider({ summary: 'missing everything' })
    await expect(provider.getFeedback(feedbackRequest()))
      .rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('maps organized questions into import candidates', async () => {
    const { provider } = createProvider({
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
    const { provider } = createProvider({})
    await expect(
      provider.extractQuestions({ fileName: 'x.txt', extractedText: 'text' }),
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })
})
