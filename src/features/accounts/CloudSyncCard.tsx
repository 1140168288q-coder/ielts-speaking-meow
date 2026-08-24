import { useId, useState } from 'react'
import { AlertTriangle, CloudCheck, Database, RefreshCw } from 'lucide-react'

export type CloudSyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'conflict'

export function CloudSyncCard({
  status,
  message,
  destination,
  emailVerified,
  bindingRequired = false,
  localProfileName = '当前本地资料身份',
  onSync,
}: {
  status: CloudSyncStatus
  message: string
  destination: string
  emailVerified: boolean
  bindingRequired?: boolean
  localProfileName?: string
  onSync: () => void
}) {
  const consentId = useId()
  const [consented, setConsented] = useState(false)
  const isBusy = status === 'syncing'
  const StatusIcon = status === 'error' || status === 'conflict'
    ? AlertTriangle
    : CloudCheck

  return (
    <section className="cloud-sync-card">
      <span className="settings-card-icon"><StatusIcon aria-hidden="true" size={20} /></span>
      <div>
        <p className="eyebrow">Cloud sync</p>
        <h2>手动同步当前资料</h2>
        <p>
          只在你本次确认后，与 <strong>{destination}</strong> 双向同步以下永久资料。
        </p>
        <ul className="sync-scope-list" aria-label="本次同步范围">
          <li><Database aria-hidden="true" size={15} />练习记录与已保存的 AI 文本反馈</li>
          <li><Database aria-hidden="true" size={15} />个人语料（你确认保留的英文表达）</li>
          <li><Database aria-hidden="true" size={15} />个人素材（你确认保留的故事与观点）</li>
        </ul>
        <p className="privacy-caption">
          不同步未提交草稿、Memory 快照、原始录音、导入文件、语音缓存或密钥。
        </p>
        {message ? (
          <div className={`sync-message ${status}`} role={status === 'error' || status === 'conflict' ? 'alert' : 'status'}>
            {message}
          </div>
        ) : null}
        <label className="sync-consent" htmlFor={consentId}>
          <input
            id={consentId}
            type="checkbox"
            checked={consented}
            disabled={!emailVerified || isBusy}
            onChange={(event) => setConsented(event.target.checked)}
          />
          <span>
            {emailVerified
              ? bindingRequired
                ? `我确认将“${localProfileName}”绑定到当前云账号，并同步上述三类资料。`
                : '我确认把上述三类资料同步到这个已绑定的云账号。'
              : '请先验证邮箱，再确认同步范围。'}
          </span>
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={isBusy || !emailVerified || !consented}
          onClick={() => {
            setConsented(false)
            onSync()
          }}
        >
          <RefreshCw className={isBusy ? 'spin' : ''} aria-hidden="true" size={17} />
          {isBusy ? '正在安全同步…' : '确认并开始同步'}
        </button>
      </div>
    </section>
  )
}
