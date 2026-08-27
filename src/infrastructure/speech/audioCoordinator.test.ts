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

  it('uses the selected system voice mode and preferred rate', async () => {
    const naturalSpeak = vi.fn().mockResolvedValue(undefined)
    const systemSpeak = vi.fn().mockResolvedValue(undefined)
    const natural: TTSProvider = {
      id: 'natural',
      capabilities,
      isAvailable: () => true,
      speak: naturalSpeak,
      stop: vi.fn().mockResolvedValue(undefined),
    }
    const system: TTSProvider = {
      id: 'system',
      capabilities,
      isAvailable: () => true,
      speak: systemSpeak,
      stop: vi.fn().mockResolvedValue(undefined),
    }
    const recording: RecordingPlayback = {
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }
    const coordinator = new AudioCoordinator(natural, recording, {
      systemTts: system,
      getPlaybackPreferences: () => ({ voiceMode: 'system', rate: 0.8, pitch: 1.05 }),
    })

    await coordinator.speak({ text: 'Long Part 2 answer', rate: 1.1 })

    expect(naturalSpeak).not.toHaveBeenCalled()
    expect(systemSpeak).toHaveBeenCalledWith({
      text: 'Long Part 2 answer',
      rate: 0.8,
      pitch: 1.05,
    })
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

  it('publishes real progress and supports pause, resume and seek', async () => {
    let element: HTMLAudioElementLike | undefined
    const play = vi.fn(() => Promise.resolve())
    const pause = vi.fn()
    const playback = new HTMLAudioPlayback(() => {
      const created: HTMLAudioElementLike = {
        src: '',
        currentTime: 0,
        duration: Number.NaN,
        onended: null,
        onerror: null,
        onloadedmetadata: null,
        ontimeupdate: null,
        onplay: null,
        onpause: null,
        play,
        pause,
      }
      element = created
      return created
    })

    const completion = playback.play('blob:generated-tts')
    await vi.waitFor(() => {
      expect(playback.snapshot.status).toBe('playing')
    })

    if (!element) throw new Error('Expected an audio element')
    element.duration = 125.4
    element.onloadedmetadata?.()
    expect(playback.snapshot.durationSeconds).toBe(125.4)
    expect(playback.snapshot.canSeek).toBe(true)

    await expect(playback.pause()).resolves.toBe(true)
    expect(playback.snapshot.status).toBe('paused')

    await expect(playback.seekTo(31.2)).resolves.toBe(true)
    expect(element.currentTime).toBe(31.2)
    expect(playback.snapshot.positionSeconds).toBe(31.2)

    await expect(playback.resume()).resolves.toBe(true)
    expect(play).toHaveBeenCalledTimes(2)
    expect(playback.snapshot.status).toBe('playing')

    element.onended?.()
    await expect(completion).resolves.toBeUndefined()
    expect(playback.snapshot.status).toBe('idle')
  })
})
