import {
  SpeechCapabilityUnavailableError,
  type TTSCapabilities,
  type TTSProvider,
} from '../../ports/speech'
import { FallbackTTSProvider } from './fallbackTtsProvider'
import {
  SystemWebSpeechTTS,
  type WebSpeechSynthesis,
  type WebSpeechUtterance,
} from './systemWebSpeechTts'

const fullCapabilities: TTSCapabilities = {
  language: true,
  voice: true,
  rate: true,
  pitch: true,
  style: true,
}

function fakeProvider(
  id: string,
  overrides: Partial<TTSProvider> = {},
): TTSProvider {
  return {
    id,
    capabilities: fullCapabilities,
    isAvailable: () => true,
    speak: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    ...overrides,
  }
}

describe('SystemWebSpeechTTS', () => {
  it('maps supported voice settings and resolves when speech ends', async () => {
    const utterances: WebSpeechUtterance[] = []
    const synthesis: WebSpeechSynthesis = {
      speak: (utterance) => {
        utterances.push(utterance)
      },
      cancel: vi.fn(),
      getVoices: () => [
        { name: 'English UK', lang: 'en-GB' },
        { name: 'English US', lang: 'en-US' },
      ],
    }
    const provider = new SystemWebSpeechTTS({
      synthesis,
      createUtterance: (text) => ({
        text,
        lang: '',
        voice: null,
        rate: 1,
        pitch: 1,
        onend: null,
        onerror: null,
      }),
    })

    const completion = provider.speak({
      text: 'Where do you live?',
      language: 'en-GB',
      voice: 'English UK',
      rate: 0.9,
      pitch: 1.1,
      style: 'examiner',
    })
    await vi.waitFor(() => {
      expect(utterances).toHaveLength(1)
    })

    const utterance = utterances[0]
    expect(utterance).toMatchObject({
      text: 'Where do you live?',
      lang: 'en-GB',
      rate: 0.9,
      pitch: 1.1,
      voice: { name: 'English UK', lang: 'en-GB' },
    })
    utterance?.onend?.()

    await expect(completion).resolves.toBeUndefined()
  })

  it('resolves an active request when it is deliberately stopped', async () => {
    let utterance: WebSpeechUtterance | undefined
    const cancel = vi.fn()
    const provider = new SystemWebSpeechTTS({
      synthesis: {
        speak: (value) => {
          utterance = value
        },
        cancel,
        getVoices: () => [],
      },
      createUtterance: (text) => ({
        text,
        lang: '',
        voice: null,
        rate: 1,
        pitch: 1,
        onend: null,
        onerror: null,
      }),
    })

    const completion = provider.speak({ text: 'Question' })
    await vi.waitFor(() => {
      expect(utterance).toBeDefined()
    })
    await provider.stop()

    expect(cancel).toHaveBeenCalledOnce()
    await expect(completion).resolves.toBeUndefined()
  })

  it('reports a typed unavailable error outside supported browsers', async () => {
    const provider = new SystemWebSpeechTTS({
      synthesis: null,
      createUtterance: null,
    })

    await expect(provider.speak({ text: 'Question' })).rejects.toBeInstanceOf(
      SpeechCapabilityUnavailableError,
    )
  })
})

describe('FallbackTTSProvider', () => {
  it('uses system TTS when the preferred AI provider fails', async () => {
    const primarySpeak = vi.fn(() => Promise.reject(new Error('AI service is down')))
    const fallbackSpeak = vi.fn(() => Promise.resolve())
    const provider = new FallbackTTSProvider(
      fakeProvider('ai', { speak: primarySpeak }),
      fakeProvider('system', { speak: fallbackSpeak }),
    )

    await expect(provider.speak({ text: 'Question' })).resolves.toBeUndefined()

    expect(primarySpeak).toHaveBeenCalledOnce()
    expect(fallbackSpeak).toHaveBeenCalledWith({ text: 'Question' })
  })

  it('goes directly to system TTS when AI TTS is not configured', async () => {
    const primarySpeak = vi.fn(() => Promise.resolve())
    const fallbackSpeak = vi.fn(() => Promise.resolve())
    const provider = new FallbackTTSProvider(
      fakeProvider('ai', { isAvailable: () => false, speak: primarySpeak }),
      fakeProvider('system', { speak: fallbackSpeak }),
    )

    await provider.speak({ text: 'Question' })

    expect(primarySpeak).not.toHaveBeenCalled()
    expect(fallbackSpeak).toHaveBeenCalledOnce()
  })
})
