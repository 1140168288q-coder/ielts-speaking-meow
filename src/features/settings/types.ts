export type ApiCapability = 'text-ai' | 'stt' | 'voice-ai'

export type ProviderMode = 'disabled' | 'system' | 'remote'

export interface ApiProviderOption {
  value: string
  label: string
  mode: ProviderMode
  description: string
}

export interface ApiConfigurationDraft {
  provider: string
  endpoint: string
  model: string
  voice: string
}

export type SettingsOperation =
  | 'idle'
  | 'saving'
  | 'testing'
  | 'deleting-key'

export interface SettingsFeedback {
  tone: 'info' | 'success' | 'error'
  text: string
}

export interface ApiCapabilityState {
  configuration: ApiConfigurationDraft
  apiKeyDraft: string
  hasSavedApiKey: boolean
  operation: SettingsOperation
  feedback: SettingsFeedback | null
}

export type ApiSettingsState = Record<ApiCapability, ApiCapabilityState>

export type ApiConfigurationPatch = Partial<ApiConfigurationDraft>

export type ApiProviderOptions = Record<
  ApiCapability,
  readonly ApiProviderOption[]
>
