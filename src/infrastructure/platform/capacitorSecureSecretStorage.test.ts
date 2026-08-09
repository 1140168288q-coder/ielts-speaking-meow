import { describe, expect, it, vi } from 'vitest'
import {
  CapacitorSecureSecretStorage,
  type SecureSecretsPluginContract,
} from './capacitorSecureSecretStorage'

describe('CapacitorSecureSecretStorage', () => {
  it('delegates each credential name without coupling providers', async () => {
    const get = vi.fn().mockResolvedValue({ value: 'fake-test-key' })
    const set = vi.fn().mockResolvedValue(undefined)
    const remove = vi.fn().mockResolvedValue(undefined)
    const plugin: SecureSecretsPluginContract = {
      get,
      set,
      remove,
    }
    const storage = new CapacitorSecureSecretStorage(plugin)

    await storage.set('stt-api-key', 'fake-test-key')
    await expect(storage.get('stt-api-key')).resolves.toBe('fake-test-key')
    await storage.remove('stt-api-key')

    expect(set).toHaveBeenCalledWith({
      name: 'stt-api-key',
      value: 'fake-test-key',
    })
    expect(get).toHaveBeenCalledWith({ name: 'stt-api-key' })
    expect(remove).toHaveBeenCalledWith({ name: 'stt-api-key' })
  })

  it('allows a missing secret without inventing a fallback value', async () => {
    const plugin: SecureSecretsPluginContract = {
      get: vi.fn().mockResolvedValue({ value: null }),
      set: vi.fn(),
      remove: vi.fn(),
    }

    await expect(
      new CapacitorSecureSecretStorage(plugin).get('voice-ai-api-key'),
    ).resolves.toBeNull()
  })

  it('rejects empty values before crossing the native bridge', async () => {
    const set = vi.fn()
    const plugin: SecureSecretsPluginContract = {
      get: vi.fn(),
      set,
      remove: vi.fn(),
    }

    await expect(
      new CapacitorSecureSecretStorage(plugin).set('text-ai-api-key', '  '),
    ).rejects.toThrow('must not be empty')
    expect(set).not.toHaveBeenCalled()
  })
})
