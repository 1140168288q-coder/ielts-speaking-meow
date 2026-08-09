import type { TtsCacheEntry } from '../../domain'
import type { ApiTransportResponse } from '../ai/apiTransport'
import type { TtsCacheStorage } from '../../ports/imports'
import type { RecordingPlayback, TTSProvider } from '../../ports/speech'
import {
  createConfiguredApiHarness,
  voiceConfiguration,
} from '../../test/fixtures/apiHarness'
import {
  createApiTransportFake,
  response,
} from '../../test/fixtures/apiTransportFake'
import { FallbackTTSProvider } from './fallbackTtsProvider'
import { OpenAICompatibleTtsProvider } from './openAiCompatibleTtsProvider'

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

class MemoryTtsCache implements TtsCacheStorage {
  readonly values = new Map<
    string,
    { metadata: TtsCacheEntry; audio: Blob }
  >()
  failNextGet: Error | null = null
  failNextPut: Error | null = null

  getTtsCacheEntry(cacheId: string): Promise<{
    metadata: TtsCacheEntry
    audio: Blob
  } | null> {
    if (this.failNextGet !== null) {
      const error = this.failNextGet
      this.failNextGet = null
      return Promise.reject(error)
    }
    return Promise.resolve(this.values.get(cacheId) ?? null)
  }

  putTtsCacheEntry(metadata: TtsCacheEntry, audio: Blob): Promise<void> {
    if (this.failNextPut !== null) {
      const error = this.failNextPut
      this.failNextPut = null
      return Promise.reject(error)
    }
    this.values.set(metadata.id, { metadata, audio })
    return Promise.resolve()
  }
}

function createPlayback() {
  const play = vi.fn<(source: string) => Promise<void>>(() => Promise.resolve())
  const stop = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const playback: RecordingPlayback = { play, stop }
  return { playback, play, stop }
}

