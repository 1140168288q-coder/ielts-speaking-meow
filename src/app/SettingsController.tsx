import { useCallback, useEffect, useState } from 'react'
import type {
  BackendConfigStore,
  BackendHealthCache,
  BackendHealthSnapshot,
  BackendProviderHealth,
} from '../infrastructure/backend'
import type {
  STTProvider,
  SystemTTSProvider,
  SystemTtsStatus,
  TTSProvider,
} from '../ports/speech'
import type { LocalDataMaintenance } from '../ports/storage'
import type { StorageBackupService } from '../application/storageBackupService'
import { StorageManager } from '../features/storage'

export interface SettingsControllerProps {
  configStore: BackendConfigStore
  healthCache: BackendHealthCache
  systemStt: STTProvider
  /** 本机系统 TTS(Android)。「测试系统朗读」必须直连它,不走 AI 优先链路。 */
  systemTts: SystemTTSProvider
  /** 首选云端音色(BackendTtsProvider);用于展示当前实际播报来源与试听。 */
  preferredVoice: TTSProvider
  dataMaintenance: LocalDataMaintenance
  backupService: StorageBackupService
  onDataChanged: () => Promise<void>
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
export function SettingsController({
  configStore,
  healthCache,
  systemStt,
  systemTts,
  preferredVoice,
  dataMaintenance,
  backupService,
  onDataChanged,
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
        text: result.failure ?? '云端服务暂不可用。',
      })
    }
  }

  const verifyUpstream = async () => {
    if (busy) return
    setBusy(true)
    setVerifyFeedback({ tone: 'busy', text: '正在真实调用上游服务验证…' })
    try {
      const result = await healthCache.verifyProviders()
      setSnapshot(result)
      if (result.health === null) {
        setVerifyFeedback({
          tone: 'error',
          text: result.failure ?? '云端服务暂不可用,无法验证上游。',
        })
        return
      }
      const failed = (['deepseek', 'volc_tts'] as const).filter(
        (name) => healthCache.verificationOf(name)?.status === 'failed',
      )
      if (failed.length > 0) {
        setVerifyFeedback({
          tone: 'error',
          text: '验证失败：密钥可能无效或未开通对应资源，请检查 Backend 配置。',
        })
      } else {
        setVerifyFeedback({
          tone: 'success',
          text: '上游验证通过：DeepSeek 与云端 TTS 均可正常调用。',
        })
      }
    } catch (error) {
      setVerifyFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : '上游验证失败。',
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
          text: '当前设备没有可用的系统 TTS 引擎，请在系统设置中安装或启用。',
        })
        return
      }
      if (!status.englishAvailable) {
        setTtsFeedback({
          tone: 'error',
          text: '未检测到英语语音包：请安装英语语音包或切换 TTS 引擎后再试，否则英语题目会“正在播报”但无声。',
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

  /** 试听服务端当前配置的云端音色(同时就是一次真实验证)。 */
  const previewCloudVoice = async () => {
    if (busy) return
    if (!preferredVoice.isAvailable()) {
      setCloudPreviewFeedback({
        tone: 'error',
        text: '云端语音当前不可用（未连接、未配置或已熔断），正在使用系统朗读。',
      })
      return
    }
    setCloudPreviewFeedback({ tone: 'busy', text: '正在合成云端音色…' })
    try {
      await preferredVoice.speak({
        text: CLOUD_PREVIEW_TEXT,
        language: 'en-US',
        rate: 0.92,
      })
      setCloudPreviewFeedback({ tone: 'success', text: '云端音色试听完成。' })
      void healthCache.refresh().then(setSnapshot)
    } catch (error) {
      setCloudPreviewFeedback({
        tone: 'error',
        text: error instanceof Error
          ? `${error.message} 已切换系统朗读。`
          : '云端音色播放失败，已切换系统朗读。',
      })
    }
  }

  const health = snapshot.health
  const usesPlainHttp = addressDraft.trim().toLowerCase().startsWith('http://')

  return (
    <div className="settings-panel">
      <section className="settings-card">
        <h2 className="section-heading">云端服务</h2>
        <p className="settings-note">
          转写、Text AI 反馈与 AI 语音均由你自己的云端服务提供。云端不可用时,
          录音保存、本地反馈、系统朗读等能力仍可正常使用。
        </p>
        <ul className="settings-providers">
          <li>
            连接状态:{health === null ? '离线' : `已连接 · Backend ${health.version ?? '版本未知'}`}
          </li>
          <li>Backend 地址:{configStore.getBaseUrl()}</li>
          {locked ? (
            <li className="settings-meta">正式版本地址已固定，不能在设置页修改。</li>
          ) : null}
          <li>上次检查:{formatCheckedAt(snapshot.checkedAt)}</li>
        </ul>
        {locked ? null : (
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
              只需填写到端口，例如 http://192.168.0.26:8000；不要添加 /health。
              如果粘贴了健康检查地址，保存时会自动纠正。
            </p>
            {usesPlainHttp ? (
              <div className="inline-note" role="note">
                HTTP 仅允许用于 localhost、.local 或私有局域网地址；公网部署必须使用 HTTPS。
              </div>
            ) : null}
          </>
        )}
        <div className="settings-actions">
          {locked ? null : (
            <button
              type="button"
              className="primary-button"
              onClick={() => void saveConfig()}
              disabled={busy}
            >
              保存配置
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() => void refreshHealth()}
            disabled={busy}
          >
            {busy ? '检查中…' : '测试云端连接'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void verifyUpstream()}
            disabled={busy}
          >
            验证上游服务
          </button>
        </div>
        {saveFeedback ? (
          <span className={`settings-feedback ${saveFeedback.tone}`}>
            {saveFeedback.text}
          </span>
        ) : null}
        {healthFeedback ? (
          <span className={`settings-feedback ${healthFeedback.tone}`}>
            {healthFeedback.text}
          </span>
        ) : null}
        {verifyFeedback ? (
          <span className={`settings-feedback ${verifyFeedback.tone}`}>
            {verifyFeedback.text}
          </span>
        ) : null}
        {health !== null ? (
          <ul className="settings-providers">
            <li>DeepSeek(Text AI):{providerSummary(health.providers.deepseek)}</li>
            <li>火山流式语音识别(STT):{sttSummary(health.providers.volc_stt)}</li>
            <li>火山语音合成(TTS):{ttsSummary(health.providers.volc_tts)}</li>
            <li>
              当前实际播报来源:
              {preferredVoice.isAvailable() ? '云端音色' : 'Android 系统音色'}
            </li>
          </ul>
        ) : null}
        {health?.providers.volc_tts?.configured ? (
          <div className="settings-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void previewCloudVoice()}
              disabled={busy}
            >
              试听云端音色
            </button>
            {cloudPreviewFeedback ? (
              <span className={`settings-feedback ${cloudPreviewFeedback.tone}`}>
                {cloudPreviewFeedback.text}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="settings-card">
        <h2 className="section-heading">本机能力</h2>
        <p className="settings-note">
          本机实时转写:{systemStt.isAvailable() ? '可用' : '当前 WebView 不支持,可手动输入转写。'}
        </p>
        <ul className="settings-providers">
          <li>
            系统 TTS 引擎:
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

function sttSummary(provider: BackendProviderHealth | undefined): string {
  const base = providerSummary(provider)
  if (provider === undefined || !provider.configured) {
    return base
  }
  const resource = provider.resourceId ? ` · 资源 ${provider.resourceId}` : ''
  const lastResult = provider.verification?.lastResult
  const sample = lastResult ? ` · 最近转写:「${lastResult}」` : ''
  return `${base}${resource}${sample}`
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
