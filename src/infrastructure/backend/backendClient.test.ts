import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeFormData } from '../../test/fixtures/fakeFormData'
import { BackendClient } from './backendClient'

afterEach(() => {
  vi.unstubAllGlobals()
})

function createClient(fetch: typeof globalThis.fetch): BackendClient {
  return new BackendClient({
    baseUrl: 'http://backend.test',
    isNative: () => false,
    fetch,
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('BackendClient (web transport)', () => {
  it('parses /health response', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({ status: 'ok', providers: { deepseek: true } }),
    )
    const client = createClient(fetch)
    const health = await client.getHealth()
    expect(health.status).toBe('ok')
    expect(fetch).toHaveBeenCalledWith(
      'http://backend.test/health',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('maps backend error envelopes to provider error codes', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: { code: 'not-configured', message: '服务端未配置。' } },
        503,
      ),
    )
    const client = createClient(fetch)
    await expect(client.postJson('/v1/tts', { text: 'hi' }, 5_000))
      .rejects.toMatchObject({ code: 'not-configured' })
  })

  it('maps rate-limited envelopes to retryable errors', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'rate-limited', message: '太频繁' } }, 429),
    )
    const client = createClient(fetch)
    await expect(client.postJson('/v1/feedback', {}, 5_000))
      .rejects.toMatchObject({ code: 'rate-limited', retryable: true })
  })

  it('maps transport failures to network errors', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const client = createClient(fetch)
    await expect(client.postJson('/v1/feedback', {}, 5_000))
      .rejects.toMatchObject({ code: 'network', retryable: true })
  })

  it('returns binary audio for postBinary', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    )
    const client = createClient(fetch)
    const audio = await client.postBinary('/v1/tts', { text: 'hi' }, 5_000)
    expect(audio.type).toBe('audio/mpeg')
    expect(await audio.arrayBuffer()).toHaveProperty('byteLength', 3)
  })

  it('sends multipart fields and file for postMultipartJson', async () => {
    installFakeFormData()
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ text: 'hello' }))
    const client = createClient(fetch)
    await client.postMultipartJson(
      '/v1/stt',
      { language: 'en' },
      {
        fieldName: 'file',
        fileName: 'audio.wav',
        mimeType: 'audio/wav',
        data: new Blob(['wav'], { type: 'audio/wav' }),
      },
      5_000,
    )
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const formData = init.body as { get(key: string): unknown }
    expect(formData.get('language')).toBe('en')
    expect(formData.get('file')).toBeInstanceOf(Blob)
  })
})
