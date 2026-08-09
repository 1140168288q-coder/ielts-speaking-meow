import { useRef, useState } from 'react'
import type { ApiConfigurationService } from '../application/apiConfigurationService'
import type {
  ApiCapability as DomainApiCapability,
  ApiConfiguration,
} from '../domain'
import {
  ApiSettingsPanel,
  type ApiCapability,
  type ApiSettingsState,
} from '../features/settings'
import type { OpenAICompatibleSttProvider } from '../infrastructure/ai/openAiCompatibleSttProvider'
import type { OpenAICompatibleTextProvider } from '../infrastructure/ai/openAiCompatibleTextProvider'
import type { OpenAICompatibleTtsProvider } from '../infrastructure/speech/openAiCompatibleTtsProvider'
import type { AudioFocus, STTProvider } from '../ports/speech'

export interface SettingsControllerProps {
  service: ApiConfigurationService
  textAi: OpenAICompatibleTextProvider
  remoteStt: OpenAICompatibleSttProvider
  voiceAi: OpenAICompatibleTtsProvider
  systemStt: STTProvider
  audioFocus: AudioFocus
}

export function SettingsController({
  service,
  textAi,
  remoteStt,
  voiceAi,
  systemStt,
  audioFocus,
}: SettingsControllerProps) {
  const [settings, setSettings] = useState<ApiSettingsState>(() =>
    createSettingsState(service),
  )
  const activeOperations = useRef(new Set<ApiCapability>())
  const operationTokens = useRef<Record<ApiCapability, number>>({
    'text-ai': 0,
    stt: 0,
    'voice-ai': 0,
  })

  const updateCapability = (
    capability: ApiCapability,
    update: Partial<ApiSettingsState[ApiCapability]>,
  ) => {
    setSettings((current) => ({
      ...current,
      [capability]: { ...current[capability], ...update },
    }))
  }

  const save = async (capability: ApiCapability, operation: 'saving' | 'testing') => {
    if (activeOperations.current.has(capability)) return
    activeOperations.current.add(capability)
    const token = ++operationTokens.current[capability]
    const isCurrent = () => operationTokens.current[capability] === token
    const state = settings[capability]
    updateCapability(capability, { operation, feedback: null })
    try {
      if (state.configuration.provider === '') {
        const existing = service.getStatus(capability).configuration
        if (existing !== null) {
          await service.save({ ...existing, enabled: false, updatedAt: now() })
        }
        if (!isCurrent()) return
        if (operation === 'testing') {
          await testSystemCapability(capability, systemStt, audioFocus)
          if (!isCurrent()) return
        }
        updateCapability(capability, {
          operation: 'idle',
          feedback: {
            tone: 'success',
            text: operation === 'testing'
              ? '系统能力验证成功。'
              : fallbackSavedCopy[capability],
          },
        })
        return
      }

      const configuration = createConfiguration(capability, state.configuration)
      const status = await service.save(
        configuration,
        state.apiKeyDraft.trim() || undefined,
      )
      if (!isCurrent()) return
      updateCapability(capability, {
        operation,
        apiKeyDraft: '',
        hasSavedApiKey: status.hasSecret,
        feedback: {
          tone: 'success',
          text: operation === 'saving' ? '此项配置已独立保存。' : '配置已保存，正在验证连接…',
        },
      })

      if (operation === 'testing') {
        await testRemoteCapability(capability, textAi, remoteStt, voiceAi)
        if (!isCurrent()) return
        updateCapability(capability, {
          operation: 'idle',
          feedback: { tone: 'success', text: '连接验证成功。' },
        })
      } else {
        updateCapability(capability, { operation: 'idle' })
      }
    } catch (error) {
      if (!isCurrent()) return
      updateCapability(capability, {
        operation: 'idle',
        feedback: {
          tone: 'error',
          text: error instanceof Error ? error.message : '此项操作失败，请重试。',
        },
      })
    } finally {
      if (isCurrent()) {
        activeOperations.current.delete(capability)
      }
    }
  }

  const removeApiKey = async (capability: ApiCapability) => {
    if (activeOperations.current.has(capability)) return
    activeOperations.current.add(capability)
    const token = ++operationTokens.current[capability]
    const isCurrent = () => operationTokens.current[capability] === token
    updateCapability(capability, {
      operation: 'deleting-key',
      feedback: null,
    })

    try {
      await service.removeSecret(capability)
      if (!isCurrent()) return
      updateCapability(capability, {
        operation: 'idle',
        apiKeyDraft: '',
        hasSavedApiKey: false,
        feedback: { tone: 'success', text: '仅此项 API Key 已删除。' },
      })
    } catch (error) {
      if (!isCurrent()) return
      updateCapability(capability, {
        operation: 'idle',
        feedback: {
          tone: 'error',
          text: error instanceof Error ? error.message : '密钥删除失败。',
        },
      })
    } finally {
      if (isCurrent()) {
        activeOperations.current.delete(capability)
      }
    }
  }

  return (
    <ApiSettingsPanel
      settings={settings}
      onConfigurationChange={(capability, patch) => {
        if (activeOperations.current.has(capability)) return
        setSettings((current) => ({
          ...current,
          [capability]: {
            ...current[capability],
            configuration: {
              ...current[capability].configuration,
              ...patch,
            },
            feedback: null,
          },
        }))
      }}
      onApiKeyDraftChange={(capability, value) => {
        if (activeOperations.current.has(capability)) return
        updateCapability(capability, { apiKeyDraft: value, feedback: null })
      }}
      onSave={(capability) => void save(capability, 'saving')}
      onTest={(capability) => void save(capability, 'testing')}
      onDeleteApiKey={(capability) => void removeApiKey(capability)}
    />
  )
}

