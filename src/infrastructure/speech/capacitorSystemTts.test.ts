import { describe, expect, it, vi } from 'vitest'
import { SpeechCapabilityUnavailableError } from '../../ports/speech'
import { CapacitorSystemTTS } from './capacitorSystemTts'

describe('CapacitorSystemTTS', () => {
  it('delegates supported settings to the Android system engine', async () => {
    const speak = vi.fn(() => Promise.resolve())
    const stop = vi.fn(() => Promise.resolve())
    const status = vi.fn(() => Promise.resolve({
      available: true,
      engine: 'com.google.android.tts',
      engines: [],
      englishAvailable: true,
    }))
    const provider = new CapacitorSystemTTS({ speak, stop, status }, () => true)

    await provider.speak({
      text: '  Where do you live?  ',
      language: 'en-GB',
      rate: 0.9,
      pitch: 1.1,
      voice: 'unsupported-and-ignored',
    })

    expect(speak).toHaveBeenCalledWith({
      text: 'Where do you live?',
      language: 'en-GB',
      rate: 0.9,
      pitch: 1.1,
    })
  })

  it('reports the native engine and English voice pack status', async () => {
    const status = vi.fn(() => Promise.resolve({
      available: true,
      engine: 'com.google.android.tts',
      engines: [{ name: 'com.google.android.tts', label: 'Google 语音服务' }],
      englishAvailable: false,
    }))
    const provider = new CapacitorSystemTTS(
      {
        speak: vi.fn(() => Promise.resolve()),
        stop: vi.fn(() => Promise.resolve()),
        status,
      },
      () => true,
    )

    const result = await provider.getStatus()
    expect(result.engine).toBe('com.google.android.tts')
    expect(result.englishAvailable).toBe(false)
    expect(result.engines).toHaveLength(1)
  })

  it('returns a safe unavailable status when the bridge fails', async () => {
    const provider = new CapacitorSystemTTS(
      {
        speak: vi.fn(() => Promise.resolve()),
        stop: vi.fn(() => Promise.resolve()),
        status: vi.fn(() => Promise.reject(new Error('bridge down'))),
      },
      () => true,
    )
    const result = await provider.getStatus()
    expect(result).toEqual({
      available: false,
      engine: null,
      engines: [],
      englishAvailable: false,
    })
  })

  it('stops native speech before audio focus changes', async () => {
    const stop = vi.fn(() => Promise.resolve())
    const provider = new CapacitorSystemTTS(
      {
        speak: vi.fn(() => Promise.resolve()),
        stop,
        status: vi.fn(() => Promise.resolve({
          available: true,
          engine: null,
          engines: [],
          englishAvailable: true,
        })),
      },
      () => true,
    )

    await provider.stop()

    expect(stop).toHaveBeenCalledOnce()
  })

  it('fails safely outside Android without calling the bridge', async () => {
    const speak = vi.fn(() => Promise.resolve())
    const provider = new CapacitorSystemTTS(
      {
        speak,
        stop: vi.fn(() => Promise.resolve()),
        status: vi.fn(() => Promise.resolve({
          available: true,
          engine: null,
          engines: [],
          englishAvailable: true,
        })),
      },
      () => false,
    )

    await expect(provider.speak({ text: 'Question' })).rejects.toBeInstanceOf(
      SpeechCapabilityUnavailableError,
    )
    expect(speak).not.toHaveBeenCalled()
    expect(await provider.getStatus()).toEqual({
      available: false,
      engine: null,
      engines: [],
      englishAvailable: false,
    })
  })
})
