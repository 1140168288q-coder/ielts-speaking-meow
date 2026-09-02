import {
  Capacitor,
  CapacitorHttp,
  type HttpOptions,
  type HttpResponse,
} from '@capacitor/core'
import {
  ApiProviderError,
  mapTransportFailure,
} from '../ai/providerErrors'
import { resolveBackendUrl } from './backendConfig'
import { z } from 'zod'

const providerVerificationSchema = z
  .object({
    status: z.enum(['unverified', 'verified', 'failed']),
    checkedAt: z.iso.datetime({ offset: true }).nullable(),
    latencyMs: z.number().nullable(),
    lastError: z.string().nullable(),
    lastResult: z.string().nullable(),
  })
  .passthrough()

const providerRequestSchema = z
  .object({
    status: z.enum(['never', 'succeeded', 'failed']),
    checkedAt: z.iso.datetime({ offset: true }).nullable(),
    latencyMs: z.number().nullable(),
    lastError: z.string().nullable(),
    lastResult: z.string().nullable(),
    failureStage: z.string().nullable().optional(),
    finishReason: z.string().nullable().optional(),
    contentLength: z.number().nullable().optional(),
    usage: z.record(z.string(), z.number()).nullable().optional(),
    fieldPath: z.string().nullable().optional(),
  })
  .passthrough()

const providerHealthSchema = z
  .object({
    kind: z.string().optional(),
    configured: z.boolean(),
    model: z.string().optional(),
    resourceId: z.string().optional(),
    speaker: z
      .object({ id: z.string(), name: z.string().nullable() })
      .optional(),
    verification: providerVerificationSchema.optional(),
    lastRequest: providerRequestSchema.optional(),
  })
  .passthrough()

const backendHealthSchema = z
  .object({
    status: z.literal('ok'),
    version: z.string().trim().min(1).optional(),
    providers: z.record(z.string(), providerHealthSchema),
  })
  .passthrough()

export type BackendHealth = z.infer<typeof backendHealthSchema>
export type BackendProviderHealth = z.infer<typeof providerHealthSchema>
export type BackendProviderVerification = z.infer<typeof providerVerificationSchema>
export type BackendProviderRequest = z.infer<typeof providerRequestSchema>

interface BackendErrorEnvelope {
  error?: {
    code?: string
    message?: string
  }
}

export interface BackendClientOptions {
  baseUrl?: string
  /**
   * 动态 Backend 地址(运行时设置)。返回空字符串时回退到 baseUrl 或
   * 构建期默认值。
   */
  getBaseUrl?: () => string
  isNative?: () => boolean
  fetch?: typeof fetch
  nativeRequest?: (options: HttpOptions) => Promise<HttpResponse>
  getAccessToken?: () => Promise<string | null>
  onUnauthorized?: () => void | Promise<void>
}

/**
 * 与自建 Backend 通信的唯一入口。Android 端走 CapacitorHttp(避免 WebView
 * CORS),浏览器开发环境走 fetch。客户端不携带任何第三方 API Key。
 */
export class BackendClient {
  private readonly baseUrl: string
  private readonly getBaseUrl: () => string
  private readonly isNative: () => boolean
  private readonly fetchImplementation: typeof fetch
  private readonly nativeRequest: (options: HttpOptions) => Promise<HttpResponse>
  private readonly getAccessToken: () => Promise<string | null>
  private readonly onUnauthorized: () => void | Promise<void>

