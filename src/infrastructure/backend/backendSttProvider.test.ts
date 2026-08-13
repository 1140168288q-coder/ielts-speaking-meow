import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeFormData } from '../../test/fixtures/fakeFormData'
import { BackendClient } from './backendClient'
import { BackendSttProvider } from './backendSttProvider'

beforeEach(() => {
  installFakeFormData()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function createProvider(
  responseBody: unknown,
  status = 200,
): {
  provider: BackendSttProvider
  toWav: ReturnType<typeof vi.fn>
  fetch: ReturnType<typeof vi.fn>
} {
  const toWav = vi.fn().mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }))
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  const client = new BackendClient({
    baseUrl: 'http://backend.test',
    isNative: () => false,
    fetch: fetch,
  })
  return { provider: new BackendSttProvider(client, toWav), toWav, fetch }
}

describe('BackendSttProvider', () => {
  it('converts the recording to WAV before upload', async () => {
    const { provider, toWav } = createProvider({ text: 'I like reading.' })
    const text = await provider.transcribe({
      audio: new Blob(['webm'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
      fileName: 'attempt-1.webm',
      language: 'en',
    })
    expect(text).toBe('I like reading.')
    expect(toWav).toHaveBeenCalledTimes(1)
  })

  it('uploads the wav file and forwards the language field', async () => {
    const { provider, fetch } = createProvider({ text: 'Hello.' })
    await provider.transcribe({
      audio: new Blob(['x'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
      fileName: 'attempt-1.webm',
      language: 'en',
    })
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const formData = init.body as { get(key: string): unknown }
    expect(formData.get('language')).toBe('en')
    const file = formData.get('file')
    expect(file).toBeInstanceOf(Blob)
    expect((file as Blob).type).toBe('audio/wav')
  })

  it('rejects empty transcript responses', async () => {
    const { provider } = createProvider({ text: '   ' })
    await expect(
      provider.transcribe({
        audio: new Blob(['x']),
        mimeType: 'audio/webm',
        fileName: 'a.webm',
      }),
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('is always configured (credentials live server-side)', () => {
    const { provider } = createProvider({})
    expect(provider.isConfigured()).toBe(true)
  })
})
