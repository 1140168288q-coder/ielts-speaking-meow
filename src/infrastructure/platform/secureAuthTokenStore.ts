import { registerPlugin } from '@capacitor/core'
import type { AuthTokenStore } from '../../domain/cloudAccount'

export interface SecureSessionPluginContract {
  getToken(): Promise<{ token: string | null }>
  setToken(options: { token: string }): Promise<void>
  clearToken(): Promise<void>
}

const nativeSecureSession = registerPlugin<SecureSessionPluginContract>('SecureSession')

/** Android session-token storage backed by AES-GCM and Android Keystore. */
export class CapacitorSecureAuthTokenStore implements AuthTokenStore {
  constructor(
    private readonly plugin: SecureSessionPluginContract = nativeSecureSession,
  ) {}

  async getToken(): Promise<string | null> {
    const result = await this.plugin.getToken()
    return typeof result.token === 'string' && result.token.length > 0
      ? result.token
      : null
  }

  async setToken(token: string): Promise<void> {
    const clean = token.trim()
    if (clean.length === 0) throw new Error('云端登录凭证不能为空。')
    await this.plugin.setToken({ token: clean })
  }

  async clearToken(): Promise<void> {
    await this.plugin.clearToken()
  }
}
