import {
  Capacitor,
  CapacitorHttp,
  type HttpOptions,
  type HttpResponse,
} from '@capacitor/core'
import { z } from 'zod'
import {
  CloudAuthError,
  cloudAccountTokenSchema,
  cloudAccountSessionSchema,
  cloudAuthResponseSchema,
  cloudCredentialsSchema,
  cloudPasswordResetSchema,
  type AuthTokenStore,
  type CloudAccountSession,
  type CloudAuthErrorCode,
  type CloudAuthGateway,
  type CloudCredentials,
} from '../../domain/cloudAccount'
import { resolveBackendUrl } from './backendConfig'

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
  }),
})

export interface CloudAuthClientOptions {
  baseUrl?: string
  getBaseUrl?: () => string
  isNative?: () => boolean
  fetch?: typeof fetch
  nativeRequest?: (options: HttpOptions) => Promise<HttpResponse>
  timeoutMs?: number
}

/**
 * 仅供浏览器开发使用。Android 构建必须注入由 Keystore 等安全能力支持的
 * AuthTokenStore，不能把会话 token 落到 localStorage 或普通 Preferences。
 */
export class BrowserSessionAuthTokenStore implements AuthTokenStore {
  constructor(
    private readonly storage: Storage = globalThis.sessionStorage,
    private readonly key = 'ielts-meow.cloud-auth-token',
  ) {}

  async getToken(): Promise<string | null> {
    await Promise.resolve()
    return this.storage.getItem(this.key)
  }

  async setToken(token: string): Promise<void> {
    await Promise.resolve()
    this.storage.setItem(this.key, token)
  }

  async clearToken(): Promise<void> {
    await Promise.resolve()
    this.storage.removeItem(this.key)
  }
}

export class CloudAuthClient implements CloudAuthGateway {
  private readonly baseUrl: string
  private readonly getBaseUrl: () => string
  private readonly isNative: () => boolean
  private readonly fetchImplementation: typeof fetch
  private readonly nativeRequest: (options: HttpOptions) => Promise<HttpResponse>
  private readonly timeoutMs: number

