import type { AccountProfile } from '../domain/accounts'

/** 本地账号的持久化边界;与练习数据分开,方便未来替换成云同步实现。 */
export interface AccountStorage {
  upsertAccount(account: AccountProfile): Promise<void>
  getAccount(accountId: string): Promise<AccountProfile | null>
  listAccounts(): Promise<AccountProfile[]>
  getCurrentAccountId(): Promise<string | null>
  setCurrentAccountId(accountId: string): Promise<void>
}
