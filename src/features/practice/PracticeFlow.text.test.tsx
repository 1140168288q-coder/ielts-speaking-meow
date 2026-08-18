import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PracticeService } from '../../application/practiceService'
import type {
  AiFeedback,
  PracticeAttempt,
  Question,
  TrainingSession,
} from '../../domain'
import type { LLMProvider } from '../../ports/ai'
import type { AudioFocus } from '../../ports/speech'
import { PracticeFlow } from './PracticeFlow'

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

const feedback: AiFeedback = {
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

function makeSession(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 'session-1',
    questionId: question.id,
    status: 'first-ready',
    attempts: [],
    localFeedback: [],
    aiFeedback: null,
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
    prepareSecondAttempt: vi.fn(),
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

    expect(screen.getByText(/手机系统键盘自带语音输入/)).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: /提交第 1 次回答并分析/ }))

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
    expect(screen.getAllByText('简单自然版').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('自然提升版').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('另一种表达版').length).toBeGreaterThanOrEqual(1)

    // improvedAnswer 与“简单自然版”内容相同,是产品允许的;这里只确认存在。
    expect(screen.getAllByText(feedback.improvedAnswer).length).toBeGreaterThanOrEqual(2)

    // 优化答案按钮:第一次播放,第二次立即停止。
    const improvedToggle = screen.getByRole('button', { name: '试听' })
    await user.click(improvedToggle)
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '停止' }))
    expect(
      (audioFocus.stopTTS as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(0)

    // 播放 A 时点 B:UI 只保留 B 的播放状态,并提交 B 的新文本。
    await user.click(screen.getByRole('button', { name: '试听' }))
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
})
