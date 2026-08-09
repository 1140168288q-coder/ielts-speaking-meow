import { ApiConfigurationService } from '../../application/apiConfigurationService'
import type {
  ApiCapability,
  ApiConfiguration,
  SttConfiguration,
  TextAiConfiguration,
  VoiceAiConfiguration,
} from '../../domain'
import type { SecureSecretStorage, SecretName } from '../../ports/ai'
import type { ApiConfigurationStorage } from '../../ports/imports'

const UPDATED_AT = '2026-08-10T09:00:00.000Z'

export const textConfiguration: TextAiConfiguration = {
  id: 'text-ai',
  provider: 'openai-compatible',
  endpoint: 'https://text.example.test/v1',
  model: 'text-fixture-model',
  enabled: true,
  updatedAt: UPDATED_AT,
}

export const voiceConfiguration: VoiceAiConfiguration = {
  id: 'voice-ai',
  provider: 'openai-compatible',
  endpoint: 'https://voice.example.test/v1',
  model: 'voice-fixture-model',
  voice: 'fixture-voice',
  enabled: true,
  updatedAt: UPDATED_AT,
}

export const sttConfiguration: SttConfiguration = {
  id: 'stt',
  provider: 'openai-compatible',
  endpoint: 'https://stt.example.test/v1',
  model: 'stt-fixture-model',
  enabled: true,
  updatedAt: UPDATED_AT,
}

export const configurationByCapability: Readonly<
  Record<ApiCapability, ApiConfiguration>
> = {
  'text-ai': textConfiguration,
  'voice-ai': voiceConfiguration,
  stt: sttConfiguration,
}

export const secretNameByCapability: Readonly<
  Record<ApiCapability, SecretName>
> = {
  'text-ai': 'text-ai-api-key',
  'voice-ai': 'voice-ai-api-key',
  stt: 'stt-api-key',
}

export class MemoryApiConfigurationStorage
  implements ApiConfigurationStorage
{
  readonly values = new Map<ApiCapability, ApiConfiguration>()
  readonly operations: string[] = []
  failNextUpsert: Error | null = null
  failNextDelete: Error | null = null

  getApiConfiguration(
    capability: ApiCapability,
  ): Promise<ApiConfiguration | null> {
    const value = this.values.get(capability)
    return Promise.resolve(value ? structuredClone(value) : null)
  }

  listApiConfigurations(): Promise<ApiConfiguration[]> {
    return Promise.resolve(
      [...this.values.values()].map((value) => structuredClone(value)),
    )
  }

  upsertApiConfiguration(configuration: ApiConfiguration): Promise<void> {
    this.operations.push(`upsert:${configuration.id}`)
    if (this.failNextUpsert !== null) {
      const error = this.failNextUpsert
      this.failNextUpsert = null
      return Promise.reject(error)
    }
    this.values.set(configuration.id, structuredClone(configuration))
    return Promise.resolve()
  }

  deleteApiConfiguration(capability: ApiCapability): Promise<void> {
    this.operations.push(`delete:${capability}`)
    if (this.failNextDelete !== null) {
      const error = this.failNextDelete
      this.failNextDelete = null
      return Promise.reject(error)
    }
    this.values.delete(capability)
    return Promise.resolve()
  }
}

export class MemorySecureSecretStorage implements SecureSecretStorage {
  readonly values = new Map<SecretName, string>()
  readonly operations: string[] = []
  failNextSet: Error | null = null
  failNextRemove: Error | null = null

  get(name: SecretName): Promise<string | null> {
    this.operations.push(`get:${name}`)
    return Promise.resolve(this.values.get(name) ?? null)
  }

  set(name: SecretName, value: string): Promise<void> {
    this.operations.push(`set:${name}`)
    if (this.failNextSet !== null) {
      const error = this.failNextSet
      this.failNextSet = null
      return Promise.reject(error)
    }
    this.values.set(name, value)
    return Promise.resolve()
  }

  remove(name: SecretName): Promise<void> {
    this.operations.push(`remove:${name}`)
    if (this.failNextRemove !== null) {
      const error = this.failNextRemove
      this.failNextRemove = null
      return Promise.reject(error)
    }
    this.values.delete(name)
    return Promise.resolve()
  }
}

export interface ConfiguredApiHarness {
  service: ApiConfigurationService
  configurations: MemoryApiConfigurationStorage
  secrets: MemorySecureSecretStorage
  keys: Record<ApiCapability, string>
}

export async function createConfiguredApiHarness(): Promise<ConfiguredApiHarness> {
  const configurations = new MemoryApiConfigurationStorage()
  const secrets = new MemorySecureSecretStorage()
  const service = new ApiConfigurationService(configurations, secrets)
  const keys: Record<ApiCapability, string> = {
    'text-ai': createRuntimeSecret('text'),
    'voice-ai': createRuntimeSecret('voice'),
    stt: createRuntimeSecret('stt'),
  }

  for (const capability of ['text-ai', 'voice-ai', 'stt'] as const) {
    await service.save(configurationByCapability[capability], keys[capability])
  }

  return { service, configurations, secrets, keys }
}

function createRuntimeSecret(label: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${label}-${suffix}`
}
