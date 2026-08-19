import {
  accountPinSchema,
  accountProfileSchema,
  DEFAULT_DISPLAY_NAME,
  LOCAL_DEFAULT_ACCOUNT_ID,
  LOCAL_DEFAULT_USER_ID,
  type AccountProfile,
} from '../domain/accounts'
import type { AccountStorage } from '../ports/accounts'

export interface AccountServiceOptions {
  storage: AccountStorage
  now?: () => Date
  createId?: () => string
}

/**
 * 本地简易账号服务。所有操作只写 IndexedDB,PIN 只保存 SHA-256 摘要。
 * 未来接云同步时,以 AccountProfile.userId 作为远端身份对齐键即可。
 */
export class AccountService {
  private readonly storage: AccountStorage
  private readonly now: () => Date
  private readonly createId: () => string
  private current: AccountProfile | null = null

  constructor(options: AccountServiceOptions) {
    this.storage = options.storage
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? createRandomId
  }

  /** 首次启动创建“本机用户”,并恢复上次登录的账号。 */
  async initialize(): Promise<AccountProfile> {
    let account = await this.storage.getAccount(LOCAL_DEFAULT_ACCOUNT_ID)
    if (account === null) {
      const timestamp = this.now().toISOString()
      account = accountProfileSchema.parse({
        id: LOCAL_DEFAULT_ACCOUNT_ID,
        userId: LOCAL_DEFAULT_USER_ID,
        displayName: DEFAULT_DISPLAY_NAME,
        pinHash: null,
        cloudAccountId: null,
        createdAt: timestamp,
        lastLoginAt: timestamp,
      })
      await this.storage.upsertAccount(account)
    }

    const storedCurrentId = await this.storage.getCurrentAccountId()
    const storedCurrent =
      storedCurrentId === null
        ? null
        : await this.storage.getAccount(storedCurrentId)
    this.current = storedCurrent ?? account
    if (this.current.id !== storedCurrentId) {
      await this.storage.setCurrentAccountId(this.current.id)
    }
    const touched = await this.touchLogin(this.current.id)
    if (touched !== null) {
      this.current = touched
    }
    return this.current
  }

  getCurrentAccount(): AccountProfile | null {
    return this.current
  }

  /** PracticeService / ImportService 写入数据时使用的 ownerId。 */
  getCurrentUserId(): string {
    return this.current?.userId ?? LOCAL_DEFAULT_USER_ID
  }

  async listAccounts(): Promise<AccountProfile[]> {
    const accounts = await this.storage.listAccounts()
    return accounts.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async createAccount(displayName: string, pin: string | null): Promise<AccountProfile> {
    const cleanName = displayName.trim()
    if (cleanName.length === 0) {
      throw new Error('请先填写昵称。')
    }
    if (cleanName.length > 40) {
      throw new Error('昵称最长 40 个字符。')
    }
    const cleanPin = pin === null || pin.trim().length === 0 ? null : pin.trim()
    if (cleanPin !== null) {
      accountPinSchema.parse(cleanPin)
    }
    const timestamp = this.now().toISOString()
    const userId = createStableUserId()
    const account = accountProfileSchema.parse({
      id: `account-${this.createId()}`,
      userId,
      displayName: cleanName,
      pinHash: cleanPin === null ? null : await hashPin(userId, cleanPin),
      cloudAccountId: null,
      createdAt: timestamp,
      lastLoginAt: timestamp,
    })
    await this.storage.upsertAccount(account)
    return account
  }

  async switchAccount(accountId: string, pin: string | null): Promise<AccountProfile> {
    const account = await this.storage.getAccount(accountId)
    if (account === null) {
      throw new Error('账号不存在，可能已被删除。')
    }
    if (account.pinHash !== null) {
      if (pin === null || pin.trim().length === 0) {
        throw new Error('该账号设置了本地 PIN，请输入后再切换。')
      }
      const cleanPin = pin.trim()
      accountPinSchema.parse(cleanPin)
      if ((await hashPin(account.userId, cleanPin)) !== account.pinHash) {
        throw new Error('PIN 不正确，无法切换账号。')
      }
    }

    const touched = await this.touchLogin(account.id)
    this.current = touched ?? account
    await this.storage.setCurrentAccountId(account.id)
    return this.current
  }

  /** 切回无需 PIN 的本机用户。 */
  async switchToDefault(): Promise<AccountProfile> {
    return this.switchAccount(LOCAL_DEFAULT_ACCOUNT_ID, null)
  }

  private async touchLogin(accountId: string): Promise<AccountProfile | null> {
    const account = await this.storage.getAccount(accountId)
    if (account === null) return null
    const touched = {
      ...account,
      lastLoginAt: this.now().toISOString(),
    }
    await this.storage.upsertAccount(touched)
    return touched
  }
}

function createRandomId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid !== undefined) {
    return uuid.toLowerCase()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function createStableUserId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid !== undefined) {
    return uuid.toLowerCase()
  }
  return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, '0')}`
}

async function hashPin(userId: string, pin: string): Promise<string> {
  const message = `ielts-speaking-meow:${userId}:${pin}`
  const subtle = globalThis.crypto?.subtle
  if (subtle !== undefined) {
    const bytes = new TextEncoder().encode(message)
    const digest = await subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  // 极旧 WebView 没有 WebCrypto 时的降级;仅用于本地误切换防护。
  let hash = 0x811c9dc5
  for (let index = 0; index < message.length; index += 1) {
    hash ^= message.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`
}
