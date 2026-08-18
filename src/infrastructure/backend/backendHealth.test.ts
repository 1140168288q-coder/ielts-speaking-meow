import { describe, expect, it, vi } from 'vitest'
import { makeBackendHealth, makeProviderHealth } from '../../test/fixtures/backendHealth'
import type { BackendClient } from './backendClient'
import { BackendHealthCache } from './backendHealth'

function createClient(
  health: unknown,
  failure?: () => unknown,
): BackendClient {
  return {
    getHealth: failure
      ? vi.fn().mockRejectedValue(failure())
      : vi.fn().mockResolvedValue(health),
  } as unknown as BackendClient
}

describe('BackendHealthCache', () => {
  it('starts in the unknown state before the first check', () => {
    const cache = new BackendHealthCache(createClient({}))
    expect(cache.statusOf('deepseek')).toBe('unknown')
    expect(cache.statusOf('volc_tts')).toBe('unknown')
    expect(cache.getSnapshot().health).toBeNull()
  })

  it('caches DeepSeek and TTS states after a successful refresh', async () => {
    const cache = new BackendHealthCache(
      createClient(makeBackendHealth({
        deepseek: makeProviderHealth({ model: 'deepseek-v4-flash' }),
        volc_tts: false,
      })),
    )
    const snapshot = await cache.refresh()
    expect(snapshot.health?.providers.deepseek?.configured).toBe(true)
    expect(snapshot.health?.providers.volc_tts?.configured).toBe(false)
    expect(cache.statusOf('deepseek')).toBe('configured')
    expect(cache.statusOf('volc_tts')).toBe('unconfigured')
  })

  it('keeps status unknown and records the failure when the backend is unreachable', async () => {
    const cache = new BackendHealthCache(
      createClient(null, () => new Error('网络连接失败。')),
    )
    const snapshot = await cache.refresh()
    expect(snapshot.health).toBeNull()
    expect(snapshot.failure).toBe('网络连接失败。')
    expect(cache.statusOf('deepseek')).toBe('unknown')
  })

  it('exposes provider details and verification state', async () => {
    const cache = new BackendHealthCache(
      createClient(makeBackendHealth({
        deepseek: makeProviderHealth({
          model: 'deepseek-v4-flash',
          verification: {
            status: 'verified',
            checkedAt: '2026-08-15T08:00:00.000Z',
            latencyMs: 300,
            lastError: null,
            lastResult: null,
          },
        }),
        volc_tts: makeProviderHealth({
          speaker: { id: 'zh_female_vv_uranus_bigtts', name: null },
        }),
      })),
    )
    await cache.refresh()
    expect(cache.providerInfo('deepseek')?.model).toBe('deepseek-v4-flash')
    expect(cache.providerInfo('volc_tts')?.speaker?.id).toBe('zh_female_vv_uranus_bigtts')
    expect(cache.verificationOf('deepseek')?.status).toBe('verified')
  })

  it('deduplicates concurrent refreshes into a single request', async () => {
    const getHealth = vi.fn().mockResolvedValue(makeBackendHealth({
      deepseek: true,
      volc_tts: true,
    }))
    const cache = new BackendHealthCache({
      getHealth,
    } as unknown as BackendClient)
    const [first, second] = await Promise.all([cache.refresh(), cache.refresh()])
    expect(first.health).not.toBeNull()
    expect(second).toBe(first)
    expect(getHealth).toHaveBeenCalledTimes(1)
  })

  it('invalidate resets every provider to unknown', async () => {
    const cache = new BackendHealthCache(
      createClient(makeBackendHealth({
        deepseek: true,
        volc_tts: true,
      })),
    )
    await cache.refresh()
    expect(cache.statusOf('volc_tts')).toBe('configured')
    cache.invalidate()
    expect(cache.statusOf('volc_tts')).toBe('unknown')
    expect(cache.getSnapshot().health).toBeNull()
  })

  it('verifyProviders refreshes the snapshot after the real probes', async () => {
    const verifyProviders = vi.fn().mockResolvedValue({})
    const getHealth = vi.fn().mockResolvedValue(makeBackendHealth({
      deepseek: true,
      volc_tts: true,
    }))
    const cache = new BackendHealthCache({
      getHealth,
      verifyProviders,
    } as unknown as BackendClient)
    const snapshot = await cache.verifyProviders()
    expect(verifyProviders).toHaveBeenCalledTimes(1)
    expect(snapshot.health).not.toBeNull()
    expect(getHealth).toHaveBeenCalled()
  })
})
