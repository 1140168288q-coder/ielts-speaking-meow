import { useMemo, useState } from 'react'
import styles from './ApiSettingsPanel.module.css'
import { DEFAULT_API_PROVIDER_OPTIONS } from './providerOptions'
import type {
  ApiCapability,
  ApiCapabilityState,
  ApiConfigurationPatch,
  ApiProviderOption,
  ApiProviderOptions,
  ApiSettingsState,
} from './types'

export interface ApiSettingsPanelProps {
  settings: ApiSettingsState
  providerOptions?: Partial<ApiProviderOptions>
  onConfigurationChange: (
    capability: ApiCapability,
    patch: ApiConfigurationPatch,
  ) => void
  onApiKeyDraftChange: (capability: ApiCapability, value: string) => void
  onSave: (capability: ApiCapability) => void
  onTest: (capability: ApiCapability) => void
  onDeleteApiKey: (capability: ApiCapability) => void
}

interface CapabilityCopy {
  eyebrow: string
  title: string
  purpose: string
  fallback: string
}

const capabilityCopy: Record<ApiCapability, CapabilityCopy> = {
  'text-ai': {
    eyebrow: '语言反馈',
    title: 'Text AI',
    purpose: '用于 2–3 条关键语言反馈、第二次提示和有限改写。',
    fallback: '未配置或请求失败时，继续使用可解释的本地反馈。',
  },
  stt: {
    eyebrow: '语音转文字',
    title: 'STT',
    purpose: '尽量忠实保留 filler、重复、自我修正和犹豫。',
    fallback: '不可用时原录音仍会保留，并允许手工输入转写。',
  },
  'voice-ai': {
    eyebrow: '题目与表达播报',
    title: 'Voice AI',
    purpose: '用于题目播报和保存表达的示范朗读。',
    fallback: '未配置或生成失败时，自动回退 Android 系统 TTS。',
  },
}

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const getSelectedProvider = (
  state: ApiCapabilityState,
  options: readonly ApiProviderOption[],
) => options.find((option) => option.value === state.configuration.provider)
  ?? options.find((option) => option.mode === 'disabled')
  ?? options[0]

const validationProblems = (
  capability: ApiCapability,
  state: ApiCapabilityState,
  provider: ApiProviderOption | undefined,
) => {
  if (!provider || provider.mode !== 'remote') return []
  const problems: string[] = []
  if (!state.configuration.endpoint.trim()) {
    problems.push('请填写 Endpoint')
  } else if (!isHttpsUrl(state.configuration.endpoint.trim())) {
    problems.push('Endpoint 必须使用 HTTPS')
  }
  if (!state.configuration.model.trim()) problems.push('请填写模型名称')
  if (!state.hasSavedApiKey && !state.apiKeyDraft.trim()) problems.push('请填写 API Key')
  if (capability === 'voice-ai' && !state.configuration.voice.trim()) {
    problems.push('请填写 Voice')
  }
  return problems
}

const statusLabel = (
  state: ApiCapabilityState,
  provider: ApiProviderOption | undefined,
) => {
  if (state.operation === 'saving') return '保存中'
  if (state.operation === 'testing') return '测试中'
  if (state.operation === 'deleting-key') return '删除中'
  if (!provider || provider.mode === 'disabled') return '未配置'
  if (provider.mode === 'system') return '系统默认'
  return state.hasSavedApiKey ? '已配置' : '缺少密钥'
}

function SavedSecretRow({
  capability,
  disabled,
  onRequestDelete,
}: {
  capability: ApiCapability
  disabled: boolean
  onRequestDelete: () => void
}) {
  return (
    <div className={styles.secretStatus}>
      <span>{capabilityCopy[capability].title} 仍保存有一枚独立密钥</span>
      <button type="button" disabled={disabled} onClick={onRequestDelete}>
        删除密钥
      </button>
    </div>
  )
}

