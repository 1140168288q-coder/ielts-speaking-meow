import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, Cloud, Headphones, Monitor, Moon, Sun } from 'lucide-react'
import type {
  BackendConfigStore,
  BackendHealthCache,
  BackendHealthSnapshot,
  BackendProviderHealth,
} from '../infrastructure/backend'
import type {
  SystemTTSProvider,
  SystemTtsStatus,
  TTSProvider,
} from '../ports/speech'
import type { LocalDataMaintenance } from '../ports/storage'
import type { StorageBackupService } from '../application/storageBackupService'
import type { UserPreferences, UserPreferencesUpdate } from '../domain/userPreferences'
import {
  getTtsVoicePreset,
  resolveTtsVoicePlaybackSettings,
  TTS_VOICE_PRESETS,
} from '../domain'
import { StorageManager } from '../features/storage'

export interface SettingsControllerProps {
  configStore: BackendConfigStore
  healthCache: BackendHealthCache
  /** 本机系统 TTS(Android)。「测试系统朗读」必须直连它,不走 AI 优先链路。 */
  systemTts: SystemTTSProvider
  /** 首选云端音色(BackendTtsProvider);用于展示当前实际播报来源与试听。 */
  preferredVoice: TTSProvider
  dataMaintenance: LocalDataMaintenance
  backupService: StorageBackupService
  onDataChanged: () => Promise<void>
  /** 返回上一级;由 App 按来源视图决定目标。 */
  onBack?: () => void
  theme?: 'system' | 'light' | 'dark'
   preferences?: Pick<UserPreferences,
     | 'ttsVoiceMode'
     | 'ttsVoicePreset'
     | 'ttsRate'
     | 'ttsPitch'
     | 'autoPlayQuestion'
     | 'defaultPart'
     | 'feedbackDetail'
     | 'naturalUpgradeLevel'
     | 'spokenEnglishStyle'
     | 'memoryEnabled'
     | 'autoMatchPersonalMaterialsWithAi'
     | 'reduceMotion'
     | 'homeTitleOverride'
     | 'homeSubtitleOverride'
   >
  onPreferencesChange?: (update: UserPreferencesUpdate) => Promise<void>
  onThemeChange?: (theme: 'system' | 'light' | 'dark') => void
}

type FeedbackTone = 'idle' | 'busy' | 'success' | 'error'

interface Feedback {
  tone: FeedbackTone
  text: string
}

const CLOUD_PREVIEW_TEXT = 'Hello, this is your IELTS speaking coach.'

/**
 * 设置页:普通用户不再填写任何第三方 API Key。

 * - 云端服务:Backend 可达性、版本、每个供应商的模型/音色与真实验证状态;
 * - 正式版本(地址锁定)只展示内置 Backend 地址,不允许编辑;
 * - 本机能力:系统 TTS 引擎、英语语音包与直连测试。

 */