function installObjectUrlSpies() {
  const createObjectURL = vi.fn(() => 'blob:synthetic-voice')
  const revokeObjectURL = vi.fn(() => undefined)
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  })
  return { createObjectURL, revokeObjectURL }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('OpenAICompatibleTtsProvider', () => {
  it('uses only Voice AI credentials, caches generated audio, and reuses it', async () => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    const audio = new Blob(['generated voice'], { type: 'audio/mpeg' })
    transport.postJsonForBinary.mockResolvedValue(response(200, audio))
    const cache = new MemoryTtsCache()
    const playback = createPlayback()
    const urls = installObjectUrlSpies()
    const provider = new OpenAICompatibleTtsProvider(
      settings.service,
      transport.transport,
      cache,
      playback.playback,
    )
    const request = {
      text: 'I tend to unwind by reading.',
      voice: 'calm-fixture-voice',
      rate: 0.9,
      style: 'Speak naturally.',
    }

    await provider.speak(request)
    await provider.speak(request)

    expect(transport.postJsonForBinary).toHaveBeenCalledOnce()
    const [url, key, body, timeout] =
      transport.postJsonForBinary.mock.calls[0]!
    expect(url).toBe(`${voiceConfiguration.endpoint}/audio/speech`)
    expect(key === settings.keys['voice-ai']).toBe(true)
    expect(key === settings.keys['text-ai']).toBe(false)
    expect(key === settings.keys.stt).toBe(false)
    expect(body).toEqual({
      model: voiceConfiguration.model,
      input: request.text,
      voice: request.voice,
      response_format: 'mp3',
      speed: request.rate,
      instructions: request.style,
    })
    expect(timeout).toBe(60_000)
    expect(cache.values.size).toBe(1)
    expect(playback.play).toHaveBeenCalledTimes(2)
    expect(playback.play).toHaveBeenNthCalledWith(1, 'blob:synthetic-voice')
    expect(urls.createObjectURL).toHaveBeenCalledTimes(2)
    expect(urls.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('continues playback when cache read and write both fail', async () => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    const cache = new MemoryTtsCache()
    cache.failNextGet = new Error('cache read failed')
    cache.failNextPut = new Error('cache write failed')
    const playback = createPlayback()
    installObjectUrlSpies()
    const provider = new OpenAICompatibleTtsProvider(
      settings.service,
      transport.transport,
      cache,
      playback.playback,
    )

    await expect(provider.speak({ text: 'Question' })).resolves.toBeUndefined()

    expect(transport.postJsonForBinary).toHaveBeenCalledOnce()
    expect(playback.play).toHaveBeenCalledOnce()
    expect(cache.values.size).toBe(0)
  })

  it.each([
    [401, 'unauthorized', false],
    [404, 'not-found', false],
    [429, 'rate-limited', true],
  ] as const)(
    'maps HTTP %i to %s before attempting playback',
    async (status, code, retryable) => {
      const settings = await createConfiguredApiHarness()
      const transport = createApiTransportFake()
      transport.postJsonForBinary.mockResolvedValue(
        response(status, new Blob(['error payload'])),
      )
      const cache = new MemoryTtsCache()
      const playback = createPlayback()
      const provider = new OpenAICompatibleTtsProvider(
        settings.service,
        transport.transport,
        cache,
        playback.playback,
      )

      await expect(provider.speak({ text: 'Question' })).rejects.toMatchObject({
        code,
        retryable,
      })
      expect(playback.play).not.toHaveBeenCalled()
    },
  )

  it('maps transport failure to a retryable network error', async () => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    transport.postJsonForBinary.mockRejectedValue(new Error('offline'))
    const playback = createPlayback()
    const provider = new OpenAICompatibleTtsProvider(
      settings.service,
      transport.transport,
      new MemoryTtsCache(),
      playback.playback,
    )

    await expect(provider.speak({ text: 'Question' })).rejects.toMatchObject({
      code: 'network',
      retryable: true,
    })
  })

  it('rejects empty binary output as an invalid response', async () => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    transport.postJsonForBinary.mockResolvedValue(
      response(200, new Blob([], { type: 'audio/mpeg' })),
    )
    const playback = createPlayback()
    const provider = new OpenAICompatibleTtsProvider(
      settings.service,
      transport.transport,
      new MemoryTtsCache(),
      playback.playback,
    )

    await expect(provider.speak({ text: 'Question' })).rejects.toMatchObject({
      code: 'invalid-response',
      retryable: true,
    })
    expect(playback.play).not.toHaveBeenCalled()
  })

  it('invalidates a late Voice AI response after stop and never starts playback', async () => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    const responseDeferred = deferred<ApiTransportResponse<Blob>>()
    transport.postJsonForBinary.mockReturnValue(responseDeferred.promise)
    const playback = createPlayback()
    const urls = installObjectUrlSpies()
    const provider = new OpenAICompatibleTtsProvider(
      settings.service,
      transport.transport,
      new MemoryTtsCache(),
      playback.playback,
    )

    const speaking = provider.speak({ text: 'A delayed question' })
    await vi.waitFor(() => {
      expect(transport.postJsonForBinary).toHaveBeenCalledOnce()
    })

    await provider.stop()
    responseDeferred.resolve(
      response(200, new Blob(['late voice'], { type: 'audio/mpeg' })),
    )

    await expect(speaking).resolves.toBeUndefined()
    expect(playback.play).not.toHaveBeenCalled()
    expect(urls.createObjectURL).not.toHaveBeenCalled()
  })

  it('does not start Voice AI or System TTS after the fallback provider is stopped', async () => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    const responseDeferred = deferred<ApiTransportResponse<Blob>>()
    transport.postJsonForBinary.mockReturnValue(responseDeferred.promise)
    const playback = createPlayback()
    const primary = new OpenAICompatibleTtsProvider(
      settings.service,
      transport.transport,
      new MemoryTtsCache(),
      playback.playback,
    )
    const fallbackSpeak = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const fallback: TTSProvider = {
      id: 'system-tts',
      capabilities: {
        language: true,
        voice: false,
        rate: true,
        pitch: true,
        style: false,
      },
      isAvailable: () => true,
      speak: fallbackSpeak,
      stop: () => Promise.resolve(),
    }
    const provider = new FallbackTTSProvider(primary, fallback)

    const speaking = provider.speak({ text: 'A delayed question' })
    await vi.waitFor(() => {
      expect(transport.postJsonForBinary).toHaveBeenCalledOnce()
    })
    await provider.stop()
    responseDeferred.resolve(
      response(200, new Blob(['late voice'], { type: 'audio/mpeg' })),
    )

    await expect(speaking).resolves.toBeUndefined()
    expect(playback.play).not.toHaveBeenCalled()
    expect(fallbackSpeak).not.toHaveBeenCalled()
  })

  it('does not resurrect fallback playback when stop overlaps initial shutdown', async () => {
    const initialStop = deferred<void>()
    let primaryStopCalls = 0
    const primarySpeak = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const primary: TTSProvider = {
      id: 'delayed-primary',
      capabilities: {
        language: true,
        voice: true,
        rate: true,
        pitch: false,
        style: false,
      },
      isAvailable: () => true,
      speak: primarySpeak,
      stop: vi.fn(() => {
        primaryStopCalls += 1
        return primaryStopCalls === 1
          ? initialStop.promise
          : Promise.resolve()
      }),
    }
    const fallbackSpeak = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const fallback: TTSProvider = {
      id: 'system-tts',
      capabilities: primary.capabilities,
      isAvailable: () => true,
      speak: fallbackSpeak,
      stop: () => Promise.resolve(),
    }
    const provider = new FallbackTTSProvider(primary, fallback)

    const speaking = provider.speak({ text: 'Question' })
    const stopping = provider.stop()
    initialStop.resolve()

    await Promise.all([speaking, stopping])
    expect(primarySpeak).not.toHaveBeenCalled()
    expect(fallbackSpeak).not.toHaveBeenCalled()
  })

  it('remains compatible with System TTS fallback after a Voice AI failure', async () => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    transport.postJsonForBinary.mockResolvedValue(
      response(401, new Blob(['unauthorized'])),
    )
    const playback = createPlayback()
    const primary = new OpenAICompatibleTtsProvider(
      settings.service,
      transport.transport,
      new MemoryTtsCache(),
      playback.playback,
    )
    const fallbackSpeak = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const fallback: TTSProvider = {
      id: 'system-tts',
      capabilities: {
        language: true,
        voice: false,
        rate: true,
        pitch: true,
        style: false,
      },
      isAvailable: () => true,
      speak: fallbackSpeak,
      stop: () => Promise.resolve(),
    }
    const provider = new FallbackTTSProvider(primary, fallback)

    await expect(provider.speak({ text: 'Question' })).resolves.toBeUndefined()

    expect(fallbackSpeak).toHaveBeenCalledWith({ text: 'Question' })
  })
})
