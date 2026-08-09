import { ApiConfigurationService } from './apiConfigurationService'
import {
  configurationByCapability,
  createConfiguredApiHarness,
  MemoryApiConfigurationStorage,
  MemorySecureSecretStorage,
  secretNameByCapability,
  textConfiguration,
} from '../test/fixtures/apiHarness'

describe('ApiConfigurationService credential isolation', () => {
  it('loads the three configurations and credential-presence flags independently', async () => {
    const configurations = new MemoryApiConfigurationStorage()
    const secrets = new MemorySecureSecretStorage()
    const textSecret = runtimeSecret('text')
    const sttSecret = runtimeSecret('stt')
    for (const capability of ['text-ai', 'voice-ai', 'stt'] as const) {
      configurations.values.set(
        capability,
        structuredClone(configurationByCapability[capability]),
      )
    }
    secrets.values.set('text-ai-api-key', textSecret)
    secrets.values.set('stt-api-key', sttSecret)
    const service = new ApiConfigurationService(configurations, secrets)

    await service.initialize()

    expect(service.getStatus('text-ai')).toMatchObject({
      configured: true,
      hasSecret: true,
      configuration: { id: 'text-ai' },
    })
    expect(service.getStatus('voice-ai')).toMatchObject({
      configured: false,
      hasSecret: false,
      configuration: { id: 'voice-ai' },
    })
    expect(service.getStatus('stt')).toMatchObject({
      configured: true,
      hasSecret: true,
      configuration: { id: 'stt' },
    })
    expect((await service.getSecret('text-ai')) === textSecret).toBe(true)
    expect(await service.getSecret('voice-ai')).toBeNull()
    expect((await service.getSecret('stt')) === sttSecret).toBe(true)
  })

  it('saves each API key under only its dedicated secure-secret name', async () => {
    const { service, configurations, secrets, keys } =
      await createConfiguredApiHarness()

    for (const capability of ['text-ai', 'voice-ai', 'stt'] as const) {
      const name = secretNameByCapability[capability]
      expect(secrets.values.get(name) === keys[capability]).toBe(true)
      expect(
        JSON.stringify(configurations.values.get(capability)).includes(
          keys[capability],
        ),
      ).toBe(false)
      expect((await service.getSecret(capability)) === keys[capability]).toBe(
        true,
      )
    }
  })

  it('updates non-secret Text AI settings without changing any provider key', async () => {
    const { service, secrets, keys } = await createConfiguredApiHarness()
    const updated = {
      ...textConfiguration,
      model: 'updated-text-model',
      updatedAt: '2026-08-10T09:30:00.000Z',
    }

    const status = await service.save(updated)

    expect(status.configuration).toEqual(updated)
    for (const capability of ['text-ai', 'voice-ai', 'stt'] as const) {
      expect(
        secrets.values.get(secretNameByCapability[capability]) ===
          keys[capability],
      ).toBe(true)
    }
  })

  it('removes only the requested key while retaining its non-secret configuration', async () => {
    const { service, secrets, keys } = await createConfiguredApiHarness()

    const status = await service.removeSecret('voice-ai')

    expect(status).toMatchObject({
      configured: false,
      hasSecret: false,
      configuration: { id: 'voice-ai' },
    })
    expect(secrets.values.has('voice-ai-api-key')).toBe(false)
    expect(secrets.values.get('text-ai-api-key') === keys['text-ai']).toBe(true)
    expect(secrets.values.get('stt-api-key') === keys.stt).toBe(true)
  })

  it('deletes one capability without changing either remaining capability', async () => {
    const { service, configurations, secrets, keys } =
      await createConfiguredApiHarness()

    await service.delete('stt')

    expect(service.getStatus('stt')).toEqual({
      configuration: null,
      hasSecret: false,
      configured: false,
    })
    expect(configurations.values.has('stt')).toBe(false)
    expect(secrets.values.has('stt-api-key')).toBe(false)
    expect(secrets.values.get('text-ai-api-key') === keys['text-ai']).toBe(true)
    expect(
      secrets.values.get('voice-ai-api-key') === keys['voice-ai'],
    ).toBe(true)
  })
})

describe('ApiConfigurationService rollback', () => {
  it('restores the previous secret when its configuration write fails', async () => {
    const { service, configurations, secrets, keys } =
      await createConfiguredApiHarness()
    const replacement = runtimeSecret('replacement')
    configurations.failNextUpsert = new Error('configuration write failed')

    await expect(
      service.save(
        { ...textConfiguration, model: 'not-committed' },
        replacement,
      ),
    ).rejects.toThrow('configuration write failed')

    expect(secrets.values.get('text-ai-api-key') === keys['text-ai']).toBe(true)
    expect(service.getStatus('text-ai').configuration).toEqual(textConfiguration)
    expect(
      configurations.values.get('text-ai')?.model,
    ).toBe(textConfiguration.model)
  })

  it('removes a newly written secret when the first configuration write fails', async () => {
    const configurations = new MemoryApiConfigurationStorage()
    const secrets = new MemorySecureSecretStorage()
    const service = new ApiConfigurationService(configurations, secrets)
    configurations.failNextUpsert = new Error('configuration write failed')

    await expect(
      service.save(textConfiguration, runtimeSecret('new-text')),
    ).rejects.toThrow('configuration write failed')

    expect(secrets.values.has('text-ai-api-key')).toBe(false)
    expect(configurations.values.has('text-ai')).toBe(false)
    expect(service.getStatus('text-ai')).toEqual({
      configuration: null,
      hasSecret: false,
      configured: false,
    })
  })

  it('does not write configuration if secure storage rejects the key', async () => {
    const configurations = new MemoryApiConfigurationStorage()
    const secrets = new MemorySecureSecretStorage()
    const service = new ApiConfigurationService(configurations, secrets)
    secrets.failNextSet = new Error('secure storage unavailable')

    await expect(
      service.save(textConfiguration, runtimeSecret('new-text')),
    ).rejects.toThrow('secure storage unavailable')

    expect(configurations.operations).toEqual([])
    expect(configurations.values.size).toBe(0)
  })
})

function runtimeSecret(label: string): string {
  return `${label}-${globalThis.crypto.randomUUID()}`
}
