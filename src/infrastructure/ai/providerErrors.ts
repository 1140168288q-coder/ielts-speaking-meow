export type ApiProviderErrorCode =
  | 'not-configured'
  | 'unauthorized'
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
  ) {
    super(message)
    this.name = 'ApiProviderError'
  }
}

export function assertSuccessfulStatus(status: number): void {
  if (status >= 200 && status < 300) {
    return
  }
  if (status === 401 || status === 403) {
    throw new ApiProviderError('unauthorized', 'API Key 无效或没有权限。', false)
  }
  if (status === 404) {
    throw new ApiProviderError('not-found', 'API Endpoint 或模型不存在。', false)
  }
  if (status === 429) {
    throw new ApiProviderError('rate-limited', 'API 请求过于频繁，请稍后重试。', true)
  }
  if (status >= 500) {
    throw new ApiProviderError('server', 'API 服务暂时不可用，请稍后重试。', true)
  }
  throw new ApiProviderError('request-failed', `API 请求失败（${status}）。`, false)
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
