import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AuthTokenStore,
  CloudAccountSession,
  CloudAuthGateway,
} from '../../domain/cloudAccount'
import { CloudAccountPanel } from './CloudAccountPanel'

const session: CloudAccountSession = {
  expiresAt: '2026-09-20T08:00:00+00:00',
  user: {
    id: 'user-1',
    email: 'learner@example.com',
    emailVerified: true,
    createdAt: '2026-08-21T08:00:00+00:00',
  },
}

const tokenStore: AuthTokenStore = {
  getToken: vi.fn().mockResolvedValue(null),
  setToken: vi.fn().mockResolvedValue(undefined),
  clearToken: vi.fn().mockResolvedValue(undefined),
}

function gateway(overrides: Partial<CloudAuthGateway> = {}): CloudAuthGateway {
  return {
    register: vi.fn().mockResolvedValue(session),
    login: vi.fn().mockResolvedValue(session),
    restoreSession: vi.fn().mockResolvedValue(null),
    logout: vi.fn().mockResolvedValue(undefined),
    requestEmailVerification: vi.fn().mockResolvedValue(undefined),
    confirmEmailVerification: vi.fn().mockResolvedValue(session),
    requestPasswordReset: vi.fn().mockResolvedValue(undefined),
    confirmPasswordReset: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('CloudAccountPanel', () => {
  it('restores an existing cloud session and logs out', async () => {
    const user = userEvent.setup()
    const logout = vi.fn().mockResolvedValue(undefined)
    const client = gateway({
      restoreSession: vi.fn().mockResolvedValue(session),
      logout,
    })
    const onSessionChange = vi.fn()

    render(
      <CloudAccountPanel
        client={client}
        tokenStore={tokenStore}
        onSessionChange={onSessionChange}
      />,
    )

    expect(await screen.findByText('learner@example.com')).toBeInTheDocument()
    expect(onSessionChange).toHaveBeenCalledWith(session)
    await user.click(screen.getByRole('button', { name: '退出云账号' }))
    expect(await screen.findByRole('button', { name: '登录云账号' })).toBeInTheDocument()
    expect(logout).toHaveBeenCalledWith(tokenStore)
  })

  it('logs in with the injected client and token store', async () => {
    const user = userEvent.setup()
    const login = vi.fn().mockResolvedValue(session)
    const client = gateway({ login })
    render(<CloudAccountPanel client={client} tokenStore={tokenStore} />)

    await screen.findByRole('button', { name: '登录云账号' })
    await user.type(screen.getByLabelText('邮箱'), 'learner@example.com')
    await user.type(screen.getByLabelText('密码'), 'correct password')
    await user.click(screen.getByRole('button', { name: '登录云账号' }))

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        email: 'learner@example.com',
        password: 'correct password',
      }, tokenStore)
    })
    expect(await screen.findByText('learner@example.com')).toBeInTheDocument()
  })

  it('validates password confirmation before registration', async () => {
    const user = userEvent.setup()
    const register = vi.fn().mockResolvedValue(session)
    const client = gateway({ register })
    render(<CloudAccountPanel client={client} tokenStore={tokenStore} />)

    await screen.findByRole('button', { name: '登录云账号' })
    await user.click(screen.getByRole('tab', { name: '注册' }))
    await user.type(screen.getByLabelText('邮箱'), 'learner@example.com')
    await user.type(screen.getByLabelText('新密码'), 'correct password')
    await user.type(screen.getByLabelText('再次输入新密码'), 'different password')
    await user.click(screen.getByRole('button', { name: '创建云账号' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('两次输入的密码不一致。')
    expect(register).not.toHaveBeenCalled()
  })

  it('clearly separates cloud identity from local profiles', async () => {
    render(<CloudAccountPanel client={gateway()} tokenStore={tokenStore} />)
    expect(await screen.findByText(/登录不会把手机里的数据直接上传/)).toBeInTheDocument()
    expect(screen.getByText(/明确允许同步范围后启用/)).toBeInTheDocument()
  })

  it('uses a generic forgot-password response and confirms the new password', async () => {
    const user = userEvent.setup()
    const requestPasswordReset = vi.fn().mockResolvedValue(undefined)
    const confirmPasswordReset = vi.fn().mockResolvedValue(undefined)
    render(
      <CloudAccountPanel
        client={gateway({ requestPasswordReset, confirmPasswordReset })}
        tokenStore={tokenStore}
      />,
    )

    await screen.findByRole('button', { name: '登录云账号' })
    await user.click(screen.getByRole('button', { name: '忘记密码？' }))
    await user.type(screen.getByLabelText('邮箱'), 'learner@example.com')
    await user.click(screen.getByRole('button', { name: '发送重置邮件' }))

    expect(await screen.findByText(/如果该邮箱已注册/)).toBeInTheDocument()
    expect(requestPasswordReset).toHaveBeenCalledWith('learner@example.com', tokenStore)
    await user.type(screen.getByLabelText('邮件中的重置凭证'), 'r'.repeat(43))
    await user.type(screen.getByLabelText('新密码'), 'new correct password')
    await user.type(screen.getByLabelText('再次输入新密码'), 'new correct password')
    await user.click(screen.getByRole('button', { name: '更新密码' }))

    await waitFor(() => {
      expect(confirmPasswordReset).toHaveBeenCalledWith(
        'r'.repeat(43),
        'new correct password',
        tokenStore,
      )
    })
    expect(await screen.findByText(/其他设备上的旧登录状态已失效/)).toBeInTheDocument()
  })

  it('shows a verification action for an unverified signed-in email', async () => {
    const user = userEvent.setup()
    const unverified = {
      ...session,
      user: { ...session.user, emailVerified: false },
    }
    const verified = {
      ...session,
      user: { ...session.user, emailVerified: true },
    }
    const requestEmailVerification = vi.fn().mockResolvedValue(undefined)
    const confirmEmailVerification = vi.fn().mockResolvedValue(verified)
    render(
      <CloudAccountPanel
        client={gateway({
          restoreSession: vi.fn().mockResolvedValue(unverified),
          requestEmailVerification,
          confirmEmailVerification,
        })}
        tokenStore={tokenStore}
      />,
    )

    expect(await screen.findByText('需要验证邮箱')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '发送验证邮件' }))
    expect(requestEmailVerification).toHaveBeenCalledWith(tokenStore)
    await user.type(screen.getByLabelText('验证凭证'), 'v'.repeat(43))
    await user.click(screen.getByRole('button', { name: '确认验证' }))
    expect(await screen.findByText('邮箱已验证')).toBeInTheDocument()
    expect(confirmEmailVerification).toHaveBeenCalledWith('v'.repeat(43), tokenStore)
  })

  it('opens an emailed reset link with its token prefilled and removes it from the URL', async () => {
    window.history.replaceState(
      {},
      '',
      `/?action=reset-password&token=${'r'.repeat(43)}`,
    )
    render(<CloudAccountPanel client={gateway()} tokenStore={tokenStore} />)

    const field = await screen.findByLabelText('邮件中的重置凭证')
    expect(field).toHaveValue('r'.repeat(43))
    expect(window.location.search).toBe('')
  })

  it('confirms an emailed verification link without requiring an existing login', async () => {
    const user = userEvent.setup()
    const confirmEmailVerification = vi.fn().mockResolvedValue(null)
    window.history.replaceState(
      {},
      '',
      `/?action=verify-email&token=${'v'.repeat(43)}`,
    )
    render(
      <CloudAccountPanel
        client={gateway({ confirmEmailVerification })}
        tokenStore={tokenStore}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '完成邮箱验证' }))
    expect(confirmEmailVerification).toHaveBeenCalledWith('v'.repeat(43), tokenStore)
    expect(await screen.findByText('邮箱验证完成，请登录云账号。')).toBeInTheDocument()
  })
})
