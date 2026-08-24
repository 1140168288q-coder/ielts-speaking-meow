import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthTokenStore } from '../../domain/cloudAccount'
import {
  BrowserSessionAuthTokenStore,
  CloudAuthClient,
} from './cloudAuthClient'

class MemoryTokenStore implements AuthTokenStore {
  token: string | null = null

  async getToken(): Promise<string | null> {
    await Promise.resolve()
    return this.token
  }

  async setToken(token: string): Promise<void> {
    await Promise.resolve()
    this.token = token
  }

  async clearToken(): Promise<void> {
    await Promise.resolve()
    this.token = null
  }
}

const authPayload = {
  accessToken: 't'.repeat(43),
  tokenType: 'Bearer',
  expiresAt: '2026-09-20T08:00:00+00:00',
  user: {
    id: 'user-1',
    email: 'learner@example.com',
    emailVerified: true,
    createdAt: '2026-08-21T08:00:00+00:00',
  },
}

function response(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createClient(fetch: typeof globalThis.fetch) {
  return new CloudAuthClient({
    baseUrl: 'https://backend.test',
    isNative: () => false,
    fetch,
  })
}

afterEach(() => {
  sessionStorage.clear()
})

describe('CloudAuthClient', () => {
  it('registers with normalized email and stores only the token adapter', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(authPayload, 201))
    const store = new MemoryTokenStore()

    const session = await createClient(fetch).register({
      email: ' Learner@Example.com ',
      password: 'correct horse battery staple',
    }, store)

    expect(session.user.email).toBe('learner@example.com')
    expect(store.token).toBe(authPayload.accessToken)
    expect(fetch).toHaveBeenCalledWith(
      'https://backend.test/v1/auth/register',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'learner@example.com',
          password: 'correct horse battery staple',
        }),
      }),
    )
  })

  it('restores a stored session with a bearer token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({
      expiresAt: authPayload.expiresAt,
      user: authPayload.user,
    }))
    const store = new MemoryTokenStore()
    store.token = authPayload.accessToken

    await expect(createClient(fetch).restoreSession(store)).resolves.toMatchObject({
      user: { email: 'learner@example.com' },
    })
    const request = fetch.mock.calls[0]
    expect(request?.[0]).toBe('https://backend.test/v1/auth/session')
    expect(request?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: `Bearer ${authPayload.accessToken}` }),
    )
  })

  it('clears an invalid session token and exposes a unified error', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      error: { code: 'invalid-session', message: '登录状态无效或已过期。' },
    }, 401))
    const store = new MemoryTokenStore()
    store.token = authPayload.accessToken

    await expect(createClient(fetch).restoreSession(store)).rejects.toMatchObject({
      code: 'session-expired',
      retryable: false,
      status: 401,
    })
    expect(store.token).toBeNull()
  })

  it('clears the local token even when remote logout cannot be confirmed', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('offline'))
    const store = new MemoryTokenStore()
    store.token = authPayload.accessToken

    await expect(createClient(fetch).logout(store)).rejects.toMatchObject({ code: 'network' })
    expect(store.token).toBeNull()
  })

  it('rejects malformed success responses', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ accessToken: 'short' }))
    const store = new MemoryTokenStore()

    await expect(createClient(fetch).login({
      email: 'learner@example.com',
      password: 'correct horse battery staple',
    }, store)).rejects.toMatchObject({ code: 'invalid-response' })
    expect(store.token).toBeNull()
  })

  it('requests and confirms password reset without creating a session', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
    const store = new MemoryTokenStore()
    store.token = 'stale-session-token'
    const client = createClient(fetch)

    await client.requestPasswordReset(' Learner@Example.com ', store)
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://backend.test/v1/auth/password-reset/request',
      expect.objectContaining({
        body: JSON.stringify({ email: 'learner@example.com' }),
      }),
    )

    await client.confirmPasswordReset(
      'r'.repeat(43),
      'new correct password',
      store,
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://backend.test/v1/auth/password-reset/confirm',
      expect.objectContaining({
        body: JSON.stringify({
          token: 'r'.repeat(43),
          newPassword: 'new correct password',
        }),
      }),
    )
    expect(store.token).toBeNull()
  })

  it('uses the stored bearer session to verify the account email', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response({
        expiresAt: authPayload.expiresAt,
        user: authPayload.user,
      }))
    const store = new MemoryTokenStore()
    store.token = authPayload.accessToken
    const client = createClient(fetch)

    await client.requestEmailVerification(store)
    await expect(
      client.confirmEmailVerification('v'.repeat(43), store),
    ).resolves.toMatchObject({ user: { emailVerified: true } })
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: `Bearer ${authPayload.accessToken}` }),
    )
    const confirmationHeaders = fetch.mock.calls[1]?.[1]?.headers as
      | Record<string, string>
      | undefined
    expect(confirmationHeaders?.Authorization).toBeUndefined()
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ token: 'v'.repeat(43) }),
    )
    expect(fetch.mock.calls[2]?.[0]).toBe('https://backend.test/v1/auth/session')
  })

  it('verifies an email link without requiring a browser session', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(null, 204))
    const store = new MemoryTokenStore()

    await expect(
      createClient(fetch).confirmEmailVerification('v'.repeat(43), store),
    ).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('provides a browser-development sessionStorage adapter', async () => {
    const store = new BrowserSessionAuthTokenStore(sessionStorage, 'test-token')
    await store.setToken('secret')
    expect(await store.getToken()).toBe('secret')
    expect(localStorage.getItem('test-token')).toBeNull()
    await store.clearToken()
    expect(await store.getToken()).toBeNull()
  })
  it('loads account capabilities and updates the cloud profile', async () => {
    const overview = {
      user: {
        ...authPayload.user,
        displayName: 'Mia',
        status: 'active',
        updatedAt: '2026-08-24T08:00:00+00:00',
      },
      billing: {
        plan: 'free',
        subscriptionStatus: 'none',
        currentPeriodEnd: null,
      },
      capabilities: {
        feedback: {
          enabled: true,
          source: 'plan:free',
          reason: null,
          quotaLimit: 30,
          quotaUsed: 4,
          quotaRemaining: 26,
          period: 'month',
          unit: 'request',
          resetsAt: '2026-09-01T00:00:00+00:00',
        },
      },
    }
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(overview))
      .mockResolvedValueOnce(response({
        ...overview,
        user: { ...overview.user, displayName: 'Mia Chen' },
      }))
    const store = new MemoryTokenStore()
    store.token = authPayload.accessToken
    const client = createClient(fetch)

    await expect(client.getAccountOverview(store)).resolves.toMatchObject({
      billing: { plan: 'free' },
      capabilities: { feedback: { quotaRemaining: 26 } },
    })
    await expect(client.updateProfile('  Mia Chen  ', store)).resolves.toMatchObject({
      user: { displayName: 'Mia Chen' },
    })

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://backend.test/v1/me',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ displayName: 'Mia Chen' }),
      }),
    )
  })

  it('revokes all sessions and deletes an account through explicit methods', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
    const store = new MemoryTokenStore()
    store.token = authPayload.accessToken
    const client = createClient(fetch)

    await client.logoutAll(store)
    expect(store.token).toBeNull()
    expect(fetch.mock.calls[0]?.[0]).toBe('https://backend.test/v1/auth/logout-all')

    store.token = authPayload.accessToken
    await client.deleteAccount('correct password', store)
    expect(store.token).toBeNull()
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://backend.test/v1/me',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ password: 'correct password' }),
      }),
    )
  })

  it('keeps the session when account deletion is rejected by password check', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({
      error: { code: 'invalid-password', message: '密码不正确。' },
    }, 401))
    const store = new MemoryTokenStore()
    store.token = authPayload.accessToken

    await expect(
      createClient(fetch).deleteAccount('wrong password', store),
    ).rejects.toMatchObject({ code: 'invalid-password', status: 401 })
    expect(store.token).toBe(authPayload.accessToken)
  })

})
