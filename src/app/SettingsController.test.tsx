import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  BackendConfigStore,
  BackendHealthCache,
  BackendHealthSnapshot,
} from '../infrastructure/backend'
import { makeBackendHealth, makeProviderHealth } from '../test/fixtures/backendHealth'
import type {
  SystemTTSProvider,
  SystemTtsStatus,
  TTSProvider,
} from '../ports/speech'
import type { LocalDataMaintenance } from '../ports/storage'
import type { StorageBackupService } from '../application/storageBackupService'
import { SettingsController } from './SettingsController'

type HealthPayload = ReturnType<typeof makeBackendHealth>

function createHarness(options: {
  health?: HealthPayload
  healthError?: Error
  saved?: { baseUrl: string } | null
  locked?: boolean
  systemTtsStatus?: SystemTtsStatus
  preferredVoiceAvailable?: boolean
} = {}) {
  const getHealth = vi.fn<() => Promise<HealthPayload>>().mockImplementation(() =>
    options.healthError !== undefined
      ? Promise.reject(options.healthError)
      : Promise.resolve(options.health ?? makeBackendHealth({})),
  )

  let health: HealthPayload | null = null
  let failure: string | null = null
  let checkedAt = 0
  const refreshHealth = vi.fn().mockImplementation(async () => {
    try {
      health = await getHealth()
      failure = null
    } catch (error) {
      health = null
      failure = error instanceof Error ? error.message : '云端服务不可用。'
    }
    checkedAt = Date.now()
    return { checkedAt, health, failure } satisfies BackendHealthSnapshot
  })
  const invalidateHealth = vi.fn()
  const verifyProviders = vi.fn().mockImplementation(refreshHealth)
  const healthCache = {
    getSnapshot: () => ({ checkedAt, health, failure }) satisfies BackendHealthSnapshot,
    statusOf: (name: 'deepseek' | 'volc_tts') =>
      health?.providers[name]?.configured === true ? 'configured' as const : 'unknown' as const,
    providerInfo: (name: 'deepseek' | 'volc_tts') =>
      health?.providers[name] ?? null,
    verificationOf: (name: 'deepseek' | 'volc_tts') =>
      health?.providers[name]?.verification ?? null,
    refresh: refreshHealth,
    invalidate: invalidateHealth,
    verifyProviders,
  } as unknown as BackendHealthCache

  const saveConfig = vi.fn().mockResolvedValue(undefined)
  const locked = options.locked ?? false
  const configStore = {
    getBaseUrl: () => options.saved?.baseUrl ?? 'https://fixed.example.com',
    isLocked: () => locked,
    save: saveConfig,
    load: vi.fn().mockResolvedValue(undefined),
  } as unknown as BackendConfigStore

  const systemTtsSpeak = vi.fn().mockResolvedValue(undefined)
  const systemTts: SystemTTSProvider = {
    id: 'system-tts',
    isAvailable: () => true,
    capabilities: {
      language: true,
      voice: false,
      rate: true,
      pitch: true,
      style: false,
    },
    getStatus: vi.fn().mockResolvedValue(options.systemTtsStatus ?? {
      available: true,
      engine: 'com.google.android.tts',
      engines: [{ name: 'com.google.android.tts', label: 'Google 语音服务' }],
      englishAvailable: true,
    }),
    speak: systemTtsSpeak,
    stop: vi.fn().mockResolvedValue(undefined),
  }
  const preferredVoiceSpeak = vi.fn().mockResolvedValue(undefined)
  const preferredVoice: TTSProvider = {
    id: 'backend-tts',
    isAvailable: () => options.preferredVoiceAvailable ?? true,
    capabilities: {
      language: true,
      voice: false,
      rate: true,
      pitch: true,
      style: false,
    },
    speak: preferredVoiceSpeak,
    stop: vi.fn().mockResolvedValue(undefined),
  }
  const dataMaintenance = {
    getStorageUsage: vi.fn().mockResolvedValue({
      sessions: 0,
      expressions: 0,
      recordings: 0,
      importSources: 0,
      importedQuestions: 0,
      importedFiles: 0,
      ttsCacheEntries: 0,
      audioBytes: 0,
      importedFileBytes: 0,
      ttsCacheBytes: 0,
      estimatedTotalBytes: 0,
    }),
    deleteSessionWithAudio: vi.fn(),
    clearTtsCache: vi.fn().mockResolvedValue(0),
  } as unknown as LocalDataMaintenance
  const backupService = {
    exportBackup: vi.fn(),
    importBackup: vi.fn(),
  } as unknown as StorageBackupService
  const onDataChanged = vi.fn().mockResolvedValue(undefined)
  return {
    healthCache,
    configStore,
    systemTts,
    systemTtsSpeak,
    preferredVoice,
    preferredVoiceSpeak,
    refreshHealth,
    verifyProviders,
    saveConfig,
    invalidateHealth,
    dataMaintenance,
    backupService,
    onDataChanged,
  }
}