const fallbackSavedCopy: Record<ApiCapability, string> = {
  'text-ai': '已关闭 Text AI；本地反馈仍可使用。',
  stt: '已关闭远程 STT；录音仍会保存并可手工转写。',
  'voice-ai': '已关闭 Voice AI；将使用 Android 系统 TTS。',
}

function createSettingsState(service: ApiConfigurationService): ApiSettingsState {
  const create = (capability: DomainApiCapability) => {
    const status = service.getStatus(capability)
    const configuration = status.configuration
    return {
      configuration: {
        provider: configuration?.enabled === true ? configuration.provider : '',
        endpoint: configuration?.endpoint ?? '',
        model: configuration?.model ?? '',
        voice: configuration?.id === 'voice-ai' ? configuration.voice : '',
      },
      apiKeyDraft: '',
      hasSavedApiKey: status.hasSecret,
      operation: 'idle' as const,
      feedback: null,
    }
  }

  return {
    'text-ai': create('text-ai'),
    stt: create('stt'),
    'voice-ai': create('voice-ai'),
  }
}

function createConfiguration(
  capability: ApiCapability,
  draft: ApiSettingsState[ApiCapability]['configuration'],
): ApiConfiguration {
  const common = {
    provider: 'openai-compatible' as const,
    endpoint: draft.endpoint.trim(),
    model: draft.model.trim(),
    enabled: true,
    updatedAt: now(),
  }
  if (capability === 'text-ai') {
    return { id: 'text-ai', ...common }
  }
  if (capability === 'stt') {
    return { id: 'stt', ...common }
  }
  return { id: 'voice-ai', ...common, voice: draft.voice.trim() }
}

async function testRemoteCapability(
  capability: ApiCapability,
  textAi: OpenAICompatibleTextProvider,
  remoteStt: OpenAICompatibleSttProvider,
  voiceAi: OpenAICompatibleTtsProvider,
): Promise<void> {
  if (capability === 'text-ai') {
    await textAi.testConnection()
  } else if (capability === 'stt') {
    await remoteStt.testConnection()
  } else {
    await voiceAi.speak({ text: 'Your voice connection is ready.' })
  }
}

async function testSystemCapability(
  capability: ApiCapability,
  stt: STTProvider,
  audioFocus: AudioFocus,
): Promise<void> {
  if (capability === 'stt') {
    if (!stt.isAvailable()) {
      throw new Error('当前 WebView 不支持系统实时转写；可手工输入。')
    }
    return
  }
  if (capability === 'voice-ai') {
    await audioFocus.speak({ text: 'System voice is ready.', language: 'en-US' })
  }
}

function now(): string {
  return new Date().toISOString()
}