const DEFAULT_PREFERENCES = {
  ttsVoicePreset: 'backend-default',
  ttsVoiceMode: 'natural-first',
  ttsRate: 0.92,
  ttsPitch: 1,
  autoPlayQuestion: true,
  defaultPart: 1,
  feedbackDetail: 'focused',
  naturalUpgradeLevel: 'medium',
  spokenEnglishStyle: 'british',
  memoryEnabled: true,
  autoMatchPersonalMaterialsWithAi: true,
  reduceMotion: false,
  homeTitleOverride: null,
  homeSubtitleOverride: null,
} as const
export function SettingsController({
  configStore,
  healthCache,
  systemTts,
  preferredVoice,
  dataMaintenance,
  backupService,
  onDataChanged,
  onBack = () => undefined,
  theme = 'system',
  onThemeChange = () => undefined,
  preferences = DEFAULT_PREFERENCES,
  onPreferencesChange = () => Promise.resolve(),
}: SettingsControllerProps) {
  const [snapshot, setSnapshot] = useState<BackendHealthSnapshot>(() =>
    healthCache.getSnapshot(),
  )
  const [addressDraft, setAddressDraft] = useState(() => configStore.getBaseUrl())
  const [busy, setBusy] = useState(false)
  const [healthFeedback, setHealthFeedback] = useState<Feedback | null>(null)
  const [verifyFeedback, setVerifyFeedback] = useState<Feedback | null>(null)
  const [saveFeedback, setSaveFeedback] = useState<Feedback | null>(null)
  const [ttsFeedback, setTtsFeedback] = useState<Feedback | null>(null)
  const [cloudPreviewFeedback, setCloudPreviewFeedback] = useState<Feedback | null>(null)
  const [systemTtsStatus, setSystemTtsStatus] = useState<SystemTtsStatus | null>(null)
  const [homeTitleDraft, setHomeTitleDraft] = useState(preferences.homeTitleOverride ?? '')
  const [homeSubtitleDraft, setHomeSubtitleDraft] = useState(preferences.homeSubtitleOverride ?? '')
  const locked = configStore.isLocked()

  const loadSystemTtsStatus = useCallback(async () => {
    const status = await systemTts.getStatus()
    setSystemTtsStatus(status)
    return status
  }, [systemTts])

  const refreshHealth = async () => {
    if (busy) return
    setBusy(true)
    setHealthFeedback({ tone: 'busy', text: '正在连接云端服务…' })
    const result = await healthCache.refresh()
    setSnapshot(result)
    setBusy(false)
    if (result.health !== null) {
      setHealthFeedback({ tone: 'success', text: '云端服务连接正常。' })
    } else {
      setHealthFeedback({
        tone: 'error',
        text: '云端服务暂时没回应，离线练习不受影响。',
      })
    }
  }

  const verifyUpstream = async () => {
    if (busy) return
    setBusy(true)
    setVerifyFeedback({ tone: 'busy', text: '正在验证 AI 与云端朗读服务…' })
    try {
      const result = await healthCache.verifyProviders()
      setSnapshot(result)
      if (result.health === null) {
        setVerifyFeedback({
          tone: 'error',
          text: result.failure ?? '云端服务暂不可用，暂时无法完成验证。',
        })
        return
      }
      const failed = (['deepseek', 'volc_tts'] as const).filter(
        (name) => healthCache.verificationOf(name)?.status === 'failed',
      )
      if (failed.length > 0) {
        setVerifyFeedback({
          tone: 'error',
          text: '验证失败：连接凭据可能无效，或对应服务尚未开通。',
        })
      } else {
        setVerifyFeedback({
          tone: 'success',
          text: '验证通过：AI 反馈与云端朗读均可正常使用。',
        })
      }
    } catch (error) {
      setVerifyFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : '云端服务验证失败。',
      })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (healthCache.getSnapshot().checkedAt === 0) {
      void healthCache.refresh().then((result) => {
        setSnapshot(result)
      })
    }
    void systemTts
      .getStatus()
      .then((status) => setSystemTtsStatus(status))
      .catch(() => setSystemTtsStatus(null))
    // 仅在挂载时自动检查一次;healthCache/systemTts 在运行时内是稳定的
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveConfig = async () => {
    if (busy || locked) return
    setBusy(true)
    setSaveFeedback({ tone: 'busy', text: '正在保存配置并重新连接…' })
    try {
      await configStore.save(addressDraft)
      healthCache.invalidate()
      const result = await healthCache.refresh()
      setSnapshot(result)
      if (result.health !== null) {
        setSaveFeedback({
          tone: 'success',
          text: '配置已保存，云端服务连接正常。',
        })
      } else {
        setSaveFeedback({
          tone: 'error',
          text: `配置已保存，但云端仍不可用：${result.failure ?? '未知原因'}`,
        })
      }
    } catch (error) {
      setSaveFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : '配置保存失败。',
      })
    } finally {
      setBusy(false)
    }
  }

  /** 直接测试 Android 系统 TTS,并先检查引擎与英语语音包。 */
  const testSystemTts = async () => {
    if (busy) return
    setTtsFeedback({ tone: 'busy', text: '正在用本机系统引擎播放…' })
    try {
      const status = systemTtsStatus ?? await loadSystemTtsStatus()
      if (!status.available) {
        setTtsFeedback({
          tone: 'error',
          text: '当前设备没有可用的系统朗读，请在系统设置中安装或启用语音服务。',
        })
        return
      }
      if (!status.englishAvailable) {
        setTtsFeedback({
          tone: 'error',
          text: '未检测到英语语音包：请安装英语语音包或切换朗读服务后再试，否则英语题目可能没有声音。',
        })
        return
      }
      await systemTts.speak({ text: 'System voice is ready.', language: 'en-US' })
      setTtsFeedback({ tone: 'success', text: '系统朗读播放完成（实际出声）。' })
    } catch (error) {
      setTtsFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : '系统朗读不可用。',
      })
    }
  }

  /** 试听当前选择的云端音色(同时就是一次真实验证)。 */
  const previewCloudVoice = async () => {
    if (busy) return
    const fallbackToSystemVoice = async (): Promise<boolean> => {
      try {
        await systemTts.speak({
          text: CLOUD_PREVIEW_TEXT,
          language: 'en-US',
          ...selectedVoicePlayback,
        })
        return true
      } catch {
        return false
      }
    }

    if (!preferredVoice.isAvailable()) {
      const fallbackWorked = await fallbackToSystemVoice()
      setCloudPreviewFeedback(fallbackWorked
        ? {
            tone: 'error',
            text: '云端语音当前不可用，已改用系统朗读。',
          }
        : {
            tone: 'error',
            text: '云端语音和本机系统朗读都不可用，请检查连接与英语语音包。',
          })
      return
    }
    setCloudPreviewFeedback({ tone: 'busy', text: '正在合成云端音色…' })
    try {
      await preferredVoice.speak({
        text: CLOUD_PREVIEW_TEXT,
        language: 'en-US',
        ...selectedVoicePlayback,
      })
      setCloudPreviewFeedback({ tone: 'success', text: '云端音色试听完成。' })
      void healthCache.refresh().then(setSnapshot)

    } catch (error) {
      const fallbackWorked = await fallbackToSystemVoice()
      setCloudPreviewFeedback(fallbackWorked
        ? {
            tone: 'error',
            text: error instanceof Error
              ? `${error.message} 已改用系统朗读。`
              : '云端音色播放失败，已改用系统朗读。',
          }
        : {
            tone: 'error',
            text: error instanceof Error
              ? `${error.message}；系统朗读也不可用。`
              : '云端音色和本机系统朗读都不可用。',
          })
    }
  }

  const savePreference = async (update: UserPreferencesUpdate) => {
    try {
      await onPreferencesChange(update)
    } catch {
      // best-effort; 记忆与隐私的保存反馈已迁移到「我的」页 MemoryPrivacyCard
    }
  }

  /** 失焦时提交首页文案草稿;清空即恢复默认。 */
  const commitHomeText = (
    field: 'homeTitleOverride' | 'homeSubtitleOverride',
    value: string,
  ) => {
    const next = value.trim()
    if ((preferences[field] ?? '') === next) return
    void savePreference({ [field]: next.length === 0 ? null : next })
  }

  const health = snapshot.health
  const deepseek = health?.providers.deepseek
  const deepseekVerified = deepseek?.verification?.status === 'verified'
  const deepseekReady = health !== null && deepseek?.configured === true && deepseekVerified
  const usesPlainHttp = addressDraft.trim().toLowerCase().startsWith('http://')
  const selectedVoicePreset = getTtsVoicePreset(preferences.ttsVoicePreset)
  const selectedVoicePlayback = resolveTtsVoicePlaybackSettings(
    preferences.ttsVoicePreset,
    preferences.ttsRate,
    preferences.ttsPitch,
  )

  return (
    <div className="settings-panel">
      <header className="settings-page-heading">
        {onBack ? (
          <button
            type="button"
            className="icon-button settings-back-button"
            onClick={onBack}
            aria-label="返回上一页"
          >
            <ChevronLeft aria-hidden="true" size={21} />
          </button>
        ) : null}
        <p className="eyebrow">Settings</p>
        <h1>设置</h1>
      </header>
      <section className="settings-card appearance-settings-card">
        <div>
          <p className="eyebrow">Appearance</p>
          <h2>外观</h2>
          <p className="settings-note">跟着系统走，或者你自己定。</p>
        </div>
        <div className="theme-options" role="radiogroup" aria-label="外观主题">
          {([
            ['system', '跟随系统', Monitor],
            ['light', '浅色', Sun],
            ['dark', '深色', Moon],
          ] as const).map(([value, label, Icon]) => (
            <button
              type="button"
              role="radio"
              key={value}
              aria-checked={theme === value}
              className={theme === value ? 'active' : ''}
              onClick={() => onThemeChange(value)}
            >
              <Icon aria-hidden="true" size={18} />
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-card preference-settings-card">
        <div>
          <p className="eyebrow">Training defaults</p>
          <h2>训练与反馈</h2>
          <p className="settings-note">这些设置会跟着你本机的练习进度各自保存。</p>
        </div>
        <div className="preference-grid">
          <label className="settings-field">
            <span>默认训练 Part</span>
            <select
              aria-label="默认训练 Part"
              value={preferences.defaultPart}
              onChange={(event) => void savePreference({ defaultPart: Number(event.target.value) as 1 | 2 | 3 })}
            >
              <option value={1}>Part 1 · 简短问答</option>
              <option value={2}>Part 2 · 主题陈述</option>
              <option value={3}>Part 3 · 深入讨论</option>
            </select>
          </label>
          <label className="settings-field">
            <span>AI 反馈展开方式</span>
            <select
              aria-label="AI 反馈展开方式"
              value={preferences.feedbackDetail}
              onChange={(event) => void savePreference({ feedbackDetail: event.target.value as 'focused' | 'expanded' })}
            >
              <option value="focused">重点模式 · 先看 2–3 点</option>
              <option value="expanded">展开模式 · 同时打开细节</option>
            </select>
          </label>
          <label className="settings-field">
            <span>自然提升难度</span>
            <select
              aria-label="自然提升难度"
              value={preferences.naturalUpgradeLevel}
              onChange={(event) => void savePreference({
                naturalUpgradeLevel: event.target.value as 'simple' | 'medium' | 'challenging',
              })}
            >
              <option value="simple">简单 · 高频易复用</option>
              <option value="medium">中等 · 自然混合句型</option>
              <option value="challenging">较难 · 灵活展开</option>
            </select>
          </label>
          <label className="settings-field">
            <span>自然口语风格</span>
            <select
              aria-label="自然口语风格"
              value={preferences.spokenEnglishStyle}
              onChange={(event) => void savePreference({
                spokenEnglishStyle: event.target.value as 'british' | 'american',
              })}
            >
              <option value="british">英式自然口语</option>
              <option value="american">美式自然口语</option>
            </select>
          </label>
        </div>
        <label className="settings-switch">
          <input
            type="checkbox"
            checked={preferences.autoPlayQuestion}
            onChange={(event) => void savePreference({ autoPlayQuestion: event.target.checked })}
          />
          <span><strong>进入练习后自动播题</strong><small>计时器仍不会自动开始。</small></span>
        </label>
        <label className="settings-switch">
          <input
            type="checkbox"
            checked={preferences.reduceMotion}
            onChange={(event) => void savePreference({ reduceMotion: event.target.checked })}
          />
          <span><strong>减少动态效果</strong><small>保留状态反馈，缩短页面和卡片动画。</small></span>
        </label>
        <div className="home-greeting-fields">
          <p className="settings-note">首页那两行问候语，可以换成你自己的一句话。</p>
          <label className="settings-field">
            <span>主标题</span>
            <input
              type="text"
              value={homeTitleDraft}
              maxLength={40}
              placeholder="留空使用默认问候语"
              onChange={(event) => setHomeTitleDraft(event.target.value)}
              onBlur={(event) => commitHomeText('homeTitleOverride', event.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>副标题</span>
            <input
              type="text"
              value={homeSubtitleDraft}
              maxLength={80}
              placeholder="留空使用默认副标题"
              onChange={(event) => setHomeSubtitleDraft(event.target.value)}
              onBlur={(event) => commitHomeText('homeSubtitleOverride', event.target.value)}
            />
          </label>
          <button
            type="button"
            className="text-button"
            disabled={
              preferences.homeTitleOverride === null &&
              preferences.homeSubtitleOverride === null
            }
            onClick={() => {
              setHomeTitleDraft('')
              setHomeSubtitleDraft('')
              void savePreference({ homeTitleOverride: null, homeSubtitleOverride: null })
            }}
          >
            恢复默认文案
          </button>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-heading">
          <span className="settings-card-icon"><Cloud aria-hidden="true" size={20} /></span>
          <div>
            <p className="eyebrow">Smart services</p>
            <h2>AI 反馈与自然音色</h2>
          </div>
          <span className={deepseekReady ? 'service-state online' : 'service-state offline'}>
            {health === null ? 'AI 暂时离线' : deepseekReady ? 'AI 反馈可用' : 'AI 还没睡醒，点一下检查'}
          </span>
        </div>
        <p className="settings-note">
          云端用于生成精简反馈和自然朗读。即使断网，答题、保存、本地提示和系统朗读仍然可用。
        </p>
        <ul className="settings-providers friendly-service-status">
          <li>服务状态：{friendlyServiceSummary(health, deepseek)}</li>
          <li>模型：{friendlyModelSummary(deepseek)}</li>
        </ul>
        <div className="settings-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void refreshHealth()}
            disabled={busy}
          >
            {busy ? '正在叫醒…' : '唤醒一下 AI'}
          </button>
          {health?.providers.volc_tts?.configured ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void previewCloudVoice()}
              disabled={busy}
            >
              试听一下云端声音
            </button>
          ) : null}
        </div>
        {healthFeedback ? (
          <span className={`settings-feedback ${healthFeedback.tone}`}>
            {healthFeedback.text}
          </span>
        ) : null}
        {cloudPreviewFeedback ? (
          <span className={`settings-feedback ${cloudPreviewFeedback.tone}`}>
            {cloudPreviewFeedback.text}
          </span>
        ) : null}
        <details className="advanced-settings">
          <summary>高级连接设置</summary>
          <div className="advanced-settings-body">
            <ul className="settings-providers">
              <li>服务版本：{health?.version ?? '未连接'}</li>
              <li>服务地址：{configStore.getBaseUrl()}</li>
              <li>上次检查：{formatCheckedAt(snapshot.checkedAt)}</li>
              <li>Backend 可达：{health === null ? '否' : '是'}</li>
              <li>DeepSeek 已配置：{deepseek?.configured === true ? '是' : '否'}</li>
              <li>DeepSeek 已验证：{verificationSummary(deepseek)}</li>
              <li>最近一次反馈：{requestSummary(deepseek)}</li>
            </ul>
            {locked ? (
              <p className="settings-meta">正式版本地址已固定，不能在 App 内修改。</p>
            ) : (
              <>
                <label className="settings-field">
                  <span>Backend 地址</span>
                  <input
                    type="text"
                    value={addressDraft}
                    placeholder="http://192.168.0.26:8000"
                    onChange={(event) => setAddressDraft(event.target.value)}
                  />
                </label>
                <p className="settings-meta">
                  填写到端口即可；公网部署必须使用 HTTPS。
                </p>
                {usesPlainHttp ? (
                  <div className="inline-note" role="note">
                    HTTP 仅用于 localhost、.local 或私有局域网地址。
                  </div>
                ) : null}
              </>
            )}
            {health !== null ? (
              <ul className="settings-providers">
                <li>文本分析：{providerSummary(health.providers.deepseek)}</li>
                <li>自然朗读：{ttsSummary(health.providers.volc_tts)}</li>
                <li>当前播报：{preferredVoice.isAvailable() ? '云端音色' : '系统音色'}</li>
              </ul>
            ) : null}
            <div className="settings-actions">
              {locked ? null : (
                <button type="button" className="secondary-button" onClick={() => void saveConfig()} disabled={busy}>
                  保存服务地址
                </button>
              )}
              <button type="button" className="secondary-button" onClick={() => void verifyUpstream()} disabled={busy}>
                验证上游服务
              </button>
            </div>
            {saveFeedback ? <span className={`settings-feedback ${saveFeedback.tone}`}>{saveFeedback.text}</span> : null}
            {verifyFeedback ? <span className={`settings-feedback ${verifyFeedback.tone}`}>{verifyFeedback.text}</span> : null}
          </div>
        </details>
      </section>

      <section className="settings-card">
        <div className="settings-card-heading">
          <span className="settings-card-icon"><Headphones aria-hidden="true" size={20} /></span>
          <div>
            <p className="eyebrow">Playback</p>
            <h2>系统朗读</h2>
          </div>
        </div>
        <div className="preference-grid playback-preferences">
          <label className="settings-field">
            <span>考官音色预设</span>
            <select
              aria-label="考官音色预设"
              value={preferences.ttsVoicePreset}
              onChange={(event) => void savePreference({
                ttsVoicePreset: event.target.value as UserPreferences['ttsVoicePreset'],
              })}
            >
              <option value="backend-default">云端默认</option>
              {TTS_VOICE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <small className="settings-meta">
              {selectedVoicePreset.description} · {selectedVoicePreset.accent}
            </small>
          </label>
          <label className="settings-field">
            <span>默认音色来源</span>
            <select
              aria-label="默认音色来源"
              value={preferences.ttsVoiceMode}
              onChange={(event) => void savePreference({ ttsVoiceMode: event.target.value as 'natural-first' | 'system' })}
            >
              <option value="natural-first">自然音色优先 · 失败自动用系统音色</option>
              <option value="system">只用本机系统音色</option>
            </select>
          </label>
          <label className="settings-field range-field">
            <span>朗读语速 · {preferences.ttsRate.toFixed(2)}×</span>
            <input
              aria-label="朗读语速"
              type="range"
              min="0.75"
              max="1.2"
              step="0.05"
              value={preferences.ttsRate}
              onChange={(event) => void savePreference({ ttsRate: Number(event.target.value) })}
            />
          </label>
          <label className="settings-field range-field">
            <span>音高 · {preferences.ttsPitch.toFixed(2)}×</span>
            <input
              aria-label="朗读音高"
              type="range"
              min="0.85"
              max="1.15"
              step="0.05"
              value={preferences.ttsPitch}
              onChange={(event) => void savePreference({ ttsPitch: Number(event.target.value) })}
            />
          </label>
        </div>
        <p className="settings-meta">
          云端音色会使用所选考官预设；切换到系统音色时，设备可能不支持指定 speaker，但仍会应用语速和音高。
        </p>
        <ul className="settings-providers">
          <li>
            系统朗读引擎：
            {systemTtsStatus === null
              ? '正在检测…'
              : (systemTtsStatus.engine ?? '未检测到')}
          </li>
          <li>
            英语语音包:
            {systemTtsStatus === null
              ? '正在检测…'
              : systemTtsStatus.englishAvailable
                ? '已检测到'
                : '未检测到（英语题目会无法发声）'}
          </li>
        </ul>
        <div className="settings-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void testSystemTts()}
            disabled={busy}
          >
            测试系统朗读
          </button>
          {ttsFeedback ? (
            <span className={`settings-feedback ${ttsFeedback.tone}`}>
              {ttsFeedback.text}
            </span>
          ) : null}
        </div>
      </section>

      <StorageManager
        maintenance={dataMaintenance}
        backupService={backupService}
        onChanged={onDataChanged}
      />
    </div>
  )
}

function providerSummary(provider: BackendProviderHealth | undefined): string {
  if (provider === undefined || !provider.configured) {
    return '未配置'
  }
  const verification = provider.verification
  const verificationLabel = verification === undefined || verification.status === 'unverified'
    ? '已配置密钥，尚未实际验证'
    : verification.status === 'verified'
      ? `已验证${verification.checkedAt ? ` · ${formatCheckedAt(new Date(verification.checkedAt).getTime())}` : ''}`
      : `验证失败${verification.lastError ? ` · ${verification.lastError}` : ''}`
  return `${provider.model ?? ''} · ${verificationLabel}`
}

function verificationSummary(provider: BackendProviderHealth | undefined): string {
  if (provider === undefined) return '未读取'
  if (!provider.configured) return '未配置'
  const verification = provider.verification
  if (verification === undefined || verification.status === 'unverified') {
    return '尚未实际验证'
  }
  if (verification.status === 'verified') {
    return '是'
  }
  return `否${verification.lastError ? ` · ${verification.lastError}` : ''}`
}

function friendlyServiceSummary(
  health: BackendHealthSnapshot['health'],
  provider: BackendProviderHealth | undefined,
): string {
  if (health === null) return '暂时连不上，离线练习不受影响'
  const request = provider?.lastRequest
  if (request === undefined || request.status === 'never') return '连接正常，还没跑过一次反馈'
  if (request.status === 'succeeded') return '连接正常，反馈可以使用'
  return '已经连接，上次反馈没成功'
}

function friendlyModelSummary(provider: BackendProviderHealth | undefined): string {
  if (provider?.configured !== true) return '还没准备好'
  if (provider.verification?.status === 'verified') return '已配置，可以使用'
  if (provider.verification?.status === 'failed') return '已配置，需要重新检查'
  return '已配置，待验证'
}

function requestSummary(provider: BackendProviderHealth | undefined): string {
  const request = provider?.lastRequest
  if (request === undefined || request.status === 'never') return '尚未请求'
  if (request.status === 'succeeded') return '成功'
  return `失败${request.lastError ? ` · ${request.lastError}` : ''}`
}

function ttsSummary(provider: BackendProviderHealth | undefined): string {
  const base = providerSummary(provider)
  if (provider === undefined || !provider.configured) {
    return base
  }
  const speaker = provider.speaker
    ? ` · 音色 ${provider.speaker.name ? `${provider.speaker.name}(${provider.speaker.id})` : provider.speaker.id}`
    : ''
  return `${base}${speaker}`
}

function formatCheckedAt(checkedAt: number): string {
  if (checkedAt <= 0) {
    return '尚未检查'
  }
  return new Date(checkedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
