import { describe, expect, it } from 'vitest'
import { AccountService } from './accountService'
import {
  DEFAULT_DISPLAY_NAME,
  LOCAL_DEFAULT_ACCOUNT_ID,
  LOCAL_DEFAULT_USER_ID,
  type AccountProfile,
} from '../domain/accounts'
import type { AccountStorage } from '../ports/accounts'

class MemoryAccountStorage implements AccountStorage {
  accounts = new Map<string, AccountProfile>()
  currentId: string | null = null

  async upsertAccount(account: AccountProfile): Promise<void> {
    await Promise.resolve()
    this.accounts.set(account.id, structuredClone(account))
  }

  async getAccount(accountId: string): Promise<AccountProfile | null> {
    await Promise.resolve()
    const account = this.accounts.get(accountId)
    return account ? structuredClone(account) : null
  }

  async listAccounts(): Promise<AccountProfile[]> {
    await Promise.resolve()
    return [...this.accounts.values()].map((account) => structuredClone(account))
  }

  async getCurrentAccountId(): Promise<string | null> {
    await Promise.resolve()
    return this.currentId
  }

  async setCurrentAccountId(accountId: string): Promise<void> {
    await Promise.resolve()
    this.currentId = accountId
  }
}

function createService(storage = new MemoryAccountStorage()) {
  let counter = 0
  return new AccountService({
    storage,
    now: () => new Date('2026-08-19T08:00:00.000Z'),
    createId: () => `local-${++counter}`,
  })
}

describe('AccountService', () => {
  it('creates the default local account and owns legacy data by default userId', async () => {
    const storage = new MemoryAccountStorage()
    const service = createService(storage)

    const account = await service.initialize()

    expect(account.displayName).toBe(DEFAULT_DISPLAY_NAME)
    expect(account.userId).toBe(LOCAL_DEFAULT_USER_ID)
    expect(service.getCurrentUserId()).toBe(LOCAL_DEFAULT_USER_ID)
    expect(storage.currentId).toBe(LOCAL_DEFAULT_ACCOUNT_ID)
  })

  it('creates a named account with an optional local PIN and switches to it', async () => {
    const storage = new MemoryAccountStorage()
    const service = createService(storage)
    await service.initialize()

    const created = await service.createAccount('小明', '1234')
    expect(created.displayName).toBe('小明')
    expect(created.pinHash).not.toBeNull()

    await expect(service.switchAccount(created.id, '0000')).rejects.toThrow('PIN')
    const current = await service.switchAccount(created.id, '1234')
    expect(service.getCurrentUserId()).toBe(current.userId)
    expect(storage.currentId).toBe(created.id)

    const restored = createService(storage)
    const restoredAccount = await restored.initialize()
    expect(restoredAccount.id).toBe(created.id)
  })

  it('allows PIN-less switching and keeps account identities stable for future sync', async () => {
    const storage = new MemoryAccountStorage()
    const service = createService(storage)
    await service.initialize()
    const created = await service.createAccount('妈妈', null)

    const current = await service.switchAccount(created.id, null)

    expect(service.getCurrentUserId()).toBe(current.userId)
    expect(current.userId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('persists one-to-one cloud bindings and blocks A logout to B account mixing', async () => {
    const storage = new MemoryAccountStorage()
    const service = createService(storage)
    const localA = await service.initialize()

    const boundA = await service.bindCurrentAccountToCloud('cloud-a')
    expect(boundA.cloudAccountId).toBe('cloud-a')
    await expect(service.bindCurrentAccountToCloud('cloud-b')).rejects.toThrow(
      '已绑定另一个云账号',
    )

    const localB = await service.createAccount('本地 B', null)
    await service.switchAccount(localB.id, null)
    await expect(service.bindCurrentAccountToCloud('cloud-a')).rejects.toThrow(
      `已绑定本机资料身份“${localA.displayName}”`,
    )
    await expect(service.bindCurrentAccountToCloud('cloud-b')).resolves.toMatchObject({
      id: localB.id,
      cloudAccountId: 'cloud-b',
    })

    const restored = createService(storage)
    await restored.initialize()
    expect(restored.getCurrentAccount()?.cloudAccountId).toBe('cloud-b')
  })
})