  constructor(options: CloudAuthClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveBackendUrl()).replace(/\/+$/, '')
    this.getBaseUrl = options.getBaseUrl ?? (() => '')
    this.isNative = options.isNative ?? (() => Capacitor.isNativePlatform())
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.nativeRequest =
      options.nativeRequest ?? ((request) => CapacitorHttp.request(request))
    this.timeoutMs = options.timeoutMs ?? 12_000
  }

  async register(
    credentials: CloudCredentials,
    tokenStore: AuthTokenStore,
  ): Promise<CloudAccountSession> {
    return this.authenticate('/v1/auth/register', credentials, tokenStore)
  }

  async login(
    credentials: CloudCredentials,
    tokenStore: AuthTokenStore,
  ): Promise<CloudAccountSession> {
    return this.authenticate('/v1/auth/login', credentials, tokenStore)
  }

  async restoreSession(
    tokenStore: AuthTokenStore,
  ): Promise<CloudAccountSession | null> {
    const token = await tokenStore.getToken()
    if (!token) return null

    const payload = await this.request('/v1/auth/session', 'GET', token, undefined, tokenStore)
    return parsePayload(cloudAccountSessionSchema, payload)
  }

  async logout(tokenStore: AuthTokenStore): Promise<void> {
    const token = await tokenStore.getToken()
    if (!token) return

    try {
      await this.request('/v1/auth/logout', 'POST', token, undefined, tokenStore)
    } finally {
      await tokenStore.clearToken()
    }
  }

  async requestEmailVerification(tokenStore: AuthTokenStore): Promise<void> {
    const token = await requireStoredToken(tokenStore)
    await this.request(
      '/v1/auth/request-email-verification',
      'POST',
      token,
      undefined,
      tokenStore,
    )
  }

  async confirmEmailVerification(
    rawToken: string,
    tokenStore: AuthTokenStore,
  ): Promise<CloudAccountSession | null> {
    const hadSession = Boolean(await tokenStore.getToken())
    const verificationToken = cloudAccountTokenSchema.safeParse(rawToken)
    if (!verificationToken.success) {
      throw new CloudAuthError('invalid-input', '请输入邮件中的完整验证凭证。')
    }
    await this.request(
      '/v1/auth/confirm-email-verification',
      'POST',
      null,
      { token: verificationToken.data },
      tokenStore,
    )
    if (!hadSession) return null
    try {
      return await this.restoreSession(tokenStore)
    } catch (error) {
      if (error instanceof CloudAuthError && error.code === 'session-expired') {
        return null
      }
      throw error
    }
  }

  async requestPasswordReset(
    rawEmail: string,
    tokenStore: AuthTokenStore,
  ): Promise<void> {
    const email = z.email().safeParse(rawEmail.trim().toLowerCase())
    if (!email.success) {
      throw new CloudAuthError('invalid-input', '请输入有效邮箱。')
    }
    await this.request(
      '/v1/auth/password-reset/request',
      'POST',
      null,
      { email: email.data },
      tokenStore,
    )
  }

  async confirmPasswordReset(
    rawToken: string,
    password: string,
    tokenStore: AuthTokenStore,
  ): Promise<void> {
    const input = cloudPasswordResetSchema.safeParse({
      token: rawToken,
      newPassword: password,
    })
    if (!input.success) {
      throw new CloudAuthError(
        'invalid-input',
        '请输入完整重置凭证，新密码需为 8–128 个字符。',
      )
    }
    await this.request(
      '/v1/auth/password-reset/confirm',
      'POST',
      null,
      input.data,
      tokenStore,
    )
    await tokenStore.clearToken()
  }

  private async authenticate(
    path: '/v1/auth/register' | '/v1/auth/login',
    credentials: CloudCredentials,
    tokenStore: AuthTokenStore,
  ): Promise<CloudAccountSession> {
    const normalized = cloudCredentialsSchema.safeParse({
      email: credentials.email.trim().toLowerCase(),
      password: credentials.password,
    })
    if (!normalized.success) {
      throw new CloudAuthError(
        'invalid-input',
        '请输入有效邮箱，密码需为 8–128 个字符。',
      )
    }

    const payload = await this.request(path, 'POST', null, normalized.data, tokenStore)
    const auth = parsePayload(cloudAuthResponseSchema, payload)
    await tokenStore.setToken(auth.accessToken)
    return { expiresAt: auth.expiresAt, user: auth.user }
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    token: string | null,
    body: unknown,
    tokenStore: AuthTokenStore,
  ): Promise<unknown> {
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
        return await this.readResponse(response.status, response.data, tokenStore)
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
        return await this.readResponse(response.status, payload, tokenStore)
      } finally {
        globalThis.clearTimeout(timeout)
      }
    } catch (error) {
      if (error instanceof CloudAuthError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new CloudAuthError('timeout', '连接云端超时，请稍后重试。', {
          retryable: true,
        })
      }
      throw new CloudAuthError('network', '暂时无法连接云端，请检查网络后重试。', {
        retryable: true,
      })
    }
  }

  private async readResponse(
    status: number,
    payload: unknown,
    tokenStore: AuthTokenStore,
  ): Promise<unknown> {
    if (status >= 200 && status < 300) return payload

    const envelope = errorEnvelopeSchema.safeParse(readJson(payload))
    const backendCode = envelope.success ? envelope.data.error.code : null
    const backendMessage = envelope.success ? envelope.data.error.message : null

    if (status === 401 && backendCode === 'invalid-session') {
      await tokenStore.clearToken()
      throw new CloudAuthError(
        'session-expired',
        backendMessage ?? '登录状态已过期，请重新登录。',
        { status },
      )
    }

    const mapped = mapBackendCode(status, backendCode)
    throw new CloudAuthError(mapped.code, backendMessage ?? mapped.message, {
      retryable: mapped.retryable,
      status,
    })
  }

  private buildUrl(path: string): string {
    const dynamic = this.getBaseUrl().trim()
    const baseUrl = (dynamic || this.baseUrl).replace(/\/+$/, '')
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  }
}

function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new CloudAuthError('invalid-response', '云端账号返回了无法识别的数据。', {
      retryable: true,
    })
  }
  return parsed.data
}

function requestHeaders(token: string | null, hasJsonBody: boolean): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function mapBackendCode(
  status: number,
  backendCode: string | null,
): { code: CloudAuthErrorCode; message: string; retryable: boolean } {
  if (backendCode === 'email-already-registered') {
    return { code: 'email-already-registered', message: '该邮箱已经注册。', retryable: false }
  }
  if (backendCode === 'invalid-credentials') {
    return { code: 'invalid-credentials', message: '邮箱或密码不正确。', retryable: false }
  }
  if (
    backendCode === 'invalid-account-token' ||
    backendCode === 'invalid-verification-token' ||
    backendCode === 'invalid-reset-token'
  ) {
    return { code: 'invalid-account-token', message: '验证凭证无效或已过期。', retryable: false }
  }
  if (
    backendCode === 'email-delivery-unavailable' ||
    backendCode === 'email-not-configured' ||
    backendCode === 'not-configured' ||
    backendCode === 'provider-error'
  ) {
    return {
      code: 'email-delivery-unavailable',
      message: '邮件服务尚未配置，请联系服务维护者。',
      retryable: true,
    }
  }
  if (backendCode === 'rate-limited' || status === 429) {
    return { code: 'rate-limited', message: '操作太频繁，请稍后重试。', retryable: true }
  }
  if (backendCode === 'invalid-request' || status === 400) {
    return { code: 'invalid-input', message: '邮箱或密码格式不正确。', retryable: false }
  }
  if (status >= 500) {
    return { code: 'server', message: '云端账号服务暂时不可用。', retryable: true }
  }
  return { code: 'request-failed', message: `云端账号请求失败（${status}）。`, retryable: false }
}

async function requireStoredToken(tokenStore: AuthTokenStore): Promise<string> {
  const token = await tokenStore.getToken()
  if (!token) {
    throw new CloudAuthError('session-expired', '请先重新登录云账号。')
  }
  return token
}
