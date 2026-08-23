import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

const { cloudSession, runtimeFixture, syncConstructor, syncRun } = vi.hoisted(() => {
  const verifiedSession = {
    expiresAt: '2026-09-20T08:00:00+00:00',
    user: {
      id: 'cloud-user-1',
      email: 'learner@example.com',
      emailVerified: true,
      createdAt: '2026-08-21T08:00:00+00:00',
    },
  }
  const synchronize = vi.fn().mockResolvedValue({
    status: 'synced',
    downloaded: 2,
    queued: 3,
    uploaded: 3,
    conflicts: [],
  })
  const constructor = vi.fn().mockImplementation(() => ({
    synchronize,
  }))
  const runtime = {
    initialize: vi.fn().mockResolvedValue(undefined),
    accountService: {
      getCurrentAccount: vi.fn().mockReturnValue({
        id: 'local-user',
        displayName: '本机用户',
        pinHash: null,
        createdAt: '2026-08-21T08:00:00+00:00',
      }),
      getCurrentUserId: vi.fn().mockReturnValue('local-user'),
    },
    practiceService: {
      listSessions: vi.fn().mockResolvedValue([]),
      listExpressions: vi.fn().mockResolvedValue([]),
    },
    personalMaterialService: {
      list: vi.fn().mockResolvedValue([]),
    },
    storage: {
      listImportedQuestions: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    },
    audioFocus: {
      state: 'idle',
      stopAllPlayback: vi.fn().mockResolvedValue(undefined),
    },
    healthCache: {
      refresh: vi.fn().mockResolvedValue({ health: null }),
    },
    cloudAuthClient: {
      restoreSession: vi.fn().mockResolvedValue(null),
    },
    authTokenStore: {
      getToken: vi.fn().mockResolvedValue('token'),
    },
    cloudSyncClient: {},
    configStore: {
      getBaseUrl: vi.fn().mockReturnValue('http://127.0.0.1:8000'),
    },
    textAi: {},
    voiceAi: {},
    systemTts: {},
    backupService: {},
    importService: {},
  }
  return {
    cloudSession: verifiedSession,
    runtimeFixture: runtime,
    syncConstructor: constructor,
    syncRun: synchronize,
  }
})

vi.mock('./app/runtime', () => ({
  createBrowserRuntime: () => runtimeFixture,
}))

vi.mock('./application/accountCloudSyncService', () => ({
  AccountCloudSyncService: syncConstructor,
}))

vi.mock('./features/accounts', () => ({
  AccountView: ({ cloudPanel }: { cloudPanel: ReactNode }) => (
    <section>
      <h1>账号与同步</h1>
      {cloudPanel}
    </section>
  ),
  CloudAccountPanel: ({
    onSessionChange,
  }: {
    onSessionChange: (session: typeof cloudSession | null) => void
  }) => (
    <button type="button" onClick={() => onSessionChange(cloudSession)}>
      模拟验证云账号
    </button>
  ),
}))

describe('App cloud sync integration', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn()
    syncConstructor.mockClear()
    syncConstructor.mockImplementation(() => ({ synchronize: syncRun }))
    syncRun.mockClear()
    syncRun.mockResolvedValue({
      status: 'synced',
      downloaded: 2,
      queued: 3,
      uploaded: 3,
      conflicts: [],
    })
    runtimeFixture.initialize.mockResolvedValue(undefined)
    runtimeFixture.accountService.getCurrentAccount.mockReturnValue({
      id: 'local-user',
      displayName: '本机用户',
      pinHash: null,
      createdAt: '2026-08-21T08:00:00+00:00',
    })
    runtimeFixture.accountService.getCurrentUserId.mockReturnValue('local-user')
    runtimeFixture.practiceService.listSessions.mockResolvedValue([])
    runtimeFixture.practiceService.listExpressions.mockResolvedValue([])
    runtimeFixture.personalMaterialService.list.mockResolvedValue([])
    runtimeFixture.storage.listImportedQuestions.mockResolvedValue([])
    runtimeFixture.storage.close.mockResolvedValue(undefined)
    runtimeFixture.audioFocus.stopAllPlayback.mockResolvedValue(undefined)
    runtimeFixture.healthCache.refresh.mockResolvedValue({ health: null })
    runtimeFixture.cloudAuthClient.restoreSession.mockResolvedValue(null)
    runtimeFixture.authTokenStore.getToken.mockResolvedValue('token')
    runtimeFixture.configStore.getBaseUrl.mockReturnValue('http://127.0.0.1:8000')
  })

  it('only constructs and runs account sync after explicit confirmation', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '打开账号页' }))
    await user.click(await screen.findByRole('button', { name: '模拟验证云账号' }))

    const syncButton = await screen.findByRole('button', { name: '确认并开始同步' })
    expect(syncButton).toBeDisabled()
    expect(syncConstructor).not.toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox'))
    await user.click(syncButton)

    expect(syncConstructor).toHaveBeenCalledWith({
      scopeId: 'cloud-user-1',
      ownerId: 'local-user',
      storage: runtimeFixture.storage,
      gateway: runtimeFixture.cloudSyncClient,
    })
    expect(syncRun).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('同步完成：上传 3 项，恢复或更新 2 项。')).toBeInTheDocument()
  })

  it('keeps the local retry path visible when the cloud request fails', async () => {
    const user = userEvent.setup()
    syncRun.mockRejectedValueOnce(new Error('网络暂时不可用'))
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '打开账号页' }))
    await user.click(screen.getByRole('button', { name: '模拟验证云账号' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(await screen.findByRole('button', { name: '确认并开始同步' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '网络暂时不可用 本机资料与待同步项目仍保留，可稍后重试。',
    )
  })
})
