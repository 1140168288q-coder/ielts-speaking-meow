import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PracticeService } from '../../application/practiceService'
import { questionBank } from '../../data/questions'
import type {
  AiFeedback,
  PracticeAttempt,
  TrainingSession,
} from '../../domain'
import type { LLMProvider } from '../../ports/ai'
import type {
  AudioFocus,
  RecordedAudioSTTProvider,
  STTProvider,
} from '../../ports/speech'
import { PracticeFlow } from './PracticeFlow'

const NOW = '2026-08-14T08:00:00.000Z'

const versionFeedback: AiFeedback = {
  summary: { problem: '回答中填充词较多。', suggestion: '用短暂停顿代替填充词。' },
  versions: [
    {
      style: '基础稳妥',
      text: 'I like reading at home because it helps me relax.',
      hint: 'opening: I like ... because ...',
    },
    {
      style: '自然均衡',
      text: 'In my free time I enjoy reading since it helps me unwind.',
      hint: 'opening: In my free time ...',
    },
    {
      style: '略加挑战',
      text: 'Reading is my favourite way to relax and broaden my view.',
      hint: '... is my favourite way to ...',
    },
  ],
}

function attempt(number: 1 | 2, text: string): PracticeAttempt {
  return {
    id: `attempt-${number}`,
    attemptNumber: number,
    audio: {
      id: `audio-${number}`,
      relativePath: `indexeddb://audio/audio-${number}`,
      mimeType: 'audio/webm',
      durationMs: 30_000,
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
    metrics: {
      durationMs: 30_000,
      wordCount: 8,
      wordsPerMinute: 16,
      fillerWords: text.toLocaleLowerCase().includes('um')
        ? [{ phrase: 'um', count: 1 }]
        : [],
      fillerCount: text.toLocaleLowerCase().includes('um') ? 1 : 0,
      repeatedWords: [],
      repeatedWordCount: 0,
      caveats: ['Approximate transcript metrics.'],
    },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeSession(overrides: Partial<TrainingSession>): TrainingSession {
  return {
    id: 'feedback-session',
    questionId: 'p1-home-001',
    status: 'feedback-ready',
    attempts: [attempt(1, 'Um I like reading at home.')],
    localFeedback: [],
    aiFeedback: versionFeedback,
    comparison: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeAudioFocus(): AudioFocus {
  return {
    state: 'idle',
    subscribe: () => () => undefined,
    speak: vi.fn(() => Promise.resolve()),
    stopTTS: vi.fn(() => Promise.resolve()),
    stopAllPlayback: vi.fn(() => Promise.resolve()),
    cancelRecording: vi.fn(() => Promise.resolve()),
    startRecording: vi.fn(() => Promise.resolve()),
    stopRecording: vi.fn(() =>
      Promise.resolve({
        blob: new Blob(['audio'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 4_000,
        startedAt: 1_000,
        endedAt: 5_000,
      }),
    ),
    playRecording: vi.fn(() => Promise.resolve()),
    stopRecordingPlayback: vi.fn(() => Promise.resolve()),
  } as unknown as AudioFocus
}

const unavailableStt: STTProvider = {
  id: 'unavailable-stt',
  isAvailable: () => false,
  start: () => Promise.reject(new Error('unavailable')),
}

const unavailableRemoteStt: RecordedAudioSTTProvider = {
  id: 'unavailable-remote-stt',
  isConfigured: () => false,
  isDefinitelyConfigured: () => false,
  transcribe: () => Promise.reject(new Error('unavailable')),
}

const configuredTextAi: LLMProvider = {
  id: 'fake-text-ai',
  isConfigured: () => true,
  getFeedback: vi.fn(),
  compareAttempts: vi.fn(),
}

function renderFlow({
  session,
  service = {} as unknown as PracticeService,
  textAi = configuredTextAi,
}: {
  session: TrainingSession
  service?: PracticeService
  textAi?: LLMProvider
}) {
  return render(
    <PracticeFlow
      question={questionBank[0]!}
      session={session}
      service={service}
      audioFocus={makeAudioFocus()}
      stt={unavailableStt}
      remoteStt={unavailableRemoteStt}
      textAi={textAi}
      onExitGuardChange={vi.fn()}
      onChange={vi.fn()}
      onBack={vi.fn()}
    />,
  )
}

describe('PracticeFlow first-attempt feedback', () => {
  it('shows one Chinese problem line and one suggestion line from the AI summary', () => {
    renderFlow({ session: makeSession({}) })

    expect(
      screen.getByText('回答中填充词较多。'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('用短暂停顿代替填充词。'),
    ).toBeInTheDocument()
    expect(screen.getByText('问题')).toBeInTheDocument()
    expect(screen.getByText('建议')).toBeInTheDocument()
    expect(screen.queryByText('本地反馈 · 最多 3 条')).not.toBeInTheDocument()
  })

  it('falls back to a local Chinese summary when AI is unavailable', async () => {
    const user = userEvent.setup()
    const prepareSecond = vi.fn().mockResolvedValue(
      makeSession({ status: 'second-ready', aiFeedback: null }),
    )
    const service = {
      prepareSecondAttempt: prepareSecond,
    } as unknown as PracticeService
    const session = makeSession({ aiFeedback: null, status: 'first-review' })

    renderFlow({
      session,
      service,
      textAi: {
        id: 'unavailable-text-ai',
        isConfigured: () => false,
        getFeedback: vi.fn(),
        compareAttempts: vi.fn(),
      },
    })

    expect(screen.getByText(/口头填充词/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '进入第二次回答' }))
    expect(prepareSecond).toHaveBeenCalledWith(session.id)
  })

  it('previews and selects one of the three AI versions', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const selectVersion = vi.fn().mockResolvedValue(
      makeSession({ selectedVersionIndex: 0 }),
    )
    const service = { selectVersion } as unknown as PracticeService
    const session = makeSession({})
    const speakSpy = vi.fn(() => Promise.resolve())
    const audioFocus = { ...makeAudioFocus(), speak: speakSpy }

    render(
      <PracticeFlow
        question={questionBank[0]!}
        session={session}
        service={service}
        audioFocus={audioFocus}
        stt={unavailableStt}
        remoteStt={unavailableRemoteStt}
        textAi={configuredTextAi}
        onExitGuardChange={vi.fn()}
        onChange={onChange}
        onBack={vi.fn()}
      />,
    )

    const previewButtons = screen.getAllByRole('button', { name: '▶ 试听' })
    expect(previewButtons).toHaveLength(3)
    await user.click(previewButtons[0]!)
    expect(speakSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: versionFeedback.versions?.[0]?.text }),
    )

    await user.click(screen.getAllByRole('button', { name: '选择这个版本' })[0]!)
    expect(selectVersion).toHaveBeenCalledWith(session.id, 0)
  })
})

describe('PracticeFlow read-aloud review', () => {
  it('lists suspected pronunciation issues with relisten buttons and continues', async () => {
    const user = userEvent.setup()
    const prepareSecond = vi.fn().mockResolvedValue(
      makeSession({ status: 'second-ready' }),
    )
    const service = {
      prepareSecondAttempt: prepareSecond,
    } as unknown as PracticeService
    const session = makeSession({
      selectedVersionIndex: 0,
      readAloud: {
        audio: {
          id: 'audio-read-aloud',
          relativePath: 'indexeddb://audio/audio-read-aloud',
          mimeType: 'audio/webm',
          durationMs: 12_000,
          createdAt: NOW,
        },
        transcript: {
          status: 'ready',
          text: 'I like read at home.',
          originalText: 'I like read at home.',
          source: 'stt',
          errorCode: null,
          updatedAt: NOW,
        },
        targetVersionIndex: 0,
        issues: [{ word: 'reading', heardAs: 'read' }],
      },
    })

    renderFlow({ session, service })

    expect(screen.getByText('reading', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText(/可能发音不准/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '▶ 重新试听示范' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /回放我的跟读/ }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '进入第二次回答' }))
    expect(prepareSecond).toHaveBeenCalledWith(session.id)
  })
})

describe('PracticeFlow second-attempt hint', () => {
  it('reveals the hint only while the button is held', () => {
    const session = makeSession({
      status: 'second-ready',
      selectedVersionIndex: 0,
    })
    renderFlow({ session })

    const hold = screen.getByRole('button', { name: '按住查看提示' })
    expect(
      screen.queryByText('opening: I like ... because ...'),
    ).not.toBeInTheDocument()

    fireEvent.pointerDown(hold)
    expect(
      screen.getByText('opening: I like ... because ...'),
    ).toBeInTheDocument()

    fireEvent.pointerUp(hold)
    expect(
      screen.queryByText('opening: I like ... because ...'),
    ).not.toBeInTheDocument()
  })
})
