import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  AuthTokenStore,
  CloudAccountOverview,
  CloudAccountSession,
  CloudAuthGateway,
} from '../../domain/cloudAccount'
import { CloudAccountManagement } from './CloudAccountManagement'

const session: CloudAccountSession = {
  expiresAt: '2026-09-20T08:00:00+00:00',
  user: {
    id: 'user-1',
    email: 'learner@example.com',
    displayName: 'Mia',
    status: 'active',
    emailVerified: true,
    createdAt: '2026-08-21T08:00:00+00:00',
    updatedAt: '2026-08-24T08:00:00+00:00',
  },
}

const overview: CloudAccountOverview = {
  user: session.user,
  billing: {
    plan: 'free',
    subscriptionStatus: 'none',
    currentPeriodEnd: null,
  },
  capabilities: {
    feedback: {
      enabled: true,
      source: 'plan:free',
      reason: null,
      quotaLimit: 30,
      quotaUsed: 4,
      quotaRemaining: 26,
      period: 'month',
      unit: 'request',
      resetsAt: '2026-09-01T00:00:00+00:00',
    },
    tts: {
      enabled: true,
      source: 'plan:free',
      reason: null,
      quotaLimit: 10000,
      quotaUsed: 1250,
      quotaRemaining: 8750,
      period: 'month',
      unit: 'character',
      resetsAt: '2026-09-01T00:00:00+00:00',
    },
    sync: {
      enabled: true,
      source: 'plan:free',
      reason: null,
      quotaLimit: null,
      quotaUsed: 0,
      quotaRemaining: null,
      period: 'month',
      unit: 'request',
      resetsAt: '2026-09-01T00:00:00+00:00',
    },
  },
}

const tokenStore: AuthTokenStore = {
  getToken: vi.fn().mockResolvedValue('token'),
  setToken: vi.fn().mockResolvedValue(undefined),
  clearToken: vi.fn().mockResolvedValue(undefined),
}

function gateway(overrides: Partial<CloudAuthGateway>): CloudAuthGateway {
  return {
    register: vi.fn(),
    login: vi.fn(),
    restoreSession: vi.fn(),
    logout: vi.fn(),
    requestEmailVerification: vi.fn(),
    confirmEmailVerification: vi.fn(),
    requestPasswordReset: vi.fn(),
    confirmPasswordReset: vi.fn(),
    ...overrides,
  }
}

describe('CloudAccountManagement', () => {
  it('shows the current plan and updates the display name', async () => {
    const user = userEvent.setup()
    const updateProfile = vi.fn().mockResolvedValue({
      ...overview,
      user: { ...overview.user, displayName: 'Mia Chen' },
    })
    const onSessionUpdated = vi.fn<(next: CloudAccountSession) => void>()

    render(
      <CloudAccountManagement
        client={gateway({
          getAccountOverview: vi.fn().mockResolvedValue(overview),
          updateProfile,
        })}
        tokenStore={tokenStore}
        session={session}
        onSessionUpdated={onSessionUpdated}
        onSignedOut={vi.fn()}
      />,
    )

    expect(await screen.findByRole('heading', { name: '免费版' })).toBeInTheDocument()
    expect(screen.getByText('4 / 30 次')).toBeInTheDocument()
    expect(screen.getAllByText('不限量').length).toBeGreaterThan(0)

    const name = screen.getByLabelText('昵称')
    await user.clear(name)
    await user.type(name, 'Mia Chen')
    await user.click(screen.getByRole('button', { name: '保存云端资料' }))

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith('Mia Chen', tokenStore)
    })
    expect(onSessionUpdated.mock.calls[0]?.[0].user.displayName).toBe('Mia Chen')
    expect(await screen.findByText('云账号资料已更新。')).toBeInTheDocument()
  })

  it('requires password and explicit confirmation before permanent deletion', async () => {
    const user = userEvent.setup()
    const deleteAccount = vi.fn().mockResolvedValue(undefined)
    const onSignedOut = vi.fn()

    render(
      <CloudAccountManagement
        client={gateway({
          getAccountOverview: vi.fn().mockResolvedValue(overview),
          deleteAccount,
        })}
        tokenStore={tokenStore}
        session={session}
        onSessionUpdated={vi.fn()}
        onSignedOut={onSignedOut}
      />,
    )

    await screen.findByRole('heading', { name: '免费版' })
    await user.click(screen.getByText('账号安全与删除'))
    const deleteButton = screen.getByRole('button', { name: '永久删除云账号' })
    expect(deleteButton).toBeDisabled()

    await user.type(screen.getByLabelText('当前密码'), 'correct password')
    await user.click(screen.getByRole('checkbox', {
      name: /我理解云端个人资料将永久删除/,
    }))
    expect(deleteButton).toBeEnabled()
    await user.click(deleteButton)

    expect(deleteAccount).toHaveBeenCalledWith('correct password', tokenStore)
    expect(onSignedOut).toHaveBeenCalledWith(expect.stringContaining('云端个人资料已删除'))
  })
})
