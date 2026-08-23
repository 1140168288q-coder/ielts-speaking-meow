import type {
  RecordingPlayback,
  TTSCapabilities,
  TTSProvider,
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

function createHarness() {
  const calls: string[] = []
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
  return {
    calls,
    coordinator: new AudioCoordinator(tts, playback),
  }
}

describe('AudioCoordinator', () => {
  it('stops saved-audio playback before starting TTS', async () => {
    const { calls, coordinator } = createHarness()

    const speaking = coordinator.speak({ text: 'Question' })
    await vi.waitFor(() => {
      expect(coordinator.state).toBe('tts')
    })

    expect(calls).toEqual(['recording-stop', 'tts-stop', 'tts-play'])
    await coordinator.stopTTS()
    await expect(speaking).resolves.toBeUndefined()
    expect(coordinator.state).toBe('idle')
  })

  it('interrupts TTS before playing a saved historical recording', async () => {
    const { coordinator, calls } = createHarness()
    const speaking = coordinator.speak({ text: 'Question' })
    await vi.waitFor(() => {
      expect(coordinator.state).toBe('tts')
    })

    const playback = coordinator.playRecording('file:///answer.webm')
    await vi.waitFor(() => {
      expect(coordinator.state).toBe('recording-playback')
    })
    await expect(speaking).resolves.toBeUndefined()

    expect(calls.slice(-3)).toEqual([
      'tts-stop',
      'recording-stop',
      'recording-play',
    ])
    await coordinator.stopRecordingPlayback()
    await expect(playback).resolves.toBeUndefined()
    expect(coordinator.state).toBe('idle')
  })

  it('stops both playback providers through the shared boundary', async () => {
    const { calls, coordinator } = createHarness()
    const playback = coordinator.playRecording('file:///answer.webm')
    await vi.waitFor(() => {
      expect(coordinator.state).toBe('recording-playback')
    })

    await coordinator.stopAllPlayback()

    await expect(playback).resolves.toBeUndefined()
    expect(calls.slice(-2)).toEqual(['tts-stop', 'recording-stop'])
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
