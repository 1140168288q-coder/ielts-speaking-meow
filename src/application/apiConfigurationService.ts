import {
  apiCapabilitySchema,
  apiConfigurationSchema,
  type ApiCapability,
  type ApiConfiguration,
} from '../domain'
import type { SecureSecretStorage, SecretName } from '../ports/ai'
import type { ApiConfigurationStorage } from '../ports/imports'

const SECRET_BY_CAPABILITY: Readonly<Record<ApiCapability, SecretName>> = {
  'text-ai': 'text-ai-api-key',
  'voice-ai': 'voice-ai-api-key',
  stt: 'stt-api-key',
}

export interface ApiCapabilityStatus {
  configuration: ApiConfiguration | null
  hasSecret: boolean
  configured: boolean
}

export class ApiConfigurationService {
  private readonly configurations = new Map<ApiCapability, ApiConfiguration>()
  private readonly secretPresence = new Map<ApiCapability, boolean>()
  private initialization: Promise<void> | null = null

  constructor(
    private readonly storage: ApiConfigurationStorage,
    private readonly secrets: SecureSecretStorage,
  ) {}

  initialize(): Promise<void> {
    if (this.initialization === null) {
      this.initialization = this.load().catch((error: unknown) => {
        this.initialization = null
        throw error
      })
    }
    return this.initialization
  }

  getStatus(capability: ApiCapability): ApiCapabilityStatus {
    apiCapabilitySchema.parse(capability)
    const configuration = this.configurations.get(capability) ?? null
    const hasSecret = this.secretPresence.get(capability) ?? false
    return {
      configuration,
      hasSecret,
      configured: configuration?.enabled === true && hasSecret,
    }
  }

  listStatuses(): Record<ApiCapability, ApiCapabilityStatus> {
    return {
      'text-ai': this.getStatus('text-ai'),
      'voice-ai': this.getStatus('voice-ai'),
      stt: this.getStatus('stt'),
    }
  }

  async save(
    configuration: ApiConfiguration,
    apiKey?: string,
  ): Promise<ApiCapabilityStatus> {
    const parsed = apiConfigurationSchema.parse(configuration)
    const cleanKey = apiKey?.trim()
    const secretName = SECRET_BY_CAPABILITY[parsed.id]
    const previousSecret =
      cleanKey !== undefined && cleanKey.length > 0
        ? await this.secrets.get(secretName)
        : null

    try {
      if (cleanKey !== undefined && cleanKey.length > 0) {
        await this.secrets.set(secretName, cleanKey)
      }
      await this.storage.upsertApiConfiguration(parsed)
    } catch (error) {
      if (cleanKey !== undefined && cleanKey.length > 0) {
        if (previousSecret === null) {
          await this.secrets.remove(secretName).catch(() => undefined)
        } else {
          await this.secrets
            .set(secretName, previousSecret)
            .catch(() => undefined)
        }
      }
      throw error
    }

    if (cleanKey !== undefined && cleanKey.length > 0) {
      this.secretPresence.set(parsed.id, true)
    }
    this.configurations.set(parsed.id, parsed)
    return this.getStatus(parsed.id)
  }

  async removeSecret(capability: ApiCapability): Promise<ApiCapabilityStatus> {
    apiCapabilitySchema.parse(capability)
    await this.secrets.remove(SECRET_BY_CAPABILITY[capability])
    this.secretPresence.set(capability, false)
    return this.getStatus(capability)
  }

  async delete(capability: ApiCapability): Promise<void> {
    apiCapabilitySchema.parse(capability)
    await this.secrets.remove(SECRET_BY_CAPABILITY[capability])
    await this.storage.deleteApiConfiguration(capability)
    this.secretPresence.set(capability, false)
    this.configurations.delete(capability)
  }

  async getSecret(capability: ApiCapability): Promise<string | null> {
    apiCapabilitySchema.parse(capability)
    if (!this.getStatus(capability).configured) {
      return null
    }
    return this.secrets.get(SECRET_BY_CAPABILITY[capability])
  }

  private async load(): Promise<void> {
    const configurations = await this.storage.listApiConfigurations()
    this.configurations.clear()
    for (const configuration of configurations) {
      this.configurations.set(configuration.id, configuration)
    }

    await Promise.all(
      (['text-ai', 'voice-ai', 'stt'] as const).map(async (capability) => {
        const secret = await this.secrets.get(SECRET_BY_CAPABILITY[capability])
        this.secretPresence.set(capability, Boolean(secret?.trim()))
      }),
    )
  }
}
