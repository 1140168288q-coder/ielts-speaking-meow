import { z } from 'zod'

export const cloudAccountUserSchema = z.object({
  id: z.string().trim().min(1),
  email: z.email(),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  displayName: z.string().trim().max(80).nullable().optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
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
export const cloudFeatureCapabilitySchema = z.object({
  enabled: z.boolean(),
  source: z.string().trim().min(1),
  reason: z.string().trim().min(1).nullable(),
  quotaLimit: z.number().int().nonnegative().nullable(),
  quotaUsed: z.number().int().nonnegative(),
  quotaRemaining: z.number().int().nonnegative().nullable(),
  period: z.enum(['day', 'month']),
  unit: z.enum(['request', 'character']),
  resetsAt: z.iso.datetime({ offset: true }),
})

export const cloudBillingSchema = z.object({
  plan: z.string().trim().min(1),
  subscriptionStatus: z.string().trim().min(1),
  currentPeriodEnd: z.iso.datetime({ offset: true }).nullable(),
})

export const cloudAccountOverviewSchema = z.object({
  user: cloudAccountUserSchema,
  billing: cloudBillingSchema,
  capabilities: z.record(z.string(), cloudFeatureCapabilitySchema),
})


export type CloudAccountUser = z.infer<typeof cloudAccountUserSchema>
export type CloudAccountSession = z.infer<typeof cloudAccountSessionSchema>
export type CloudCredentials = z.infer<typeof cloudCredentialsSchema>
export type CloudFeatureCapability = z.infer<typeof cloudFeatureCapabilitySchema>
export type CloudBilling = z.infer<typeof cloudBillingSchema>
export type CloudAccountOverview = z.infer<typeof cloudAccountOverviewSchema>

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
  getAccountOverview?(
    tokenStore: AuthTokenStore,
  ): Promise<CloudAccountOverview>
  updateProfile?(
    displayName: string | null,
    tokenStore: AuthTokenStore,
  ): Promise<CloudAccountOverview>
  logoutAll?(tokenStore: AuthTokenStore): Promise<void>
  deleteAccount?(
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
  | 'invalid-password'
  | 'account-inactive'
  | 'feature-not-entitled'
  | 'quota-exceeded'
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
