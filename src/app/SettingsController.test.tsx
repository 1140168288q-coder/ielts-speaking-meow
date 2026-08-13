import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BackendClient } from '../infrastructure/backend'
import type { AudioFocus, STTProvider } from '../ports/speech'
import { SettingsController } from './SettingsController'

function createBackendClient(health: unknown): BackendClient {
  return {
    url: 'http://backend.test',
    getHealth: vi.fn().mockResolvedValue(health),
  } as unknown as BackendClient
}

function createHarness(health: unknown) {
  const backendClient = createBackendClient(health)
  const systemStt: STTProvider = {
    id: 'system-stt',
    isAvailable: () => true,
    start: vi.fn(),
  }
  const speak = vi.fn().mockResolvedValue(undefined)
  const audioFocus: AudioFocus = {
    speak,
  } as unknown as AudioFocus
  return { backendClient, systemStt, audioFocus, speak }
}

describe('SettingsController', () => {
  it('shows the injected backend address and no API key inputs', () => {
    const harness = createHarness({ status: 'ok', providers: {} })
    render(
      <SettingsController
        backendClient={harness.backendClient}
        systemStt={harness.systemStt}
        audioFocus={harness.audioFocus}
      />,
    )
    expect(screen.getByText(/http:\/\/backend\.test/)).toBeTruthy()
    expect(screen.queryByPlaceholderText(/Key/i)).toBeNull()
    expect(screen.queryByText(/API Key/i)).toBeNull()
  })

  it('checks the cloud backend and lists provider status', async () => {
    const user = userEvent.setup()
    const harness = createHarness({
      status: 'ok',
      providers: { deepseek: true, volc_stt: true, volc_tts: false },
    })
    render(
      <SettingsController
        backendClient={harness.backendClient}
        systemStt={harness.systemStt}
        audioFocus={harness.audioFocus}
      />,
    )
    await user.click(screen.getByRole('button', { name: /测试云端连接/ }))
    expect(await screen.findByText(/连接正常/)).toBeTruthy()
    expect(screen.getAllByText(/已配置/)).toHaveLength(2)
    expect(screen.getByText(/未配置/)).toBeTruthy()
  })

  it('surfaces backend connection failures', async () => {
    const user = userEvent.setup()
    const backendClient = {
      url: 'http://backend.test',
      getHealth: vi.fn().mockRejectedValue(new Error('网络连接失败,请检查网络后重试。')),
    } as unknown as BackendClient
    const systemStt: STTProvider = {
      id: 'system-stt',
      isAvailable: () => true,
      start: vi.fn(),
    }
    const audioFocus: AudioFocus = {
      speak: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioFocus
    render(
      <SettingsController
        backendClient={backendClient}
        systemStt={systemStt}
        audioFocus={audioFocus}
      />,
    )
    await user.click(screen.getByRole('button', { name: /测试云端连接/ }))
    expect(await screen.findByText(/网络连接失败/)).toBeTruthy()
  })

  it('tests the system TTS playback', async () => {
    const user = userEvent.setup()
    const harness = createHarness({ status: 'ok', providers: {} })
    render(
      <SettingsController
        backendClient={harness.backendClient}
        systemStt={harness.systemStt}
        audioFocus={harness.audioFocus}
      />,
    )
    await user.click(screen.getByRole('button', { name: /测试系统朗读/ }))
    expect(harness.speak).toHaveBeenCalledWith({
      text: 'System voice is ready.',
      language: 'en-US',
    })
    expect(await screen.findByText(/系统朗读正常/)).toBeTruthy()
  })
})
