import { vi } from 'vitest'
import type {
  ApiTransport,
  ApiTransportResponse,
} from '../../infrastructure/ai/apiTransport'

export interface ApiTransportFake {
  transport: ApiTransport
  postJson: ReturnType<typeof vi.fn<ApiTransport['postJson']>>
  postJsonForBinary: ReturnType<
    typeof vi.fn<ApiTransport['postJsonForBinary']>
  >
  postMultipart: ReturnType<typeof vi.fn<ApiTransport['postMultipart']>>
}

export function createApiTransportFake(): ApiTransportFake {
  const postJson = vi.fn<ApiTransport['postJson']>(() =>
    Promise.resolve(response(200, null)),
  )
  const postJsonForBinary = vi.fn<ApiTransport['postJsonForBinary']>(() =>
    Promise.resolve(
      response(200, new Blob(['synthetic speech'], { type: 'audio/mpeg' })),
    ),
  )
  const postMultipart = vi.fn<ApiTransport['postMultipart']>(() =>
    Promise.resolve(response(200, { text: 'synthetic transcript' })),
  )

  return {
    transport: { postJson, postJsonForBinary, postMultipart },
    postJson,
    postJsonForBinary,
    postMultipart,
  }
}

export function response<T>(
  status: number,
  data: T,
): ApiTransportResponse<T> {
  return { status, data, headers: {} }
}
