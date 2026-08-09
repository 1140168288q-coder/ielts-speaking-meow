import { describe, expect, it, vi } from 'vitest'
import { SpeechCapabilityUnavailableError } from '../../ports/speech'
import { CapacitorSystemTTS } from './capacitorSystemTts'

describe('CapacitorSystemTTS', () => {
  it('delegates supported settings to the Android system engine', async () => {
    const speak = vi.fn(() => Promise.resolve())
    const stop = vi.fn(() => Promise.resolve())
    const provider = new CapacitorSystemTTS({ speak, stop }, () => true)

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

  it('stops native speech before audio focus changes', async () => {
    const stop = vi.fn(() => Promise.resolve())
    const provider = new CapacitorSystemTTS(
      { speak: vi.fn(() => Promise.resolve()), stop },
      () => true,
    )

    await provider.stop()

    expect(stop).toHaveBeenCalledOnce()
  })

  it('fails safely outside Android without calling the bridge', async () => {
    const speak = vi.fn(() => Promise.resolve())
    const provider = new CapacitorSystemTTS(
      { speak, stop: vi.fn(() => Promise.resolve()) },
      () => false,
    )

    await expect(provider.speak({ text: 'Question' })).rejects.toBeInstanceOf(
      SpeechCapabilityUnavailableError,
    )
    expect(speak).not.toHaveBeenCalled()
  })
})
