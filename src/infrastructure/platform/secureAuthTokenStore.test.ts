import { describe, expect, it, vi } from 'vitest'
import { CapacitorSecureAuthTokenStore } from './secureAuthTokenStore'

describe('CapacitorSecureAuthTokenStore', () => {
  it('delegates token reads, writes and clearing to the native secure plugin', async () => {
    const plugin = {
      getToken: vi.fn().mockResolvedValue({ token: 'secure-token' }),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
    }
    const store = new CapacitorSecureAuthTokenStore(plugin)

    await expect(store.getToken()).resolves.toBe('secure-token')
    await store.setToken('  next-token  ')
    await store.clearToken()

    expect(plugin.setToken).toHaveBeenCalledWith({ token: 'next-token' })
    expect(plugin.clearToken).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty token before invoking native storage', async () => {
    const plugin = {
      getToken: vi.fn().mockResolvedValue({ token: null }),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
    }
    const store = new CapacitorSecureAuthTokenStore(plugin)

    await expect(store.setToken('   ')).rejects.toThrow('不能为空')
    expect(plugin.setToken).not.toHaveBeenCalled()
  })
})
