import {
  Capacitor,
  CapacitorHttp,
  type HttpOptions,
  type HttpResponse,
} from '@capacitor/core'
import { z } from 'zod'
import {
  CloudSyncError,
  syncPullResponseSchema,
  syncPushItemSchema,
  syncPushResponseSchema,
  type CloudSyncGateway,
  type SyncPullResponse,
  type SyncPushItem,
  type SyncPushResponse,
} from '../../domain/cloudSync'
import { resolveBackendUrl } from './backendConfig'

const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string().trim().min(1),
        message: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict()

export interface CloudSyncClientOptions {
  baseUrl?: string
  getBaseUrl?: () => string
  getAccessToken: () => Promise<string | null> | string | null
  onUnauthorized?: () => Promise<void> | void
  isNative?: () => boolean
  fetch?: typeof fetch
  nativeRequest?: (options: HttpOptions) => Promise<HttpResponse>
  timeoutMs?: number
}

export class CloudSyncClient implements CloudSyncGateway {
  private readonly baseUrl: string
  private readonly getBaseUrl: () => string
  private readonly getAccessToken: CloudSyncClientOptions['getAccessToken']
  private readonly onUnauthorized: () => Promise<void> | void
  private readonly isNative: () => boolean
  private readonly fetchImplementation: typeof fetch
  private readonly nativeRequest: (options: HttpOptions) => Promise<HttpResponse>
  private readonly timeoutMs: number

  constructor(options: CloudSyncClientOptions) {
    this.baseUrl = (options.baseUrl ?? resolveBackendUrl()).replace(/\/+$/, '')
    this.getBaseUrl = options.getBaseUrl ?? (() => '')
    this.getAccessToken = options.getAccessToken
    this.onUnauthorized = options.onUnauthorized ?? (() => undefined)
    this.isNative = options.isNative ?? (() => Capacitor.isNativePlatform())
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.nativeRequest =
      options.nativeRequest ?? ((request) => CapacitorHttp.request(request))
    this.timeoutMs = options.timeoutMs ?? 12_000
  }

  async push(items: SyncPushItem[]): Promise<SyncPushResponse> {
    const parsedItems = z.array(syncPushItemSchema).min(1).max(100).parse(items)
    const payload = await this.request('/v1/sync/push', 'POST', {
      items: parsedItems,
    })
    return parseResponse(syncPushResponseSchema, payload)
  }

  async pull(cursor: number, limit = 200): Promise<SyncPullResponse> {
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new CloudSyncError('invalid-input', '同步游标必须是非负整数。')
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new CloudSyncError('invalid-input', '同步分页大小必须在 1–500 之间。')
    }
    const payload = await this.request(
      `/v1/sync/pull?cursor=${cursor}&limit=${limit}`,
      'GET',
    )
    return parseResponse(syncPullResponseSchema, payload)
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<unknown> {
    const token = await this.getAccessToken()
    if (token === null || token.trim().length === 0) {
      throw new CloudSyncError('unauthenticated', '请先登录后再同步。', {
        status: 401,
      })
    }

    try {
      if (this.isNative()) {
        const response = await this.nativeRequest({
          url: this.buildUrl(path),
          method,
          headers: requestHeaders(token, body !== undefined),
          ...(body === undefined ? {} : { data: body }),
          responseType: 'json',
          connectTimeout: this.timeoutMs,
          readTimeout: this.timeoutMs,
        })
        return await this.readResponse(response.status, response.data)
      }

      const controller = new AbortController()
      const timeout = globalThis.setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const response = await this.fetchImplementation(this.buildUrl(path), {
          method,
          headers: requestHeaders(token, body !== undefined),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        })
        const payload: unknown = response.status === 204
          ? null
          : await response.json().catch(() => null)
        return await this.readResponse(response.status, payload)
      } finally {
        globalThis.clearTimeout(timeout)
      }
    } catch (error) {
      if (error instanceof CloudSyncError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new CloudSyncError('timeout', '同步请求超时，请稍后重试。', {
          retryable: true,
        })
      }
      throw new CloudSyncError('network', '暂时无法连接云端，本地待同步数据已保留。', {
        retryable: true,
      })
    }
  }

  private async readResponse(status: number, payload: unknown): Promise<unknown> {
    if (status >= 200 && status < 300) return readJson(payload)

    const envelope = errorEnvelopeSchema.safeParse(readJson(payload))
    const message = envelope.success ? envelope.data.error.message : null

    if (status === 401) {
      await this.onUnauthorized()
      throw new CloudSyncError(
        'session-expired',
        message ?? '登录状态已失效，请重新登录。',
        { status },
      )
    }
    if (status >= 500) {
      throw new CloudSyncError('server', message ?? '云端同步服务暂时不可用。', {
        retryable: true,
        status,
      })
    }
    throw new CloudSyncError('request-failed', message ?? '云端拒绝了同步请求。', {
      status,
    })
  }

  private buildUrl(path: string): string {
    const dynamic = this.getBaseUrl().trim()
    const baseUrl = (dynamic || this.baseUrl).replace(/\/+$/, '')
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  }
}

function parseResponse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(readJson(payload))
  if (!parsed.success) {
    throw new CloudSyncError(
      'invalid-response',
      '云端同步返回了无法识别的数据，本地待同步数据已保留。',
      { retryable: true },
    )
  }
  return parsed.data
}

function requestHeaders(token: string, hasJsonBody: boolean): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${token}`,
  }
}

function readJson(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload
  try {
    return JSON.parse(payload) as unknown
  } catch {
    return null
  }
}
