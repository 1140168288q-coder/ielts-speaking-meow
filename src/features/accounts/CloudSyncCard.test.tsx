import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CloudSyncCard } from './CloudSyncCard'

describe('CloudSyncCard', () => {
  it('requires explicit confirmation before a verified account can sync', async () => {
    const user = userEvent.setup()
    const onSync = vi.fn()
    render(
      <CloudSyncCard
        status="idle"
        message="尚未同步。"
        destination="cloud.example.com"
        emailVerified
        onSync={onSync}
      />,
    )

    const button = screen.getByRole('button', { name: '确认并开始同步' })
    expect(button).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(button).toBeEnabled()
    await user.click(button)
    expect(onSync).toHaveBeenCalledTimes(1)
  })

  it('keeps synchronization disabled until the email is verified', () => {
    render(
      <CloudSyncCard
        status="idle"
        message="请先验证邮箱。"
        destination="cloud.example.com"
        emailVerified={false}
        onSync={vi.fn()}
      />,
    )

    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认并开始同步' })).toBeDisabled()
    expect(screen.getByText(/未提交草稿/)).toBeInTheDocument()
  })
})
