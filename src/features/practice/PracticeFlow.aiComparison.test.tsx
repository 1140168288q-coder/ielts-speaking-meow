import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PracticeService } from '../../application/practiceService'
import { questionBank } from '../../data/questions'
import {
  compareAttempts,
  type AiFeedback,
  type PracticeAttempt,
  type SpeechMetrics,
  type TrainingSession,
} from '../../domain'
import type { LLMProvider } from '../../ports/ai'
import type {
  AudioFocus,
  RecordedAudioSTTProvider,
  STTProvider,
} from '../../ports/speech'
import { PracticeFlow } from './PracticeFlow'

const NOW = '2026-08-14T08:00:00.000Z'

function metrics(fillerCount: number): SpeechMetrics {
  return {
    durationMs: 30_000,
    wordCount: 8,
    wordsPerMinute: 16,
    fillerWords: fillerCount > 0 ? [{ phrase: 'um', count: fillerCount }] : [],
    fillerCount,
    repeatedWords: [],
    repeatedWordCount: 0,
    acoustic: null,
    caveats: ['Approximate transcript metrics.'],
  }
}

function attempt(number: 1 | 2, text: string, value: SpeechMetrics): PracticeAttempt {
  return {
    id: `attempt-${number}`,
    attemptNumber: number,
    audio: {
      id: `audio-${number}`,
      relativePath: `indexeddb://audio/audio-${number}`,
      mimeType: 'audio/webm',
      durationMs: value.durationMs,
      createdAt: NOW,
    },
    transcript: {
      status: 'ready',
      text,
      originalText: text,
      source: 'stt',
      errorCode: null,
      updatedAt: NOW,
    },
    metrics: value,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const first = attempt(1, 'Um I like reading at home.', metrics(1))
const second = attempt(2, 'I like reading at home because it helps me relax.', metrics(0))
const session: TrainingSession = {
  id: 'comparison-session',
  questionId: 'p1-home-001',
  status: 'comparison-ready',
  attempts: [first, second],
  localFeedback: [],
  aiFeedback: null,
  aiComparison: null,
  comparison: compareAttempts(first.metrics, second.metrics),
  createdAt: NOW,
  updatedAt: NOW,
}

const feedback: AiFeedback = {
  keyIssues: [
    {
      category: 'fluency',
      kind: 'improvement',
      title: 'More direct opening',
      observation: 'The second answer removes the opening filler.',
      action: 'Keep starting with the main idea.',
      evidence: 'I like reading',
    },
  ],
  secondAttemptTips: ['Keep starting with the main idea.'],
  revisions: {
    minimalFix: 'I like reading at home because it helps me relax.',
    naturalVersion: null,
    stretchVersion: null,
  },
}

describe('PracticeFlow AI comparison', () => {
  it('requests and stores a transcript-snapshot-safe comparison', async () => {
    const user = userEvent.setup()
    const compare = vi.fn().mockResolvedValue(feedback)
    const textAi = {
      id: 'fake-text-ai',
      isConfigured: () => true,
      getFeedback: vi.fn(),
      compareAttempts: compare,
    } as unknown as LLMProvider
    const updated = { ...session, aiComparison: feedback }
    const apply = vi.fn().mockResolvedValue(updated)
    const service = {
      applyAiComparisonIfTranscriptsCurrent: apply,
    } as unknown as PracticeService
    const onChange = vi.fn()
    const audioFocus = {
      state: 'idle',
      subscribe: () => () => undefined,
      stopAllPlayback: vi.fn().mockResolvedValue(undefined),
      cancelRecording: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioFocus
    const stt = { id: 'stt', isAvailable: () => false } as unknown as STTProvider
    const remoteStt = {
      id: 'remote-stt',
      isConfigured: () => false,
      isDefinitelyConfigured: () => false,
    } as unknown as RecordedAudioSTTProvider

    render(
      <PracticeFlow
        question={questionBank[0]!}
        session={session}
        service={service}
        audioFocus={audioFocus}
        stt={stt}
        remoteStt={remoteStt}
        textAi={textAi}
        onExitGuardChange={vi.fn()}
        onChange={onChange}
        onBack={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '获取 / 重试 AI 对比' }))
    await waitFor(() => expect(compare).toHaveBeenCalledOnce())
    expect(compare).toHaveBeenCalledWith({
      question: questionBank[0],
      firstTranscript: first.transcript.text,
      secondTranscript: second.transcript.text,
      localComparison: session.comparison,
    })
    expect(apply).toHaveBeenCalledWith(
      session.id,
      {
        first: {
          attemptId: first.id,
          text: first.transcript.text,
          updatedAt: first.transcript.updatedAt,
        },
        second: {
          attemptId: second.id,
          text: second.transcript.text,
          updatedAt: second.transcript.updatedAt,
        },
      },
      feedback,
    )
    expect(onChange).toHaveBeenCalledWith(updated)
  })
})
