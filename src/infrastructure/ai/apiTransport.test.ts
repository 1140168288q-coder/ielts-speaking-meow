import type { HttpOptions, HttpResponse } from '@capacitor/core'
import { CapacitorApiTransport } from './apiTransport'

describe('CapacitorApiTransport multipart requests', () => {
  it('uses Capacitor formData with an explicit multipart type and base64File on Android', async () => {
    const nativeRequest = vi.fn<
      (options: HttpOptions) => Promise<HttpResponse>
    >(() =>
      Promise.resolve({
        status: 200,
        data: { text: 'um I I enjoy reading' },
        headers: { 'content-type': 'application/json' },
        url: 'https://stt.example.test/v1/audio/transcriptions',
      }),
    )
    const fetchImplementation = vi.fn<typeof fetch>()
    const transport = new CapacitorApiTransport({
      isNative: () => true,
      nativeRequest,
      fetch: fetchImplementation,
    })
    const secret = runtimeSecret()
    const audio = new File(['original audio bytes'], 'attempt-1.webm', {
      type: 'audio/webm',
    })

    const response = await transport.postMultipart(
      'https://stt.example.test/v1/audio/transcriptions',
      secret,
      { model: 'stt-model', language: 'en', response_format: 'json' },
      {
        fieldName: 'file',
        fileName: 'attempt-1.webm',
        mimeType: 'audio/webm',
        data: audio,
      },
      90_000,
    )

    expect(response).toMatchObject({
      status: 200,
      data: { text: 'um I I enjoy reading' },
    })
    expect(nativeRequest).toHaveBeenCalledOnce()
    expect(fetchImplementation).not.toHaveBeenCalled()
    const request = nativeRequest.mock.calls[0]?.[0]
    expect(request).toBeDefined()
    expect(request?.headers?.['Content-Type']).toBe('multipart/form-data')
    expect(request?.headers?.Authorization === `Bearer ${secret}`).toBe(true)
    expect(request).toMatchObject({
      method: 'POST',
      dataType: 'formData',
      responseType: 'json',
      connectTimeout: 90_000,
      readTimeout: 90_000,
    })
    const parts = request?.data as Array<Record<string, unknown>>
    expect(parts).toEqual(
      expect.arrayContaining([
        { type: 'string', key: 'model', value: 'stt-model' },
        { type: 'string', key: 'language', value: 'en' },
        { type: 'string', key: 'response_format', value: 'json' },
        {
          type: 'base64File',
          key: 'file',
          value: globalThis.btoa('original audio bytes'),
          fileName: 'attempt-1.webm',
          contentType: 'audio/webm',
        },
      ]),
    )
  })

  it('lets the browser generate its multipart boundary instead of forcing a header', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ text: 'transcript' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const transport = new CapacitorApiTransport({
      isNative: () => false,
      fetch: fetchImplementation,
      nativeRequest: vi.fn(),
    })

    await transport.postMultipart(
      'https://stt.example.test/v1/audio/transcriptions',
      runtimeSecret(),
      { model: 'stt-model' },
      {
        fieldName: 'file',
        fileName: 'attempt.webm',
        mimeType: 'audio/webm',
        data: new File(['audio'], 'attempt.webm', { type: 'audio/webm' }),
      },
      1_000,
    )

    const init = fetchImplementation.mock.calls[0]?.[1]
    expect(init?.body).toBeInstanceOf(FormData)
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false)
  })
})

function runtimeSecret(): string {
  return `transport-${globalThis.crypto.randomUUID()}`
}
