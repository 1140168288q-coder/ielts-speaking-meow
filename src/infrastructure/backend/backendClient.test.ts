import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeBackendHealth } from '../../test/fixtures/backendHealth'
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
  it('parses /health response with provider details', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(makeBackendHealth({ deepseek: true })),
    )
    const client = createClient(fetch)
    const health = await client.getHealth()
    expect(health.status).toBe('ok')
    expect(health.providers.deepseek?.configured).toBe(true)
    expect(fetch).toHaveBeenCalledWith(
      'http://backend.test/health',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('rejects malformed /health responses at the provider boundary', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({ status: 'ok', providers: { deepseek: 'yes' } }),
    )
    const client = createClient(fetch)
    await expect(client.getHealth()).rejects.toMatchObject({
      code: 'invalid-response',
      retryable: true,
    })
  })

  it('posts to /health/verify and returns parsed verification states', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        providers: {
          deepseek: {
            status: 'verified',
            checkedAt: '2026-08-15T08:00:00.000Z',
            latencyMs: 200,
            lastError: null,
            lastResult: 'OK',
          },
          volc_tts: {
            status: 'failed',
            checkedAt: '2026-08-15T08:00:01.000Z',
            latencyMs: null,
            lastError: '火山 TTS:凭证无效(401)。',
            lastResult: null,
          },
        },
      }),
    )
    const client = createClient(fetch)
    const verified = await client.verifyProviders()
    expect(verified.deepseek?.status).toBe('verified')
    expect(verified.volc_tts?.status).toBe('failed')
    expect(fetch).toHaveBeenCalledWith(
      'http://backend.test/health/verify',
      expect.objectContaining({ method: 'POST' }),
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

  it('preserves native HTTP status and backend error details', async () => {
    const nativeRequest = vi.fn().mockRejectedValue({
      status: 502,
      data: {
        error: {
          code: 'provider-error',
          message: 'Text AI 返回内容不完整。',
        },
      },
    })
    const client = new BackendClient({
      baseUrl: 'https://backend.test',
      isNative: () => true,
      nativeRequest,
    })

    const error = await client.postJson('/v1/feedback', {}, 5_000).then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toMatchObject({
      code: 'server',
      status: 502,
      backendCode: 'provider-error',
    })
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('HTTP 502/provider-error')
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

  it('adds the cloud session token to protected requests', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const client = new BackendClient({
      baseUrl: 'http://backend.test',
      isNative: () => false,
      fetch,
      getAccessToken: () => Promise.resolve('cloud-session-token'),
    })

    await client.postJson('/v1/feedback', {}, 5_000)

    const init = fetch.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Bearer cloud-session-token',
    )
  })

  it('clears the local session when a protected request returns 401', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'unauthorized', message: 'expired' } }, 401),
    )
    const onUnauthorized = vi.fn()
    const client = new BackendClient({
      baseUrl: 'http://backend.test',
      isNative: () => false,
      fetch,
      getAccessToken: () => Promise.resolve('expired-token'),
      onUnauthorized,
    })

    await expect(client.postJson('/v1/feedback', {}, 5_000)).rejects.toMatchObject({
      code: 'request-failed',
    })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('uses the dynamic base URL getter when provided', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({ status: 'ok', providers: {} }),
    )
    const client = new BackendClient({
      baseUrl: 'http://fallback.test',
      isNative: () => false,
      fetch,
      getBaseUrl: () => 'http://192.168.1.50:8000',
    })
    await client.getHealth()
    expect(fetch).toHaveBeenCalledWith(
      'http://192.168.1.50:8000/health',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(client.url).toBe('http://192.168.1.50:8000')
  })

})
