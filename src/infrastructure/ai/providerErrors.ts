export type ApiProviderErrorCode =
  | 'not-configured'
  | 'not-found'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'invalid-response'
  | 'server'
  | 'request-failed'

export class ApiProviderError extends Error {
  constructor(
    readonly code: ApiProviderErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly details: {
      status?: number
      backendCode?: string
    } = {},
  ) {
    super(message)
    this.name = 'ApiProviderError'
  }

  get status(): number | undefined {
    return this.details.status
  }

  get backendCode(): string | undefined {
    return this.details.backendCode
  }
}

export async function mapTransportFailure<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ApiProviderError) {
      throw error
    }
    if (
      error instanceof DOMException &&
      error.name.toLowerCase() === 'aborterror'
    ) {
      throw new ApiProviderError('timeout', 'API 请求超时，请重试。', true)
    }
    throw new ApiProviderError('network', '网络连接失败，请检查网络后重试。', true)
  }
}
