import type { SecretName, SecureSecretStorage } from '../../ports/ai'

/** Non-persistent browser development fallback; never writes credentials to disk. */
export class MemorySecureSecretStorage implements SecureSecretStorage {
  private readonly values = new Map<SecretName, string>()

  get(name: SecretName): Promise<string | null> {
    return Promise.resolve(this.values.get(name) ?? null)
  }

  set(name: SecretName, value: string): Promise<void> {
    const cleanValue = value.trim()
    if (cleanValue.length === 0) {
      return Promise.reject(new Error('An API key must not be empty.'))
    }
    this.values.set(name, cleanValue)
    return Promise.resolve()
  }

  remove(name: SecretName): Promise<void> {
    this.values.delete(name)
    return Promise.resolve()
  }
}
