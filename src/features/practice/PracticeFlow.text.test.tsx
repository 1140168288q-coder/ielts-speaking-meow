import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PracticeService } from '../../application/practiceService'
import type {
  AiFeedback,
  PracticeAttempt,
  Question,
  SecondAttemptAnalysis,
  TrainingSession,
} from '../../domain'
import type { LLMProvider } from '../../ports/ai'
import type { AudioFocus, TTSRequest } from '../../ports/speech'
import type { BackendClient } from '../../infrastructure/backend/backendClient'
import { ApiProviderError } from '../../infrastructure/ai/providerErrors'
import { BackendTextProvider } from '../../infrastructure/backend/backendTextProvider'
import { PracticeFlow } from './PracticeFlow'
import { SubmitCorpusStage } from './stages/SubmitCorpusStage'

const question: Question = {
  id: 'p1-hobbies',
  part: 1,
  topic: 'Hobbies',
  prompt: 'What do you like to do in your free time?',
}

const timestamp = '2026-08-09T08:00:00.000Z'

const attempt: PracticeAttempt = {
  id: 'attempt-1',
  attemptNumber: 1,
  audio: null,
  transcript: {
    status: 'ready',
    text: 'I like reading books in my free time.',
    originalText: null,
    source: 'manual',
    errorCode: null,
    updatedAt: timestamp,
  },
  metrics: {
    durationMs: 12_000,
    wordCount: 8,
    wordsPerMinute: null,
    fillerWords: [],
    fillerCount: 0,
    repeatedWords: [],
    repeatedWordCount: 0,
    caveats: [],
  },
  createdAt: timestamp,
  updatedAt: timestamp,
}

const secondAttempt: PracticeAttempt = {
  ...attempt,
  id: 'attempt-2',
  attemptNumber: 2,
  transcript: {
    ...attempt.transcript,
    text: 'I went to Beijing last year.',
    updatedAt: '2026-08-09T08:01:00.000Z',
  },
  createdAt: '2026-08-09T08:01:00.000Z',
  updatedAt: '2026-08-09T08:01:00.000Z',
}

const secondAttemptAnalysis: SecondAttemptAnalysis = {
  correctedSentences: [
    {
      original: 'I go there last year.',
      corrected: 'I went there last year.',
      reason: '过去时间要使用过去式。',
    },
  ],
  memoryCandidates: [],
}

const feedback: AiFeedback = {
  summary: '回答切题，重点改进过去时态。',
  strengths: ['有具体例子。'],
  problems: ['过去时态混用。', '结尾还可以补一个具体细节。'],
  grammarSuggestions: ['先想好动词过去式。'],
  vocabularySuggestions: ['用 relaxing 代替 good。'],
  referenceAnswers: [
    { label: '简单优化版', text: 'I like reading books because they help me relax.' },
    { label: '自然提升版', text: 'I enjoy reading books because they help me unwind.' },
  ],
  naturalUpgradeSuggestions: { addableContent: [], advancedChanges: ['可以补充一个具体细节。'] },
  answerFramework: [{ label: '直接回答', template: 'I usually ___ because ___.' }],
}

function makeSession(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 'session-1',
    questionId: question.id,
    part: question.part,
    status: 'first-ready',
    attempts: [],
    localFeedback: [],
    aiFeedback: null,
    secondAttemptAnalysis: null,
    confirmedMemoryFacts: [],
    comparison: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function createAudioFocus(): AudioFocus & {
  speak: ReturnType<typeof vi.fn>
  stopTTS: ReturnType<typeof vi.fn>
} {
  return {
    state: 'idle',
    speak: vi.fn(() => new Promise<void>(() => undefined)),
    stopTTS: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => () => undefined),
  } as unknown as AudioFocus & {
    speak: ReturnType<typeof vi.fn>
    stopTTS: ReturnType<typeof vi.fn>
  }
}

function createService(
  overrides: Partial<PracticeService> = {},
): PracticeService {
  return {
    saveTextAttempt: vi.fn(),
    applyAiFeedbackIfAnswerCurrent: vi.fn(),
    applySecondAttemptAnalysisIfAnswerCurrent: vi.fn(),
    finalizeSecondAttempt: vi.fn(),
    prepareSecondAttempt: vi.fn(),
    completeSession: vi.fn(),
    submitSecondAnswerToCorpus: vi.fn(),
    ...overrides,
  } as unknown as PracticeService
}

