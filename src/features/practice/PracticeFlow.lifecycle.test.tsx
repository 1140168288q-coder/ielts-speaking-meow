import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PracticeService } from '../../application/practiceService'
import { questionBank } from '../../data/questions'
import type { TrainingSession } from '../../domain'
import type { LLMProvider } from '../../ports/ai'
import type {
  AudioFocus,
  AudioFocusListener,
  AudioFocusState,
  RecordedAudioSTTProvider,
  STTProvider,
} from '../../ports/speech'
import {
  PracticeFlow,
} from './PracticeFlow'
import { createInterruptedTranscriptInput } from './lifecycle'

const NOW = '2026-08-14T08:00:00.000Z'

const session: TrainingSession = {
  id: 'session-lifecycle',
  questionId: 'p1-home-001',
  status: 'first-ready',
  attempts: [],
  localFeedback: [],
  aiFeedback: null,
  comparison: null,
  createdAt: NOW,
  updatedAt: NOW,
}

class FakeAudioFocus implements AudioFocus {
  state: AudioFocusState = 'idle'
  private readonly listeners = new Set<AudioFocusListener>()
  readonly cancelRecording = vi.fn(() => {
    this.setState('idle')
    return Promise.resolve()
  })
  readonly stopRecording = vi.fn(() => {
    this.setState('idle')
    return Promise.resolve({
      blob: new Blob(['interrupted-audio'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
      durationMs: 4_000,
      startedAt: 1_000,
      endedAt: 5_000,
    })
  })

  subscribe(listener: AudioFocusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  speak(): Promise<void> {
    return Promise.resolve()
  }

  stopTTS(): Promise<void> {
    return Promise.resolve()
  }

  playRecording(): Promise<void> {
    return Promise.resolve()
  }

  stopRecordingPlayback(): Promise<void> {
    return Promise.resolve()
  }

  startRecording(): Promise<void> {
    this.setState('recording')
    return Promise.resolve()
  }

  stopAllPlayback(): Promise<void> {
    return Promise.resolve()
  }

  private setState(state: AudioFocusState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
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

const unavailableTextAi: LLMProvider = {
  id: 'unavailable-text-ai',
  isConfigured: () => false,
  getFeedback: () => Promise.reject(new Error('unavailable')),
  compareAttempts: () => Promise.reject(new Error('unavailable')),
}

describe('PracticeFlow lifecycle durability', () => {
  it('creates a retryable transcript state when no live text exists', () => {
    expect(createInterruptedTranscriptInput('')).toEqual({
      text: '',
      status: 'failed',
      source: null,
      errorCode: 'recording-interrupted',
    })
    expect(createInterruptedTranscriptInput('  I enjoy reading.  ')).toEqual({
      text: 'I enjoy reading.',
      status: 'ready',
      source: 'stt',
    })
  })

  it('stops and persists an active recording when the app is hidden', async () => {
    const user = userEvent.setup()
    const audioFocus = new FakeAudioFocus()
    const saveAttempt = vi.fn().mockResolvedValue(session)
    const service = { saveAttempt } as unknown as PracticeService
    const onChange = vi.fn()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })

    render(
      <PracticeFlow
        question={questionBank[0]!}
        session={session}
        service={service}
        audioFocus={audioFocus}
        stt={unavailableStt}
        remoteStt={unavailableRemoteStt}
        textAi={unavailableTextAi}
        onExitGuardChange={vi.fn()}
        onChange={onChange}
        onBack={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '开始第 1 次录音' }))
    await screen.findByRole('button', { name: '停止并保存' })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() => expect(saveAttempt).toHaveBeenCalledOnce())
    expect(saveAttempt).toHaveBeenCalledWith(
      session.id,
      1,
      expect.objectContaining({ mimeType: 'audio/webm', durationMs: 4_000 }),
      createInterruptedTranscriptInput(''),
    )
    expect(audioFocus.stopRecording).toHaveBeenCalledOnce()
    expect(audioFocus.cancelRecording).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith(session)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })
})