describe('SettingsController', () => {
  it('shows the fixed backend address read-only in locked builds, without any input or save button', async () => {
    const user = userEvent.setup()
    const harness = createHarness({ locked: true })
    render(<SettingsController {...harness} />)
    await user.click(screen.getByText('高级连接设置'))
    expect(screen.getByText(/https:\/\/fixed\.example\.com/)).toBeTruthy()
    expect(screen.getByText(/正式版本地址已固定/)).toBeTruthy()
    expect(screen.queryByLabelText('Backend 地址')).toBeNull()
    expect(screen.queryByRole('button', { name: /保存配置/ })).toBeNull()
    await waitFor(() => expect(harness.refreshHealth).toHaveBeenCalled())
  })

  it('keeps an editable address input in unlocked (debug) builds', async () => {
    const user = userEvent.setup()
    const harness = createHarness({ locked: false })
    render(<SettingsController {...harness} />)
    await waitFor(() => expect(harness.refreshHealth).toHaveBeenCalled())
    await user.click(screen.getByText('高级连接设置'))

    const address = screen.getByLabelText('Backend 地址')
    await user.clear(address)
    await user.type(address, 'http://192.168.1.50:8000')
    await user.click(screen.getByRole('button', { name: /保存服务地址/ }))

    await waitFor(() => {
      expect(harness.saveConfig).toHaveBeenCalledWith('http://192.168.1.50:8000')
    })
    expect(harness.invalidateHealth).toHaveBeenCalled()
  })

  it('lists model, speaker and real verification states without any STT row', async () => {
    const harness = createHarness({
      health: makeBackendHealth({
        deepseek: makeProviderHealth({
          model: 'deepseek-v4-flash',
          verification: {
            status: 'verified',
            checkedAt: '2026-08-15T08:00:00.000Z',
            latencyMs: 300,
            lastError: null,
            lastResult: null,
          },
        }),
        volc_tts: makeProviderHealth({
          speaker: { id: 'zh_female_vv_uranus_bigtts', name: 'vivi 2.0' },
        }),
      }),
    })
    const user = userEvent.setup()
    render(<SettingsController {...harness} />)
    await user.click(screen.getByText('高级连接设置'))
    await waitFor(() => {
      expect(screen.getByText(/deepseek-v4-flash/)).toBeTruthy()
      expect(screen.getAllByText(/已验证/).length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText(/vivi 2\.0/)).toBeTruthy()
    })
    expect(screen.queryByText(/火山流式语音识别/)).toBeNull()
    expect(screen.getByText(/服务版本：1\.8\.0/)).toBeTruthy()
  })

  it('shows 验证失败 instead of 已连接 when a provider verification failed', async () => {
    const harness = createHarness({
      health: makeBackendHealth({
        deepseek: true,
        volc_tts: makeProviderHealth({
          verification: {
            status: 'failed',
            checkedAt: '2026-08-15T08:00:00.000Z',
            latencyMs: null,
            lastError: '火山 TTS:无权限访问(403)。',
            lastResult: null,
          },
        }),
      }),
    })
    const user = userEvent.setup()
    render(<SettingsController {...harness} />)
    await user.click(screen.getByText('高级连接设置'))
    await waitFor(() => {
      expect(screen.getByText(/验证失败/)).toBeTruthy()
      expect(screen.getByText(/无权限访问\(403\)/)).toBeTruthy()
    })
  })

  it('checks the cloud backend on demand and lists provider status', async () => {
    const user = userEvent.setup()
    const harness = createHarness({
      health: makeBackendHealth({ deepseek: true, volc_tts: false }),
    })
    render(<SettingsController {...harness} />)
    await waitFor(() => expect(harness.refreshHealth).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /重新检查连接/ }))
    expect(await screen.findByText(/连接正常/)).toBeTruthy()
    expect(harness.refreshHealth).toHaveBeenCalledTimes(2)
  })

  it('surfaces backend connection failures with the failure message', async () => {
    const user = userEvent.setup()
    const harness = createHarness({
      healthError: new Error('网络连接失败,请检查网络后重试。'),
    })
    render(<SettingsController {...harness} />)
    await waitFor(() => expect(harness.refreshHealth).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /重新检查连接/ }))
    expect(await screen.findByText(/网络连接失败/)).toBeTruthy()
    expect(screen.getByText(/离线/)).toBeTruthy()
  })

  it('runs real upstream verification on demand', async () => {
    const user = userEvent.setup()
    const harness = createHarness({
      health: makeBackendHealth({ deepseek: true, volc_tts: true }),
    })
    render(<SettingsController {...harness} />)
    await waitFor(() => expect(harness.refreshHealth).toHaveBeenCalled())
    await user.click(screen.getByText('高级连接设置'))
    await user.click(screen.getByRole('button', { name: /验证上游服务/ }))
    await waitFor(() => expect(harness.verifyProviders).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/上游验证通过/)).toBeTruthy()
  })

  it('tests the system TTS directly through the system provider', async () => {
    const user = userEvent.setup()
    const harness = createHarness()
    render(<SettingsController {...harness} />)
    await waitFor(() => expect(harness.refreshHealth).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /测试系统朗读/ }))
    expect(harness.systemTtsSpeak).toHaveBeenCalledWith({
      text: 'System voice is ready.',
      language: 'en-US',
    })
    expect(await screen.findByText(/播放完成/)).toBeTruthy()
  })

  it('warns about a missing English voice pack instead of playing silently', async () => {
    const user = userEvent.setup()
    const harness = createHarness({
      systemTtsStatus: {
        available: true,
        engine: 'com.google.android.tts',
        engines: [],
        englishAvailable: false,
      },
    })
    render(<SettingsController {...harness} />)
    await waitFor(() => expect(harness.refreshHealth).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /测试系统朗读/ }))
    expect(harness.systemTtsSpeak).not.toHaveBeenCalled()
    expect(await screen.findByText(/未检测到英语语音包/)).toBeTruthy()
  })

  it('previews the cloud voice only when it is actually available', async () => {
    const user = userEvent.setup()
    const harness = createHarness({
      health: makeBackendHealth({ volc_tts: true }),
      preferredVoiceAvailable: false,
    })
    render(<SettingsController {...harness} />)
    await waitFor(() => expect(harness.refreshHealth).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /试听自然音色/ }))
    expect(harness.preferredVoiceSpeak).not.toHaveBeenCalled()
    expect(await screen.findByText(/正在使用系统朗读/)).toBeTruthy()
  })

  it('saves custom home greeting text on blur and can restore defaults', async () => {
    const user = userEvent.setup()
    const onPreferencesChange = vi.fn().mockResolvedValue(undefined)
    const harness = createHarness()
    render(
      <SettingsController
        {...harness}
        onPreferencesChange={onPreferencesChange}
      />,
    )

    const title = screen.getByLabelText('主标题')
    await user.type(title, '小明，开嗓了。')
    await user.tab()

    const subtitle = screen.getByLabelText('副标题')
    await user.type(subtitle, '今天从 Part 2 开始。')
    await user.tab()

    await waitFor(() => {
      expect(onPreferencesChange).toHaveBeenCalledWith({
        homeTitleOverride: '小明，开嗓了。',
      })
      expect(onPreferencesChange).toHaveBeenCalledWith({
        homeSubtitleOverride: '今天从 Part 2 开始。',
      })
    })
  })

  it('keeps 恢复默认文案 disabled until a greeting override exists', () => {
    const harness = createHarness()
    render(<SettingsController {...harness} />)
    const restore = screen.getByRole('button', { name: /恢复默认文案/ })
    expect(restore).toHaveProperty('disabled', true)
  })
})
