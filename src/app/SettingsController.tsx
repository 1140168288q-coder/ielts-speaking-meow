import { useState } from 'react'
import type { BackendClient, BackendHealth } from '../infrastructure/backend'
import type { AudioFocus, STTProvider } from '../ports/speech'

export interface SettingsControllerProps {
  backendClient: BackendClient
  systemStt: STTProvider
  audioFocus: AudioFocus
}

type FeedbackTone = 'idle' | 'busy' | 'success' | 'error'

/**
 * 设置页:普通用户不再填写任何第三方 API Key。这里只展示云端服务状态、
 * 本机系统能力测试,以及 Backend 地址(构建期注入,仅作展示)。
 */
export function SettingsController({
  backendClient,
  systemStt,
  audioFocus,
}: SettingsControllerProps) {
  const [health, setHealth] = useState<BackendHealth | null>(null)
  const [backendFeedback, setBackendFeedback] = useState<{
    tone: FeedbackTone
    text: string
  } | null>(null)
  const [ttsFeedback, setTtsFeedback] = useState<{
    tone: FeedbackTone
    text: string
  } | null>(null)
  const [busy, setBusy] = useState(false)

  const checkBackend = async () => {
    if (busy) return
    setBusy(true)
    setBackendFeedback({ tone: 'busy', text: '正在连接云端服务…' })
    try {
      const result = await backendClient.getHealth()
      setHealth(result)
      setBackendFeedback({
        tone: 'success',
        text: '云端服务连接正常。',
      })
    } catch (error) {
      setHealth(null)
      setBackendFeedback({
        tone: 'error',
        text: error instanceof Error
          ? error.message
          : '云端服务暂不可用。',
      })
    } finally {
      setBusy(false)
    }
  }

  const testSystemTts = async () => {
    if (busy) return
    setTtsFeedback({ tone: 'busy', text: '正在播放测试语音…' })
    try {
      await audioFocus.speak({ text: 'System voice is ready.', language: 'en-US' })
      setTtsFeedback({ tone: 'success', text: '系统朗读正常。' })
    } catch (error) {
      setTtsFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : '系统朗读不可用。',
      })
    }
  }

  return (
    <div className="settings-panel">
      <section className="settings-card">
        <h2 className="section-heading">云端服务</h2>
        <p className="settings-note">
          转写、Text AI 反馈与 AI 语音均由云端服务提供,无需在本机配置密钥。
          云端不可用时,录音保存、本地反馈、系统朗读等能力仍可正常使用。
        </p>
        <p className="settings-meta">
          Backend 地址:{backendClient.url}(打包时注入)
        </p>
        <div className="settings-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void checkBackend()}
            disabled={busy}
          >
            {busy ? '检查中…' : '测试云端连接'}
          </button>
          {backendFeedback ? (
            <span className={`settings-feedback ${backendFeedback.tone}`}>
              {backendFeedback.text}
            </span>
          ) : null}
        </div>
        {health ? (
          <ul className="settings-providers">
            <li>DeepSeek(Text AI):{providerLabel(health.providers.deepseek)}</li>
            <li>火山流式语音识别(STT):{providerLabel(health.providers.volc_stt)}</li>
            <li>火山语音合成(TTS):{providerLabel(health.providers.volc_tts)}</li>
          </ul>
        ) : null}
      </section>

      <section className="settings-card">
        <h2 className="section-heading">本机能力</h2>
        <p className="settings-note">
          本机实时转写:{systemStt.isAvailable() ? '可用' : '当前 WebView 不支持,可手动输入转写。'}
        </p>
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
    </div>
  )
}

function providerLabel(configured: boolean | undefined): string {
  return configured ? '已配置' : '未配置'
}
