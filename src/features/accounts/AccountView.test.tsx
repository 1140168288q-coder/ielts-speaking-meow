import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AccountService } from '../../application/accountService'
import type { AccountProfile } from '../../domain/accounts'
import type { AccountStorage } from '../../ports/accounts'
import { AccountView } from './AccountView'

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

async function createReadyService() {
  const service = new AccountService({ storage: new MemoryAccountStorage() })
  await service.initialize()
  return service
}

describe('AccountView', () => {
  it('creates a local account and switches back to the default user', async () => {
    const user = userEvent.setup()
    const service = await createReadyService()
    const onSwitched = vi.fn()

    render(<AccountView service={service} onSwitched={onSwitched} />)

    expect((await screen.findAllByText('本机游客')).length).toBeGreaterThan(0)

    await user.type(screen.getByLabelText('昵称'), '小明')
    await user.type(screen.getByLabelText('本地 PIN（可选，4-6 位数字）'), '1234')
    await user.click(screen.getByRole('button', { name: '创建本地账号' }))

    await waitFor(() => {
      expect(onSwitched).not.toHaveBeenCalled()
    })
    expect(await screen.findByText('账号已创建。切换到该账号后，练习和个人语料会从空白开始。')).toBeInTheDocument()

    const switchButtons = screen.getAllByRole('button', { name: '切换' })
    await user.click(switchButtons[switchButtons.length - 1]!)
    await user.type(screen.getByLabelText('输入该账号的 4-6 位 PIN'), '1234')
    await user.click(screen.getByRole('button', { name: '确认切换' }))

    await waitFor(() => {
      expect(onSwitched).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: '小明' }),
      )
    })
  })
})
