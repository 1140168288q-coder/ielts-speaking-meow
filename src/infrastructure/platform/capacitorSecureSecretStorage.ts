import { registerPlugin } from '@capacitor/core'
import type {
  SecretName,
  SecureSecretStorage,
} from '../../ports/ai'

export interface SecureSecretsPluginContract {
  get(options: { name: SecretName }): Promise<{ value: string | null }>
  set(options: { name: SecretName; value: string }): Promise<void>
  remove(options: { name: SecretName }): Promise<void>
}

const nativeSecureSecrets = registerPlugin<SecureSecretsPluginContract>(
  'SecureSecrets',
)

/** Android-only secure storage. It deliberately has no browser-storage fallback. */
export class CapacitorSecureSecretStorage implements SecureSecretStorage {
  constructor(
    private readonly plugin: SecureSecretsPluginContract = nativeSecureSecrets,
  ) {}

  async get(name: SecretName): Promise<string | null> {
    const result = await this.plugin.get({ name })
    if (result.value !== null && typeof result.value !== 'string') {
      throw new Error('Secure secret storage returned an invalid response.')
    }
    return result.value
  }

  async set(name: SecretName, value: string): Promise<void> {
    if (value.trim().length === 0) {
      throw new Error('An API key must not be empty.')
    }
    await this.plugin.set({ name, value })
  }

  async remove(name: SecretName): Promise<void> {
    await this.plugin.remove({ name })
  }
}
