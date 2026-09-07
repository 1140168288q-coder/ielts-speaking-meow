import { useState } from 'react'
import type {
  UserPreferences,
  UserPreferencesUpdate,
} from '../../domain/userPreferences'

type FeedbackTone = 'idle' | 'busy' | 'success' | 'error'

interface Feedback {
  tone: FeedbackTone
  text: string
}

export function MemoryPrivacyCard({
  preferences,
  onPreferencesChange,
}: {
    preferences: Pick<UserPreferences, 'memoryEnabled' | 'autoMatchPersonalMaterialsWithAi'>
  onPreferencesChange: (update: UserPreferencesUpdate) => Promise<void>
}) {
  const [preferenceFeedback, setPreferenceFeedback] = useState<Feedback | null>(null)

  const savePreference = async (update: UserPreferencesUpdate) => {
    setPreferenceFeedback({ tone: 'busy', text: '正在保存偏好…' })
    try {
      await onPreferencesChange(update)
      setPreferenceFeedback({ tone: 'success', text: '偏好已保存到当前本地账号。' })
    } catch (error) {
      setPreferenceFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : '偏好保存失败。',
      })
    }
  }

  return (
    <section className="settings-card preference-settings-card">
      <div>
        <p className="eyebrow">Memory & privacy</p>
        <h2>长期了解与隐私</h2>
        <p className="settings-note">Memory 只从当前账号的练习、表达和确认素材推导，不读取其他账号。</p>
      </div>
      <label className="settings-switch">
        <input
          type="checkbox"
          checked={preferences.memoryEnabled}
          onChange={(event) => void savePreference({ memoryEnabled: event.target.checked })}
        />
        <span><strong>在训练中使用长期 Memory</strong><small>关闭后不推荐旧表达，也不向 AI 发送学习者摘要。</small></span>
      </label>
      <label className="settings-switch">
        <input
          type="checkbox"
          checked={preferences.autoMatchPersonalMaterialsWithAi}
          disabled={!preferences.memoryEnabled}
          onChange={(event) => void savePreference({ autoMatchPersonalMaterialsWithAi: event.target.checked })}
        />
        <span><strong>AI 分析时自动匹配可用素材</strong><small>{preferences.memoryEnabled ? '默认开启；仅发送与本题相关的短片段，不发送完整素材库。' : '开启长期 Memory 后可使用；关闭时不会向 AI 发送任何学习者上下文。'}</small></span>
      </label>
      {preferenceFeedback ? (
        <span className={`settings-feedback ${preferenceFeedback.tone}`}>{preferenceFeedback.text}</span>
      ) : null}
    </section>
  )
}