function createTextAi(): LLMProvider {
  return {
    id: 'backend-text',
    isConfigured: () => true,
    getFeedback: vi.fn(),
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('PracticeFlow V1.7 text answer flow', () => {
  it('requires a manual timer start and submits answer text with the optional duration', async () => {
    const user = userEvent.setup()
    const audioFocus = createAudioFocus()
    const saveTextAttempt = vi.fn().mockResolvedValue(
      makeSession({
        status: 'first-review',
        attempts: [attempt],
      }),
    )
    const service = createService({ saveTextAttempt })
    const onChange = vi.fn()

    render(
      <PracticeFlow
        question={question}
        session={makeSession()}
        service={service}
        audioFocus={audioFocus}
        textAi={createTextAi()}
        onExitGuardChange={() => undefined}
        onChange={onChange}
        onBack={() => undefined}
      />,
    )

    expect(screen.getByText(/手机键盘上的麦克风就是你的口语通道/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始计时' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull()

    await user.click(screen.getByRole('button', { name: '开始计时' }))
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '暂停' }))
    expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '继续' }))
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.getByRole('button', { name: '开始计时' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '开始计时' }))
    const textarea = screen.getByRole('textbox', { name: '你的答案文本' })
    await user.type(textarea, 'I like reading books in my free time.')
    await user.click(screen.getByRole('button', { name: '保存第 1 次回答' }))

    await waitFor(() => {
      expect(saveTextAttempt).toHaveBeenCalledWith(
        'session-1',
        1,
        'I like reading books in my free time.',
        expect.any(Number),
      )
    })
  })

  it('renders full text feedback and toggles TTS per button, switching A to B', async () => {
    const user = userEvent.setup()
    const audioFocus = createAudioFocus()
    const service = createService()
    const session = makeSession({
      status: 'feedback-ready',
      attempts: [attempt],
      aiFeedback: feedback,
    })

    render(
      <PracticeFlow
        question={question}
        session={session}
        service={service}
        audioFocus={audioFocus}
        textAi={createTextAi()}
        onExitGuardChange={() => undefined}
        onChange={() => undefined}
        onBack={() => undefined}
      />,
    )

    expect(screen.getByText('回答切题，重点改进过去时态。')).toBeInTheDocument()
    expect(screen.getByText('有具体例子。')).toBeInTheDocument()
    expect(screen.getByText('过去时态混用。')).toBeInTheDocument()
    expect(screen.getByText('先想好动词过去式。')).toBeInTheDocument()
    expect(screen.getByText('用 relaxing 代替 good。')).toBeInTheDocument()
    expect(screen.getAllByText('简单优化版').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('自然提升版').length).toBeGreaterThanOrEqual(1)

    // 参考答案按钮:第一次播放,第二次立即停止。
    const improvedToggle = screen.getByRole('button', { name: '试听 简单优化版' })
    await user.click(improvedToggle)
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '停止' }))
    expect(
      (audioFocus.stopTTS as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(0)

    // 播放 A 时点 B:先切换参考回答 tab,再点 B 的试听;
    // UI 只保留 B 的播放状态,并提交 B 的新文本。
    await user.click(screen.getByRole('button', { name: '试听 简单优化版' }))
    await user.click(screen.getByRole('tab', { name: '自然提升版' }))
    await user.click(screen.getByRole('button', { name: '试听 自然提升版' }))
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()
    expect(
      (audioFocus.speak as ReturnType<typeof vi.fn>).mock.calls,
    ).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({ text: feedback.referenceAnswers[1]?.text }),
        ]),
      ]),
    )
  })

  it('keeps the question replayable in the second-answer stage', async () => {
    const user = userEvent.setup()
    const audioFocus = createAudioFocus()

    render(
      <PracticeFlow
        question={question}
        session={makeSession({
          status: 'second-ready',
          attempts: [attempt],
          aiFeedback: feedback,
        })}
        service={createService()}
        audioFocus={audioFocus}
        textAi={createTextAi()}
        autoPlayQuestion={false}
        onExitGuardChange={() => undefined}
        onChange={() => undefined}
        onBack={() => undefined}
      />,
    )

    const questionButton = screen.getByRole('button', { name: '播放题目' })
    await user.click(questionButton)
    expect(screen.getByRole('button', { name: '停止播报' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '停止播报' }))
    expect(
      (audioFocus.stopTTS as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(0)
  })


  it('reads the full Part 2 cue card and exposes the playback bar', async () => {
    const partTwoQuestion: Question = {
      id: 'p2-helpful-person',
      part: 2,
      topic: 'People',
      prompt: 'Describe a person who has helped you.',
      cuePoints: [
        'who this person is',
        'how this person helped you',
        'how you felt about the help',
      ],
    }
    const audioFocus = createAudioFocus()

    render(
      <PracticeFlow
        question={partTwoQuestion}
        session={makeSession({ questionId: partTwoQuestion.id })}
        service={createService()}
        audioFocus={audioFocus}
        textAi={createTextAi()}
        onExitGuardChange={() => undefined}
        onChange={() => undefined}
        onBack={() => undefined}
      />,
    )

    await waitFor(() => expect(
      (audioFocus.speak as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(0))
    const spokenRequests = (
      audioFocus.speak as ReturnType<typeof vi.fn>
    ).mock.calls as Array<[TTSRequest]>
    expect(spokenRequests.some(
      ([request]) => request.text.includes('who this person is'),
    )).toBe(true)
    expect(spokenRequests.some(
      ([request]) => request.text.includes('how you felt about the help'),
    )).toBe(true)
    expect(
      screen.getByRole('region', { name: '语音播放器' }),
    ).toBeInTheDocument()
  })

  it('releases AI loading and enables the second attempt under StrictMode', async () => {
    const user = userEvent.setup()
    const updatedSession = makeSession({
      status: 'feedback-ready',
      attempts: [attempt],
      aiFeedback: feedback,
    })
    const applyAiFeedbackIfAnswerCurrent = vi.fn().mockResolvedValue(updatedSession)
    const textAi: LLMProvider = {
      id: 'backend-text',
      isConfigured: () => true,
      getFeedback: vi.fn().mockResolvedValue(feedback),
    }

    render(
      <StrictMode>
        <PracticeFlow
          question={question}
          session={makeSession({ status: 'first-review', attempts: [attempt] })}
          service={createService({ applyAiFeedbackIfAnswerCurrent })}
          audioFocus={createAudioFocus()}
          textAi={textAi}
          onExitGuardChange={() => undefined}
          onChange={() => undefined}
          onBack={() => undefined}
        />
      </StrictMode>,
    )

    await user.click(screen.getByRole('button', { name: '重试 AI 分析' }))

    await waitFor(() => {
      expect(applyAiFeedbackIfAnswerCurrent).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: '进入第二次回答' })).toBeEnabled()
    })
  })

  it('calls the real second-attempt provider through the PracticeFlow retry path', async () => {
    const user = userEvent.setup()
    const postJson = vi.fn().mockResolvedValue(secondAttemptAnalysis)
    const client = { postJson } as unknown as BackendClient
    const textAi = new BackendTextProvider(client)
    const saveTextAttempt = vi.fn().mockResolvedValue(
      makeSession({
        status: 'comparison-ready',
        attempts: [attempt, secondAttempt],
      }),
    )

    render(
      <PracticeFlow
        question={question}
        session={makeSession({ status: 'second-ready', attempts: [attempt] })}
        service={createService({ saveTextAttempt })}
        audioFocus={createAudioFocus()}
        textAi={textAi}
        autoPlayQuestion={false}
        onExitGuardChange={() => undefined}
        onChange={() => undefined}
        onBack={() => undefined}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: '你的答案文本' }), secondAttempt.transcript.text)
    await user.click(screen.getByRole('button', { name: '提交第 2 次回答' }))

    await waitFor(() => {
      expect(postJson).toHaveBeenCalled()
      const call = postJson.mock.calls[0] as unknown as [
        string,
        { answer: string },
        number,
        { idempotencyKey: string; retry: boolean },
      ]
      expect(call[0]).toBe('/v1/feedback/second-attempt')
      expect(call[1].answer).toBe(secondAttempt.transcript.text)
      expect(call[2]).toBeGreaterThan(0)
      expect(call[3].retry).toBe(true)
      expect(call[3].idempotencyKey).toEqual(expect.any(String))
    })
  })

  it('defaults AI corrections selected and keeps edited correction text', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(
      <SubmitCorpusStage
        attempt={secondAttempt}
        analysis={secondAttemptAnalysis}
        aiBusy={false}
        aiNote={null}
        busy={false}
        onRetryAnalysis={() => undefined}
        onSubmit={onSubmit}
        onComplete={() => undefined}
      />,
    )

    const correction = screen.getByRole('checkbox')
    expect(correction).toBeChecked()
    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)
    await user.type(textarea, 'I went there with my friends last year.')
    await user.click(screen.getByRole('button', { name: '保存选择并完成' }))

    expect(onSubmit).toHaveBeenCalledWith(
      ['I went there with my friends last year.'],
      [],
    )
  })

  it('keeps edited correction text across an unrelated rerender', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <SubmitCorpusStage
        attempt={secondAttempt}
        analysis={secondAttemptAnalysis}
        aiBusy={false}
        aiNote={null}
        busy={false}
        onRetryAnalysis={() => undefined}
        onSubmit={() => undefined}
        onComplete={() => undefined}
      />,
    )

    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)
    await user.type(textarea, 'I went there with my friends last year.')
    rerender(
      <SubmitCorpusStage
        attempt={secondAttempt}
        analysis={{ ...secondAttemptAnalysis, correctedSentences: [...secondAttemptAnalysis.correctedSentences] }}
        aiBusy={false}
        aiNote={null}
        busy={false}
        onRetryAnalysis={() => undefined}
        onSubmit={() => undefined}
        onComplete={() => undefined}
      />,
    )

    expect(screen.getByRole('textbox')).toHaveValue('I went there with my friends last year.')
  })

  it('queues second-attempt analysis while first feedback is still pending', async () => {
    const user = userEvent.setup()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const firstFeedback = createDeferred<AiFeedback>()
    const firstReviewSession = makeSession({
      status: 'first-review',
      attempts: [attempt],
    })
    const secondReadySession = makeSession({
      status: 'second-ready',
      attempts: [attempt],
      aiFeedback: feedback,
    })
    const secondSubmitSession = makeSession({
      status: 'comparison-ready',
      attempts: [attempt, secondAttempt],
      aiFeedback: feedback,
    })
    const finalSession = makeSession({
      status: 'comparison-ready',
      attempts: [attempt, secondAttempt],
      aiFeedback: feedback,
      secondAttemptAnalysis,
    })
    const saveTextAttempt = vi.fn().mockImplementation(
      (_sessionId: string, attemptNumber: 1 | 2) =>
        Promise.resolve(attemptNumber === 1 ? firstReviewSession : secondSubmitSession),
    )
    const prepareSecondAttempt = vi.fn().mockResolvedValue(secondReadySession)
    const applyAiFeedbackIfAnswerCurrent = vi.fn().mockResolvedValue(firstReviewSession)
    const applySecondAttemptAnalysisIfAnswerCurrent = vi.fn().mockResolvedValue(finalSession)
    const getFeedback = vi.fn().mockReturnValue(firstFeedback.promise)
    const getSecondAttemptAnalysis = vi.fn().mockResolvedValue(secondAttemptAnalysis)
    const textAi: LLMProvider = {
      id: 'backend-text',
      isConfigured: () => true,
      getFeedback,
      getSecondAttemptAnalysis,
    }
    const service = createService({
      saveTextAttempt,
      prepareSecondAttempt,
      applyAiFeedbackIfAnswerCurrent,
      applySecondAttemptAnalysisIfAnswerCurrent,
    })
    const onChange = vi.fn()
    const { rerender } = render(
      <PracticeFlow
        question={question}
        session={makeSession()}
        service={service}
        audioFocus={createAudioFocus()}
        textAi={textAi}
        autoPlayQuestion={false}
        onExitGuardChange={() => undefined}
        onChange={onChange}
        onBack={() => undefined}
      />,
    )

    const firstAnswer = screen.getByRole('textbox', { name: '你的答案文本' })
    await user.type(firstAnswer, attempt.transcript.text)
    await user.click(screen.getByRole('button', { name: '保存第 1 次回答' }))
    await waitFor(() => expect(saveTextAttempt).toHaveBeenCalledWith(
      'session-1',
      1,
      expect.any(String),
      null,
    ))
    rerender(
      <PracticeFlow
        question={question}
        session={firstReviewSession}
        service={service}
        audioFocus={createAudioFocus()}
        textAi={textAi}
        autoPlayQuestion={false}
        onExitGuardChange={() => undefined}
        onChange={onChange}
        onBack={() => undefined}
      />,
    )

    await user.click(screen.getByRole('button', { name: '进入第二次回答' }))
    await waitFor(() => expect(prepareSecondAttempt).toHaveBeenCalledWith('session-1'))
    rerender(
      <PracticeFlow
        question={question}
        session={secondReadySession}
        service={service}
        audioFocus={createAudioFocus()}
        textAi={textAi}
        autoPlayQuestion={false}
        onExitGuardChange={() => undefined}
        onChange={onChange}
        onBack={() => undefined}
      />,
    )

    const secondAnswer = screen.getByRole('textbox', { name: '你的答案文本' })
    await user.type(secondAnswer, secondAttempt.transcript.text)
    await user.click(screen.getByRole('button', { name: '提交第 2 次回答' }))
    await waitFor(() => expect(saveTextAttempt).toHaveBeenCalledWith(
      'session-1',
      2,
      expect.any(String),
      null,
    ))
    rerender(
      <PracticeFlow
        question={question}
        session={secondSubmitSession}
        service={service}
        audioFocus={createAudioFocus()}
        textAi={textAi}
        autoPlayQuestion={false}
        onExitGuardChange={() => undefined}
        onChange={onChange}
        onBack={() => undefined}
      />,
    )
    await waitFor(() => expect(screen.getByText(/第一次 AI 分析仍在处理中/)).toBeInTheDocument())
    expect(getSecondAttemptAnalysis).not.toHaveBeenCalled()

    firstFeedback.resolve(feedback)
    await waitFor(() => expect(getSecondAttemptAnalysis).toHaveBeenCalledTimes(1))
    expect(applyAiFeedbackIfAnswerCurrent).toHaveBeenCalledTimes(1)
    expect(applySecondAttemptAnalysisIfAnswerCurrent).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(finalSession)
    expect(finalSession.aiFeedback).toEqual(feedback)
    expect(finalSession.secondAttemptAnalysis).toEqual(secondAttemptAnalysis)
    scrollTo.mockRestore()
  })

  it('does not offer a useless retry after a non-retryable AI error', async () => {
    const user = userEvent.setup()
    const getFeedback = vi.fn().mockRejectedValue(
      new ApiProviderError('request-failed', '邮箱尚未验证。', false),
    )
    const textAi: LLMProvider = {
      id: 'backend-text',
      isConfigured: () => true,
      getFeedback,
    }
    render(
      <PracticeFlow
        question={question}
        session={makeSession({ status: 'first-review', attempts: [attempt] })}
        service={createService()}
        audioFocus={createAudioFocus()}
        textAi={textAi}
        autoPlayQuestion={false}
        onExitGuardChange={() => undefined}
        onChange={() => undefined}
        onBack={() => undefined}
      />,
    )

    await user.click(screen.getByRole('button', { name: '重试 AI 分析' }))
    await waitFor(() => expect(screen.getByText(/邮箱尚未验证/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '重试 AI 分析' })).toBeNull()
  })

  it('enters local manual mode immediately when Text AI is not configured', async () => {
    const user = userEvent.setup()
    const secondSubmitSession = makeSession({
      status: 'comparison-ready',
      attempts: [attempt, secondAttempt],
    })
    const saveTextAttempt = vi.fn().mockResolvedValue(secondSubmitSession)
    const { rerender } = render(
      <PracticeFlow
        question={question}
        session={makeSession({ status: 'second-ready', attempts: [attempt] })}
        service={createService({ saveTextAttempt })}
        audioFocus={createAudioFocus()}
        textAi={{
          id: 'backend-text',
          isConfigured: () => false,
          getFeedback: vi.fn(),
        }}
        autoPlayQuestion={false}
        onExitGuardChange={() => undefined}
        onChange={() => undefined}
        onBack={() => undefined}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: '你的答案文本' }), secondAttempt.transcript.text)
    await user.click(screen.getByRole('button', { name: '提交第 2 次回答' }))
    await waitFor(() => expect(saveTextAttempt).toHaveBeenCalled())
    rerender(
      <PracticeFlow
        question={question}
        session={secondSubmitSession}
        service={createService({ saveTextAttempt })}
        audioFocus={createAudioFocus()}
        textAi={{
          id: 'backend-text',
          isConfigured: () => false,
          getFeedback: vi.fn(),
        }}
        autoPlayQuestion={false}
        onExitGuardChange={() => undefined}
        onChange={() => undefined}
        onBack={() => undefined}
      />,
    )
    await waitFor(() => expect(screen.getByText(/Text AI 未配置/)).toBeInTheDocument())
    expect(screen.getByText(/本地挑出的手动候选/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试二答分析' })).toBeNull()
  })
})
