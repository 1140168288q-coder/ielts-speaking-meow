import { describe, expect, it } from 'vitest'
import type { BackendConfig } from '../../domain'
import type { BackendConfigStorage } from '../../ports/backend'
import { BackendConfigStore } from './backendConfig'

class MemoryConfigStorage implements BackendConfigStorage {
  stored: BackendConfig | null = null

  getBackendConfig(): Promise<BackendConfig | null> {
    return Promise.resolve(this.stored)
  }

  saveBackendConfig(config: BackendConfig): Promise<void> {
    this.stored = config
    return Promise.resolve()
  }

  clearBackendConfig(): Promise<void> {
    this.stored = null
    return Promise.resolve()
  }
}

describe('BackendConfigStore', () => {
  it('falls back to the build-time default URL before loading', () => {
    const store = new BackendConfigStore(
      new MemoryConfigStorage(),
      'http://default.test:8000',
      false,
    )
    expect(store.getBaseUrl()).toBe('http://default.test:8000')
    expect(store.getSavedConfig()).toBeNull()
  })

  it('loads persisted runtime configuration', async () => {
    const storage = new MemoryConfigStorage()
    storage.stored = {
      id: 'backend',
      baseUrl: 'http://192.168.0.26:8000',
      updatedAt: '2026-08-14T08:00:00.000Z',
    }
    const store = new BackendConfigStore(storage, 'http://default.test:8000', false)
    await store.load()
    expect(store.getBaseUrl()).toBe('http://192.168.0.26:8000')
  })

  it('saves and immediately applies a new configuration', async () => {
    const storage = new MemoryConfigStorage()
    const store = new BackendConfigStore(storage, 'http://default.test:8000', false)
    const saved = await store.save('http://192.168.1.50:8000')

    expect(saved.baseUrl).toBe('http://192.168.1.50:8000')
    expect(store.getBaseUrl()).toBe('http://192.168.1.50:8000')
  })

  it('rejects malformed addresses and trailing slashes are trimmed', async () => {
    const store = new BackendConfigStore(
      new MemoryConfigStorage(),
      'http://default.test:8000',
      false,
    )
    await expect(store.save('not-a-url')).rejects.toThrow()
    const saved = await store.save('http://192.168.1.50:8000/')
    expect(saved.baseUrl).toBe('http://192.168.1.50:8000')
  })

  it('corrects a pasted health-check URL to the Backend base address', async () => {
    const storage = new MemoryConfigStorage()
    storage.stored = {
      id: 'backend',
      baseUrl: 'http://192.168.0.26:8000/health',
      updatedAt: '2026-08-14T08:00:00.000Z',
    }
    const store = new BackendConfigStore(storage, 'http://default.test:8000', false)

    await store.load()
    expect(store.getBaseUrl()).toBe('http://192.168.0.26:8000')
    await expect(
      store.save('http://192.168.0.26:8000/health/'),
    ).resolves.toMatchObject({ baseUrl: 'http://192.168.0.26:8000' })
  })

  it('requires HTTPS for public hosts while keeping LAN development available', async () => {
    const store = new BackendConfigStore(
      new MemoryConfigStorage(),
      'http://10.0.2.2:8000',
      false,
    )

    await expect(store.save('http://backend.example.com')).rejects.toThrow(
      '公网地址必须使用 HTTPS',
    )
    await expect(store.save('https://backend.example.com')).resolves.toMatchObject({
      baseUrl: 'https://backend.example.com',
    })
    await expect(store.save('http://localhost:8000')).resolves.toMatchObject({
      baseUrl: 'http://localhost:8000',
    })
  })

  describe('locked builds (formal release)', () => {
    it('ignores and clears the legacy stored address on load', async () => {
      const storage = new MemoryConfigStorage()
      storage.stored = {
        id: 'backend',
        baseUrl: 'http://192.168.0.26:8000',
        updatedAt: '2026-08-14T08:00:00.000Z',
      }
      const store = new BackendConfigStore(
        storage,
        'https://fixed.example.com',
        true,
      )
      await store.load()
      expect(store.getBaseUrl()).toBe('https://fixed.example.com')
      expect(store.getSavedConfig()).toBeNull()
      expect(storage.stored).toBeNull()
    })

    it('rejects runtime saves and always serves the built-in URL', async () => {
      const store = new BackendConfigStore(
        new MemoryConfigStorage(),
        'https://fixed.example.com',
        true,
      )
      expect(store.isLocked()).toBe(true)
      await expect(store.save('http://192.168.1.50:8000')).rejects.toThrow(
        '不能在设置页修改',
      )
      expect(store.getBaseUrl()).toBe('https://fixed.example.com')
    })
  })
})
