import {
  AudioFocusConflictError,
  type AudioRecorder,
  type AudioRecording,
  type RecordingPlayback,
  type TTSCapabilities,
  type TTSProvider,
} from '../../ports/speech'
import { AudioCoordinator } from './audioCoordinator'
import {
  HTMLAudioPlayback,
  type HTMLAudioElementLike,
} from './htmlAudioPlayback'

const capabilities: TTSCapabilities = {
  language: true,
  voice: true,
  rate: true,
  pitch: true,
  style: false,
}

const recording: AudioRecording = {
  blob: new Blob(['audio']),
  mimeType: 'audio/webm',
  durationMs: 1_000,
  startedAt: 1_000,
  endedAt: 2_000,
}

function createHarness() {
  const calls: string[] = []
  let recorderState: AudioRecorder['state'] = 'idle'
  let finishTTS: (() => void) | undefined
  let finishPlayback: (() => void) | undefined
  const ttsSpeak = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        calls.push('tts-play')
        finishTTS = resolve
      }),
  )
  const playbackPlay = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        calls.push('recording-play')
        finishPlayback = resolve
      }),
  )

  const tts: TTSProvider = {
    id: 'tts',
    capabilities,
    isAvailable: () => true,
    speak: ttsSpeak,
    stop: vi.fn(() => {
      calls.push('tts-stop')
      finishTTS?.()
      finishTTS = undefined
      return Promise.resolve()
    }),
  }
  const playback: RecordingPlayback = {
    play: playbackPlay,
    stop: vi.fn(() => {
      calls.push('recording-stop')
      finishPlayback?.()
      finishPlayback = undefined
      return Promise.resolve()
    }),
  }
  const recorder: AudioRecorder = {
    get state() {
      return recorderState
    },
    isAvailable: () => true,
    start: vi.fn(() => {
      calls.push('recorder-start')
      recorderState = 'recording'
      return Promise.resolve()
    }),
    stop: vi.fn(() => {
      calls.push('recorder-stop')
      recorderState = 'idle'
      return Promise.resolve(recording)
    }),
    cancel: vi.fn(() => {
      recorderState = 'idle'
      return Promise.resolve()
    }),
  }

  return {
    calls,
    tts,
    playback,
    recorder,
    ttsSpeak,
    playbackPlay,
    coordinator: new AudioCoordinator(tts, recorder, playback),
  }
}

describe('AudioCoordinator', () => {
  it('stops TTS and answer playback before opening the microphone', async () => {
    const { calls, coordinator } = createHarness()

    await coordinator.startRecording()

    expect(calls).toEqual(['tts-stop', 'recording-stop', 'recorder-start'])
    expect(coordinator.state).toBe('recording')
  })

  it('rejects every playback path while recording', async () => {
    const { coordinator, ttsSpeak, playbackPlay } = createHarness()
    await coordinator.startRecording()

    await expect(coordinator.speak({ text: 'Question' })).rejects.toBeInstanceOf(
      AudioFocusConflictError,
    )
    await expect(coordinator.playRecording('answer.webm')).rejects.toBeInstanceOf(
      AudioFocusConflictError,
    )
    expect(ttsSpeak).not.toHaveBeenCalled()
    expect(playbackPlay).not.toHaveBeenCalled()
  })

  it('interrupts active TTS before starting a recording', async () => {
    const { coordinator, calls } = createHarness()
    const speaking = coordinator.speak({ text: 'Question' })
    await vi.waitFor(() => {
      expect(coordinator.state).toBe('tts')
    })

    await coordinator.startRecording()
    await expect(speaking).resolves.toBeUndefined()

    expect(calls.slice(-3)).toEqual([
      'tts-stop',
      'recording-stop',
      'recorder-start',
    ])
    expect(coordinator.state).toBe('recording')
  })

  it('returns a saved recording before releasing recording focus', async () => {
    const { coordinator } = createHarness()
    await coordinator.startRecording()

    await expect(coordinator.stopRecording()).resolves.toEqual(recording)
    expect(coordinator.state).toBe('idle')
  })
})

describe('HTMLAudioPlayback', () => {
  it('resolves on completion and stops an active element safely', async () => {
    let element: HTMLAudioElementLike | undefined
    const pause = vi.fn()
    const playback = new HTMLAudioPlayback(() => {
      const created: HTMLAudioElementLike = {
        src: '',
        currentTime: 0,
        onended: null,
        onerror: null,
        play: vi.fn(() => Promise.resolve()),
        pause,
      }
      element = created
      return created
    })

    const completion = playback.play('file:///answer.webm')
    await vi.waitFor(() => {
      expect(element?.src).toBe('file:///answer.webm')
    })
    await playback.stop()

    expect(pause).toHaveBeenCalledOnce()
    expect(element?.currentTime).toBe(0)
    await expect(completion).resolves.toBeUndefined()
  })
})
