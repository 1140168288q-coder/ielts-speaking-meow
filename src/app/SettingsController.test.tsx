import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OpenAICompatibleSttProvider } from '../infrastructure/ai/openAiCompatibleSttProvider'
import type { OpenAICompatibleTextProvider } from '../infrastructure/ai/openAiCompatibleTextProvider'
import type { OpenAICompatibleTtsProvider } from '../infrastructure/speech/openAiCompatibleTtsProvider'
import type { AudioFocus, STTProvider } from '../ports/speech'
import { createConfiguredApiHarness } from '../test/fixtures/apiHarness'
import { SettingsController } from './SettingsController'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('SettingsController operation ordering', () => {
  it('keeps a connection test pending until the provider result settles', async () => {
    const user = userEvent.setup()
    const harness = await createConfiguredApiHarness()
    const connection = deferred()
    const testConnection = vi.fn(() => connection.promise)
    const textAi = { testConnection } as unknown as OpenAICompatibleTextProvider
    const remoteStt = {} as OpenAICompatibleSttProvider
    const voiceAi = {} as OpenAICompatibleTtsProvider
    const systemStt = {} as STTProvider
    const audioFocus = {} as AudioFocus

    render(
      <SettingsController
        service={harness.service}
        textAi={textAi}
        remoteStt={remoteStt}
        voiceAi={voiceAi}
        systemStt={systemStt}
        audioFocus={audioFocus}
      />,
    )

    const testButton = screen.getByRole('button', { name: '测试连接' })
    await user.click(testButton)
    await waitFor(() => {
      expect(testConnection).toHaveBeenCalledOnce()
    })

    const endpoint = screen.getByLabelText('Text AI Endpoint')
    expect(testButton).toBeDisabled()
    expect(endpoint).toBeDisabled()
    expect(screen.getByText('测试中')).toBeInTheDocument()
    expect(screen.queryByText('连接验证成功。')).not.toBeInTheDocument()

    fireEvent.change(endpoint, {
      target: { value: 'https://newer.example.test/v1' },
    })
    fireEvent.click(testButton)
    expect(endpoint).toHaveValue('https://text.example.test/v1')
    expect(testConnection).toHaveBeenCalledOnce()

    connection.resolve()

    await waitFor(() => {
      expect(screen.getByText('连接验证成功。')).toBeInTheDocument()
    })
    expect(testButton).toBeEnabled()
    expect(testConnection).toHaveBeenCalledOnce()
  })
})