  constructor(options: BackendClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveBackendUrl()).replace(/\/+$/, '')
    this.getBaseUrl = options.getBaseUrl ?? (() => '')
    this.isNative = options.isNative ?? (() => Capacitor.isNativePlatform())
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.nativeRequest =
      options.nativeRequest ?? ((request) => CapacitorHttp.request(request))
    this.getAccessToken = options.getAccessToken ?? (() => Promise.resolve(null))
    this.onUnauthorized = options.onUnauthorized ?? (() => undefined)
  }

  get url(): string {
    return this.resolveBaseUrl()
  }

  async getHealth(timeoutMs = 8_000): Promise<BackendHealth> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await mapTransportFailure(async () => {
          const payload = await this.getJson<unknown>('/health', timeoutMs)
          const parsed = backendHealthSchema.safeParse(payload)
          if (!parsed.success) {
            throw new ApiProviderError(
              'invalid-response',
              '云端健康检查返回了无法识别的数据。',
              true,
            )
          }
          return parsed.data
        })
      } catch (error) {
        const shouldRetry =
          attempt === 0 &&
          error instanceof ApiProviderError &&
          ['network', 'timeout', 'server'].includes(error.code)
        if (!shouldRetry) throw error
        await delay(200)
      }
    }
    throw new ApiProviderError('network', '云端健康检查失败。', true)
  }

  /**
   * 请求 Backend 对上游做一次真实小规模验证(DeepSeek JSON 补全、TTS
   * 合成一句 "Hello."),返回各供应商的最新验证状态。
   */
  async verifyProviders(
    timeoutMs = 45_000,
  ): Promise<Record<string, BackendProviderVerification>> {
    const payload = await this.postJson<unknown>(
      '/health/verify',
      {},
      timeoutMs,
    )
    const envelope = z
      .object({ providers: z.record(z.string(), z.record(z.string(), z.unknown())) })
      .passthrough()
      .safeParse(payload)
    if (!envelope.success) {
      throw new ApiProviderError(
        'invalid-response',
        '云端验证返回了无法识别的数据。',
        true,
      )
    }
    const verified: Record<string, BackendProviderVerification> = {}
    for (const [name, raw] of Object.entries(envelope.data.providers)) {
      const parsed = providerVerificationSchema.safeParse(raw)
      if (parsed.success) {
        verified[name] = parsed.data
      }
    }
    return verified
  }

  async postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    return mapTransportFailure(() =>
      this.requestJson<T>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        nativeBody: body,
        nativeResponseType: 'json',
        timeoutMs,
      }),
    )
  }

  async postBinary(path: string, body: unknown, timeoutMs: number): Promise<Blob> {
    return mapTransportFailure(async () => {
      if (this.isNative()) {
        const response = await this.nativeResponse({
          url: this.buildUrl(path),
          method: 'POST',
          headers: await this.withRequestHeaders({ 'Content-Type': 'application/json' }),
          data: body,
          responseType: 'arraybuffer',
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
        })
        this.assertSuccess(response.status, response.data)
        const mimeType = findHeader(response.headers, 'content-type') ?? 'audio/mpeg'
        return base64ToBlob(String(response.data), mimeType)
      }
      return this.fetchRequest(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, timeoutMs, async (response) => {
        if (response.status < 200 || response.status >= 300) {
          const envelope: unknown = await response.json().catch(() => null)
          this.assertSuccess(response.status, envelope)
        }
        return response.blob()
      })
    })
  }

  private async getJson<T>(path: string, timeoutMs: number): Promise<T> {
    if (this.isNative()) {
      const response = await this.nativeResponse({
        url: this.buildUrl(path),
        method: 'GET',
        headers: await this.withRequestHeaders({}),
        responseType: 'json',
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      })
      this.assertSuccess(response.status, response.data)
      return response.data as T
    }
    return this.fetchRequest(path, { method: 'GET' }, timeoutMs, async (response) => {
      const parsed: unknown = await response.json().catch(() => null)
      this.assertSuccess(response.status, parsed)
      return parsed as T
    })
  }

  private async requestJson<T>(
    path: string,
    options: {
      method: 'POST'
      headers: Record<string, string>
      body?: BodyInit
      nativeBody: unknown
      nativeDataType?: 'formData'
      nativeResponseType: 'json'
      timeoutMs: number
    },
  ): Promise<T> {
    if (this.isNative()) {
      const response = await this.nativeResponse({
        url: this.buildUrl(path),
        method: options.method,
        headers: await this.withRequestHeaders(options.headers),
        data: options.nativeBody,
        ...(options.nativeDataType !== undefined
          ? { dataType: options.nativeDataType }
          : {}),
        responseType: options.nativeResponseType,
        connectTimeout: options.timeoutMs,
        readTimeout: options.timeoutMs,
      })
      this.assertSuccess(response.status, response.data)
      return response.data as T
    }
    return this.fetchRequest(
      path,
      {
        method: options.method,
        headers: options.headers,
        ...(options.body === undefined ? {} : { body: options.body }),
      },
      options.timeoutMs,
      async (response) => {
        const parsed: unknown = await response.json().catch(() => null)
        this.assertSuccess(response.status, parsed)
        return parsed as T
      },
    )
  }

  private async fetchRequest<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const headers = new Headers(init.headers)
      headers.set('X-Request-ID', createRequestId())
      const token = await this.getAccessToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const response = await this.fetchImplementation(this.buildUrl(path), {
        ...init,
        headers,
        signal: controller.signal,
      })
      return await read(response)
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }

  private resolveBaseUrl(): string {
    const dynamic = this.getBaseUrl().trim()
    return (dynamic.length > 0 ? dynamic : this.baseUrl).replace(/\/+$/, '')
  }

  private buildUrl(path: string): string {
    return `${this.resolveBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
  }

  private async withRequestHeaders(headers: Record<string, string>): Promise<Record<string, string>> {
    const token = await this.getAccessToken()
    return {
      ...headers,
      'X-Request-ID': createRequestId(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }

  private async nativeResponse(options: HttpOptions): Promise<HttpResponse> {
    try {
      return await this.nativeRequest(options)
    } catch (error) {
      const failure = readNativeHttpFailure(error)
      if (failure !== null) {
        this.assertSuccess(failure.status, failure.data)
      }
      throw error
    }
  }

  private assertSuccess(status: number, data: unknown): void {
    if (status >= 200 && status < 300) {
      return
    }
    if (status === 401) {
      void this.onUnauthorized()
      throw new ApiProviderError(
        'request-failed',
        '登录状态已过期，请重新登录后使用云端服务。',
        false,
      )
    }
    const envelope = readErrorEnvelope(data) as BackendErrorEnvelope | null
    const code = envelope?.error?.code
    const message = envelope?.error?.message
    const detail = `HTTP ${status}${code ? `/${code}` : ''}`
    const messageWithDetail = message
      ? `${message}（${detail}）`
      : `云端请求失败（${detail}）。`
    const errorDetails = {
      status,
      ...(code ? { backendCode: code } : {}),
    }
    if (code === 'not-configured') {
      throw new ApiProviderError(
        'not-configured',
        messageWithDetail,
        false,
        errorDetails,
      )
    }
    if (code === 'rate-limited') {
      throw new ApiProviderError(
        'rate-limited',
        messageWithDetail,
        true,
        errorDetails,
      )
    }
    if (code === 'upstream-timeout') {
      throw new ApiProviderError(
        'timeout',
        messageWithDetail,
        true,
        errorDetails,
      )
    }
    if (code === 'provider-error' || status >= 500) {
      throw new ApiProviderError(
        'server',
        messageWithDetail,
        true,
        errorDetails,
      )
    }
    throw new ApiProviderError(
      'request-failed',
      messageWithDetail,
      status >= 429,
      errorDetails,
    )
  }
}

function readErrorEnvelope(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown
    } catch {
      return null
    }
  }
  if (typeof data === 'object' && data !== null) {
    return data
  }
  return null
}

function readNativeHttpFailure(
  error: unknown,
): { status: number; data: unknown } | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }
  const root = error as Record<string, unknown>
  const nested =
    typeof root.response === 'object' && root.response !== null
      ? (root.response as Record<string, unknown>)
      : null
  const rawStatus = root.status ?? nested?.status
  if (typeof rawStatus !== 'number' || !Number.isFinite(rawStatus)) {
    return null
  }
  const data = root.data ?? root.body ?? nested?.data ?? nested?.body ?? null
  return { status: rawStatus, data }
}

function findHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const expected = name.toLowerCase()
  const entry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === expected,
  )
  return entry?.[1]
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const cleanBase64 = base64.includes(',') ? (base64.split(',').pop() ?? '') : base64
  const binary = globalThis.atob(cleanBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `client-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
}
