import { ZodError } from 'zod'
import { compareAttempts } from '../../domain/comparison'
import type {
  ActionableFeedback,
  AiFeedback,
  Question,
} from '../../domain/models'
import { analyzeSpeech } from '../../domain/speechAnalysis'
import type {
  LLMComparisonRequest,
  LLMFeedbackRequest,
} from '../../ports/ai'
import {
  type RawLLMProvider,
  ValidatedLLMProvider,
} from './validatedLlmProvider'

const question: Question = {
  id: 'p1-home-001',
  part: 1,
  topic: 'Home',
  prompt: 'What do you like most about the place where you live?',
}

const firstMetrics = analyzeSpeech({
  transcript: 'Um I I enjoy reading at home.',
  durationMs: 30_000,
})
const secondMetrics = analyzeSpeech({
  transcript: 'I enjoy reading at home because it helps me relax.',
  durationMs: 30_000,
})

const feedbackRequest: LLMFeedbackRequest = {
  question,
  transcript: 'Um I I enjoy reading at home.',
  metrics: firstMetrics,
}

const comparisonRequest: LLMComparisonRequest = {
  question,
  firstTranscript: feedbackRequest.transcript,
  secondTranscript: 'I enjoy reading at home because it helps me relax.',
  localComparison: compareAttempts(firstMetrics, secondMetrics),
}

const localFeedback: ActionableFeedback[] = [
  {
    category: 'fluency',
    kind: 'focus',
    title: 'Use a short pause',
    observation: 'The first answer contains a filler word.',
    action: 'Pause briefly before the next idea.',
    evidence: 'um ×1',
  },
]

const createRawProvider = (response: unknown): RawLLMProvider => ({
  id: 'raw-test-provider',
  isConfigured: () => true,
  getFeedback: () => Promise.resolve(response),
  compareAttempts: () => Promise.resolve(response),
})

describe('ValidatedLLMProvider', () => {
  it('rejects invalid feedback with Zod before local results can be replaced', async () => {
    const invalidResponse = {
      keyIssues: 'This must be a structured list.',
      secondAttemptTips: ['Try again.'],
      revisions: {
        minimalFix: null,
        naturalVersion: null,
        stretchVersion: null,
      },
    }
    const provider = new ValidatedLLMProvider(
      createRawProvider(invalidResponse),
    )
    const resultState: {
      localFeedback: ActionableFeedback[]
      aiFeedback: AiFeedback | null
    } = {
      localFeedback: structuredClone(localFeedback),
      aiFeedback: null,
    }

    const applyValidatedFeedback = async () => {
      const feedback = await provider.getFeedback(feedbackRequest)
      resultState.aiFeedback = feedback
    }

    await expect(applyValidatedFeedback()).rejects.toBeInstanceOf(ZodError)
    expect(resultState.localFeedback).toEqual(localFeedback)
    expect(resultState.aiFeedback).toBeNull()
  })

  it('rejects comparison output containing more than three issues', async () => {
    const issue: ActionableFeedback = {
      category: 'fluency',
      kind: 'focus',
      title: 'One focus area',
      observation: 'A concrete observation.',
      action: 'A concrete next action.',
      evidence: null,
    }
    const invalidResponse = {
      keyIssues: [issue, issue, issue, issue],
      secondAttemptTips: [],
      revisions: {
        minimalFix: null,
        naturalVersion: null,
        stretchVersion: null,
      },
    }
    const provider = new ValidatedLLMProvider(
      createRawProvider(invalidResponse),
    )

    await expect(
      provider.compareAttempts(comparisonRequest),
    ).rejects.toBeInstanceOf(ZodError)
  })

  it('delegates configuration state without bypassing validation', () => {
    const rawProvider = createRawProvider({})
    const provider = new ValidatedLLMProvider(rawProvider)

    expect(provider.id).toBe(rawProvider.id)
    expect(provider.isConfigured()).toBe(true)
  })
})
