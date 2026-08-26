import { describe, expect, it, vi } from 'vitest'
import { CloudSyncClient } from './cloudSyncClient'

const TOKEN = 'opaque-session-token-with-enough-entropy'

describe('CloudSyncClient', () => {
  it('accepts the backend protocol version marker on push and pull responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: 1,
        changes: [],
        nextCursor: 0,
        hasMore: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: 1,
        results: [],
      }))
    const client = createClient(fetch)

    await expect(client.pull(0)).resolves.toMatchObject({
      changes: [],
      nextCursor: 0,
    })
    await expect(client.push([
      {
        operationId: 'operation-versioned',
        entityType: 'session',
        entityId: 'session-versioned',
        baseVersion: 0,
        payload: { status: 'completed' },
        deletedAt: null,
      },
    ])).resolves.toEqual({ schemaVersion: 1, results: [] })
  })

  it('injects the current access token and validates push responses', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      results: [
        {
          operationId: 'operation-1',
          entityType: 'session',
          entityId: 'session-1',
          status: 'applied',
          version: 1,
          cursor: 4,
          replayed: false,
          code: null,
          message: null,
          current: null,
        },
      ],
    }))
    const client = createClient(fetch)

    await expect(client.push([
      {
        operationId: 'operation-1',
        entityType: 'session',
        entityId: 'session-1',
        baseVersion: 0,
        payload: { status: 'completed' },
        deletedAt: null,
      },
    ])).resolves.toMatchObject({ results: [{ status: 'applied' }] })

    expect(fetch).toHaveBeenCalledTimes(1)
    const request = fetch.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined
    expect(request?.[0]).toBe('https://backend.test/v1/sync/push')
    expect(request?.[1].headers).toEqual(expect.objectContaining({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    }))
  })

  it('uses the persisted cursor and rejects malformed pull payloads', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        changes: [],
        nextCursor: 12,
        hasMore: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        changes: [],
        nextCursor: 'not-a-number',
        hasMore: false,
      }))
    const client = createClient(fetch)

    await expect(client.pull(12, 50)).resolves.toEqual({
      changes: [],
      nextCursor: 12,
      hasMore: false,
    })
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://backend.test/v1/sync/pull?cursor=12&limit=50',
    )
    await expect(client.pull(12)).rejects.toMatchObject({
      code: 'invalid-response',
      retryable: true,
    })
  })

  it('notifies the auth layer on 401 without owning token storage', async () => {
    const onUnauthorized = vi.fn()
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'invalid-session', message: '登录状态无效或已过期。' },
    }, 401))
    const client = createClient(fetch, onUnauthorized)

    await expect(client.pull(0)).rejects.toMatchObject({
      code: 'session-expired',
      status: 401,
    })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('fails locally when no access token is available', async () => {
    const fetch = vi.fn()
    const client = new CloudSyncClient({
      baseUrl: 'https://backend.test',
      getAccessToken: () => null,
      isNative: () => false,
      fetch,
    })

    await expect(client.pull(0)).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

function createClient(
  fetch: ReturnType<typeof vi.fn>,
  onUnauthorized?: () => void,
): CloudSyncClient {
  return new CloudSyncClient({
    baseUrl: 'https://backend.test',
    getAccessToken: () => TOKEN,
    ...(onUnauthorized === undefined ? {} : { onUnauthorized }),
    isNative: () => false,
    fetch: fetch as typeof globalThis.fetch,
  })
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
