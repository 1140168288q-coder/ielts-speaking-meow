import { z } from 'zod'

export const cloudAccountUserSchema = z.object({
  id: z.string().trim().min(1),
  email: z.email(),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
})

export const cloudAccountSessionSchema = z.object({
  expiresAt: z.iso.datetime({ offset: true }),
  user: cloudAccountUserSchema,
})

export const cloudAuthResponseSchema = cloudAccountSessionSchema.extend({
  accessToken: z.string().trim().min(32),
  tokenType: z.literal('Bearer'),
})

export const cloudCredentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
})

export const cloudAccountTokenSchema = z.string().trim().min(32).max(512)

export const cloudPasswordResetSchema = z.object({
  token: cloudAccountTokenSchema,
  newPassword: z.string().min(8).max(128),
})

export type CloudAccountUser = z.infer<typeof cloudAccountUserSchema>
export type CloudAccountSession = z.infer<typeof cloudAccountSessionSchema>
export type CloudCredentials = z.infer<typeof cloudCredentialsSchema>

export interface AuthTokenStore {
  getToken(): Promise<string | null>
  setToken(token: string): Promise<void>
  clearToken(): Promise<void>
}

export interface CloudAuthGateway {
  register(
    credentials: CloudCredentials,
    tokenStore: AuthTokenStore,
  ): Promise<CloudAccountSession>
  login(
    credentials: CloudCredentials,
    tokenStore: AuthTokenStore,
  ): Promise<CloudAccountSession>
  restoreSession(tokenStore: AuthTokenStore): Promise<CloudAccountSession | null>
  logout(tokenStore: AuthTokenStore): Promise<void>
  requestEmailVerification(tokenStore: AuthTokenStore): Promise<void>
  confirmEmailVerification(
    token: string,
    tokenStore: AuthTokenStore,
  ): Promise<CloudAccountSession | null>
  requestPasswordReset(email: string, tokenStore: AuthTokenStore): Promise<void>
  confirmPasswordReset(
    token: string,
    password: string,
    tokenStore: AuthTokenStore,
  ): Promise<void>
}

export type CloudAuthErrorCode =
  | 'invalid-input'
  | 'email-already-registered'
  | 'invalid-credentials'
  | 'invalid-account-token'
  | 'email-delivery-unavailable'
  | 'session-expired'
  | 'rate-limited'
  | 'network'
  | 'timeout'
  | 'server'
  | 'invalid-response'
  | 'request-failed'

export class CloudAuthError extends Error {
  readonly code: CloudAuthErrorCode
  readonly retryable: boolean
  readonly status: number | null

  constructor(
    code: CloudAuthErrorCode,
    message: string,
    options: { retryable?: boolean; status?: number | null } = {},
  ) {
    super(message)
    this.name = 'CloudAuthError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.status = options.status ?? null
  }
}
