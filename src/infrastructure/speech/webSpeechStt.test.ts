import {
  SpeechCapabilityUnavailableError,
  type STTResult,
} from '../../ports/speech'
import {
  WebSpeechSTT,
  type WebSpeechRecognition,
  type WebSpeechRecognitionEvent,
} from './webSpeechStt'

class FakeRecognition implements WebSpeechRecognition {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 0
  onstart: (() => void) | null = null
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null = null
  onerror: WebSpeechRecognition['onerror'] = null
  onend: (() => void) | null = null

  readonly start = vi.fn(() => {
    this.onstart?.()
  })
  readonly stop = vi.fn(() => {
    this.onend?.()
  })
  readonly abort = vi.fn(() => {
    this.onend?.()
  })
}

describe('WebSpeechSTT', () => {
  it('emits interim and final live transcripts without normalizing speech', async () => {
    const recognition = new FakeRecognition()
    const results: STTResult[] = []
    const onEnd = vi.fn()
    const provider = new WebSpeechSTT(() => recognition)

    const session = await provider.start(
      { language: 'en-GB', interimResults: true, continuous: true },
      { onResult: (result) => results.push(result), onEnd },
    )

    recognition.onresult?.({
      resultIndex: 0,
      results: {
        0: {
          0: { transcript: 'um I I think', confidence: 0.6 },
          isFinal: false,
          length: 1,
        },
        1: {
          0: { transcript: 'um I I think it is useful', confidence: 0.9 },
          isFinal: true,
          length: 1,
        },
        length: 2,
      },
    })

    expect(results).toEqual([
      { transcript: 'um I I think', isFinal: false, confidence: 0.6 },
      {
        transcript: 'um I I think it is useful',
        isFinal: true,
        confidence: 0.9,
      },
    ])
    expect(recognition).toMatchObject({
      lang: 'en-GB',
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
    })

    await session.stop()
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('maps recognition failures to portable STT errors', async () => {
    const recognition = new FakeRecognition()
    const onError = vi.fn()
    const provider = new WebSpeechSTT(() => recognition)

    await provider.start({}, { onResult: vi.fn(), onError })
    recognition.onerror?.({ error: 'not-allowed', message: 'Permission denied' })

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'not-allowed',
        retryable: false,
        message: 'Permission denied',
      }),
    )
  })

  it('fails cleanly when Web Speech recognition is unavailable', async () => {
    const provider = new WebSpeechSTT(null)

    await expect(
      provider.start({}, { onResult: vi.fn() }),
    ).rejects.toBeInstanceOf(SpeechCapabilityUnavailableError)
  })
})
