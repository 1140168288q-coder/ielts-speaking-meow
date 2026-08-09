import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiSettingsPanel } from './ApiSettingsPanel'
import type {
  ApiCapability,
  ApiConfigurationPatch,
  ApiSettingsState,
} from './types'

const initialSettings = (overrides: Partial<ApiSettingsState> = {}): ApiSettingsState => ({
  'text-ai': {
    configuration: { provider: '', endpoint: '', model: '', voice: '' },
    apiKeyDraft: '',
    hasSavedApiKey: false,
    operation: 'idle',
    feedback: null,
  },
  stt: {
    configuration: { provider: '', endpoint: '', model: '', voice: '' },
    apiKeyDraft: '',
    hasSavedApiKey: false,
    operation: 'idle',
    feedback: null,
  },
  'voice-ai': {
    configuration: { provider: '', endpoint: '', model: '', voice: '' },
    apiKeyDraft: '',
    hasSavedApiKey: false,
    operation: 'idle',
    feedback: null,
  },
  ...overrides,
})

function SettingsHarness({
  initial,
  onSave = vi.fn(),
  onTest = vi.fn(),
  onDeleteApiKey = vi.fn(),
}: {
  initial: ApiSettingsState
  onSave?: (capability: ApiCapability) => void
  onTest?: (capability: ApiCapability) => void
  onDeleteApiKey?: (capability: ApiCapability) => void
}) {
  const [settings, setSettings] = useState(initial)
  const updateConfiguration = (
    capability: ApiCapability,
    patch: ApiConfigurationPatch,
  ) => {
    setSettings((current) => ({
      ...current,
      [capability]: {
        ...current[capability],
        configuration: { ...current[capability].configuration, ...patch },
      },
    }))
  }
  const updateKey = (capability: ApiCapability, value: string) => {
    setSettings((current) => ({
      ...current,
      [capability]: { ...current[capability], apiKeyDraft: value },
    }))
  }

  return (
    <ApiSettingsPanel
      settings={settings}
      onConfigurationChange={updateConfiguration}
      onApiKeyDraftChange={updateKey}
      onSave={onSave}
      onTest={onTest}
      onDeleteApiKey={onDeleteApiKey}
    />
  )
}

describe('ApiSettingsPanel', () => {
  it('keeps Text AI, STT and Voice AI visibly independent with explicit fallbacks', () => {
    render(<SettingsHarness initial={initialSettings()} />)

    expect(screen.getByText('Text AI')).toBeInTheDocument()
    expect(screen.getByText('STT')).toBeInTheDocument()
    expect(screen.getByText('Voice AI')).toBeInTheDocument()
    expect(screen.getByText(/继续使用可解释的本地反馈/)).toBeInTheDocument()
    expect(screen.getByText(/允许手工输入转写/)).toBeInTheDocument()
    expect(screen.getByText(/回退 Android 系统 TTS/)).toBeInTheDocument()
    expect(screen.getByText(/不会与另外两项共用/)).toBeInTheDocument()
  })

  it('validates a remote Text AI configuration before delegating save', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<SettingsHarness initial={initialSettings()} onSave={onSave} />)

    await user.selectOptions(screen.getByLabelText('Text AI Provider'), 'openai-compatible')
    expect(screen.getByText('请填写 Endpoint')).toBeInTheDocument()
    expect(screen.getByText('请填写模型名称')).toBeInTheDocument()
    expect(screen.getByText('请填写 API Key')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Text AI Endpoint'), 'http://api.example.com/v1')
    expect(screen.getByText('Endpoint 必须使用 HTTPS')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Text AI Endpoint'))
    await user.type(screen.getByLabelText('Text AI Endpoint'), 'https://api.example.com/v1')
    await user.type(screen.getByLabelText('Text AI Model'), 'feedback-model')
    await user.type(screen.getByLabelText('Text AI API Key'), 'secret-value')

    await user.click(screen.getByRole('button', { name: '保存此项设置' }))
    expect(onSave).toHaveBeenCalledWith('text-ai')
  })

  it('does not request an API key for system STT and delegates availability checks', async () => {
    const user = userEvent.setup()
    const onTest = vi.fn()
    render(<SettingsHarness initial={initialSettings()} onTest={onTest} />)

    await user.click(screen.getByRole('button', { name: /STT/ }))
    expect(screen.queryByLabelText('STT API Key')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '检查系统能力' }))
    expect(onTest).toHaveBeenCalledWith('stt')
  })

  it('deletes only the confirmed capability key and explains its own fallback', async () => {
    const user = userEvent.setup()
    const onDeleteApiKey = vi.fn()
    render(
      <SettingsHarness
        initial={initialSettings({
          'text-ai': {
            configuration: {
              provider: 'openai-compatible',
              endpoint: 'https://api.example.com/v1',
              model: 'feedback-model',
              voice: '',
            },
            apiKeyDraft: '',
            hasSavedApiKey: true,
            operation: 'idle',
            feedback: null,
          },
        })}
        onDeleteApiKey={onDeleteApiKey}
      />,
    )

    expect(screen.getByPlaceholderText('已安全保存；留空不会替换')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: '删除密钥' }))
    expect(screen.getByText(/Text AI 将回到本地反馈/)).toBeInTheDocument()
    expect(onDeleteApiKey).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    expect(onDeleteApiKey).toHaveBeenCalledWith('text-ai')
  })

  it('requires an independent Voice name for a remote Voice AI provider', async () => {
    const user = userEvent.setup()
    render(<SettingsHarness initial={initialSettings()} />)

    await user.click(screen.getByRole('button', { name: /Voice AI/ }))
    await user.selectOptions(screen.getByLabelText('Voice AI Provider'), 'openai-compatible')
    expect(screen.getByText('请填写 Voice')).toBeInTheDocument()
    expect(screen.getByLabelText('Voice AI API Key')).toBeInTheDocument()
  })
})