function SecretField({
  capability,
  state,
  disabled,
  onChange,
  onRequestDelete,
}: {
  capability: ApiCapability
  state: ApiCapabilityState
  disabled: boolean
  onChange: (value: string) => void
  onRequestDelete: () => void
}) {
  return (
    <div className={styles.secretBlock}>
      <label className={styles.field}>
        <span>API Key</span>
        <input
          type="password"
          value={state.apiKeyDraft}
          autoComplete="new-password"
          spellCheck={false}
          disabled={disabled}
          aria-label={`${capabilityCopy[capability].title} API Key`}
          placeholder={state.hasSavedApiKey ? '已安全保存；留空不会替换' : '输入独立 API Key'}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className={styles.secretStatus}>
        <span>{state.hasSavedApiKey ? '密钥已安全保存' : '尚未保存密钥'}</span>
        {state.hasSavedApiKey ? (
          <button type="button" disabled={disabled} onClick={onRequestDelete}>
            删除密钥
          </button>
        ) : null}
      </div>
    </div>
  )
}

function SettingsCard({
  capability,
  state,
  options,
  expanded,
  confirmingDelete,
  onToggle,
  onConfigurationChange,
  onApiKeyDraftChange,
  onSave,
  onTest,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  capability: ApiCapability
  state: ApiCapabilityState
  options: readonly ApiProviderOption[]
  expanded: boolean
  confirmingDelete: boolean
  onToggle: () => void
  onConfigurationChange: (patch: ApiConfigurationPatch) => void
  onApiKeyDraftChange: (value: string) => void
  onSave: () => void
  onTest: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}) {
  const copy = capabilityCopy[capability]
  const provider = getSelectedProvider(state, options)
  const problems = useMemo(
    () => validationProblems(capability, state, provider),
    [capability, provider, state],
  )
  const busy = state.operation !== 'idle'
  const isRemote = provider?.mode === 'remote'
  const isDisabled = !provider || provider.mode === 'disabled'

  return (
    <article className={styles.settingsCard}>
      <button
        type="button"
        className={styles.cardToggle}
        aria-expanded={expanded}
        aria-controls={`settings-${capability}`}
        onClick={onToggle}
      >
        <span>
          <small>{copy.eyebrow}</small>
          <strong>{copy.title}</strong>
          <em>{copy.fallback}</em>
        </span>
        <b className={styles.statusPill}>{statusLabel(state, provider)}</b>
      </button>

      {expanded ? (
        <div className={styles.cardBody} id={`settings-${capability}`}>
          <p className={styles.purpose}>{copy.purpose}</p>
          <div className={styles.independenceNote}>
            此卡的 Provider、Endpoint、模型和密钥不会与另外两项共用。
          </div>

          <label className={styles.field}>
            <span>Provider</span>
            <select
              value={provider?.value ?? ''}
              disabled={busy}
              aria-label={`${copy.title} Provider`}
              onChange={(event) => onConfigurationChange({ provider: event.target.value })}
            >
              {options.map((option) => (
                <option key={option.value || 'disabled'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {provider ? <small>{provider.description}</small> : null}
          </label>

          {isRemote ? (
            <>
              <label className={styles.field}>
                <span>Endpoint</span>
                <input
                  inputMode="url"
                  value={state.configuration.endpoint}
                  disabled={busy}
                  aria-label={`${copy.title} Endpoint`}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => onConfigurationChange({ endpoint: event.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span>Model</span>
                <input
                  value={state.configuration.model}
                  disabled={busy}
                  aria-label={`${copy.title} Model`}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="输入服务实际支持的模型名称"
                  onChange={(event) => onConfigurationChange({ model: event.target.value })}
                />
              </label>
              {capability === 'voice-ai' ? (
                <label className={styles.field}>
                  <span>Voice</span>
                  <input
                    value={state.configuration.voice}
                    disabled={busy}
                    aria-label="Voice AI Voice"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="输入服务实际支持的声音名称"
                    onChange={(event) => onConfigurationChange({ voice: event.target.value })}
                  />
                </label>
              ) : null}
              <SecretField
                capability={capability}
                state={state}
                disabled={busy}
                onChange={onApiKeyDraftChange}
                onRequestDelete={onRequestDelete}
              />
            </>
          ) : null}

          {!isRemote && state.hasSavedApiKey ? (
            <SavedSecretRow
              capability={capability}
              disabled={busy}
              onRequestDelete={onRequestDelete}
            />
          ) : null}

          {problems.length > 0 && !isDisabled ? (
            <div className={styles.validation} role="alert">
              {problems.map((problem) => <p key={problem}>{problem}</p>)}
            </div>
          ) : null}

          {state.feedback ? (
            <div
              className={`${styles.feedback} ${styles[state.feedback.tone]}`}
              role={state.feedback.tone === 'error' ? 'alert' : 'status'}
            >
              {state.feedback.text}
            </div>
          ) : null}

          {confirmingDelete ? (
            <div className={styles.deleteConfirm} role="alertdialog" aria-label={`删除 ${copy.title} 密钥`}>
              <strong>删除 {copy.title} 密钥？</strong>
              <p>
                {capability === 'text-ai'
                  ? 'Text AI 将回到本地反馈。STT 和 Voice AI 不受影响。'
                  : capability === 'stt'
                    ? '远程转写将不可用，原录音仍会保存并可手工转写。其他配置不受影响。'
                    : 'Voice AI 将回退 Android 系统 TTS。Text AI 和 STT 不受影响。'}
              </p>
              <div>
                <button type="button" className={styles.secondaryButton} onClick={onCancelDelete}>
                  取消
                </button>
                <button type="button" className={styles.dangerButton} onClick={onConfirmDelete}>
                  确认删除
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={busy || (isRemote ? problems.length > 0 : capability === 'text-ai')}
              onClick={onTest}
            >
              {state.operation === 'testing'
                ? '正在测试…'
                : capability === 'voice-ai'
                  ? isRemote ? '试听 Voice AI' : '试听系统语音'
                  : capability === 'stt' && !isRemote
                    ? '检查系统能力'
                    : '测试连接'}
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy || (isRemote && problems.length > 0)}
              onClick={onSave}
            >
              {state.operation === 'saving' ? '正在保存…' : '保存此项设置'}
            </button>
          </div>
          <p className={styles.testPrivacy}>
            测试请求不包含录音、转写、练习记录或导入文件。
          </p>
        </div>
      ) : null}
    </article>
  )
}

export function ApiSettingsPanel({
  settings,
  providerOptions,
  onConfigurationChange,
  onApiKeyDraftChange,
  onSave,
  onTest,
  onDeleteApiKey,
}: ApiSettingsPanelProps) {
  const [expanded, setExpanded] = useState<ApiCapability | null>('text-ai')
  const [confirmingDelete, setConfirmingDelete] = useState<ApiCapability | null>(null)
  const options: ApiProviderOptions = {
    'text-ai': providerOptions?.['text-ai'] ?? DEFAULT_API_PROVIDER_OPTIONS['text-ai'],
    stt: providerOptions?.stt ?? DEFAULT_API_PROVIDER_OPTIONS.stt,
    'voice-ai': providerOptions?.['voice-ai'] ?? DEFAULT_API_PROVIDER_OPTIONS['voice-ai'],
  }

  return (
    <section className={styles.panel}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>独立能力设置</p>
        <h1>Text、转写与声音各自配置</h1>
        <p>三项不会自动共用 Provider、Endpoint、模型或 API Key，也可以分别删除。</p>
      </header>

      <div className={styles.cards}>
        {(['text-ai', 'stt', 'voice-ai'] as const).map((capability) => (
          <SettingsCard
            key={capability}
            capability={capability}
            state={settings[capability]}
            options={options[capability]}
            expanded={expanded === capability}
            confirmingDelete={confirmingDelete === capability}
            onToggle={() => {
              setExpanded((current) => current === capability ? null : capability)
              setConfirmingDelete(null)
            }}
            onConfigurationChange={(patch) => onConfigurationChange(capability, patch)}
            onApiKeyDraftChange={(value) => onApiKeyDraftChange(capability, value)}
            onSave={() => onSave(capability)}
            onTest={() => onTest(capability)}
            onRequestDelete={() => setConfirmingDelete(capability)}
            onCancelDelete={() => setConfirmingDelete(null)}
            onConfirmDelete={() => {
              setConfirmingDelete(null)
              onDeleteApiKey(capability)
            }}
          />
        ))}
      </div>
    </section>
  )
}
