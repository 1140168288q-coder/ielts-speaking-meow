import { useEffect, useId, useState, type FormEvent } from 'react'
import {
  Gauge,
  LogOut,
  Save,
  ShieldAlert,
  Trash2,
  UserRound,
} from 'lucide-react'
import {
  CloudAuthError,
  type AuthTokenStore,
  type CloudAccountOverview,
  type CloudAccountSession,
  type CloudAuthGateway,
  type CloudFeatureCapability,
} from '../../domain/cloudAccount'

interface CloudAccountManagementProps {
  client: CloudAuthGateway
  tokenStore: AuthTokenStore
  session: CloudAccountSession
  onSessionUpdated: (session: CloudAccountSession) => void
  onSignedOut: (message: string) => void
}

type BusyAction = 'loading' | 'profile' | 'logout-all' | 'delete' | null

const FEATURE_ORDER = ['feedback', 'tts', 'sync'] as const

export function CloudAccountManagement({
  client,
  tokenStore,
  session,
  onSessionUpdated,
  onSignedOut,
}: CloudAccountManagementProps) {
  const displayNameId = useId()
  const deletePasswordId = useId()
  const deleteConfirmationId = useId()
  const [overview, setOverview] = useState<CloudAccountOverview | null>(null)
  const [displayName, setDisplayName] = useState(session.user.displayName ?? '')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(
    client.getAccountOverview ? 'loading' : null,
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeIsError, setNoticeIsError] = useState(false)

  useEffect(() => {
    if (!client.getAccountOverview) return
    let active = true
    void client.getAccountOverview(tokenStore)
      .then((next) => {
        if (!active) return
        setOverview(next)
        setDisplayName(next.user.displayName ?? '')
        setNotice(null)
      })
      .catch((error: unknown) => {
        if (!active) return
        setNotice('暂时无法读取套餐与用量；登录和本机练习不受影响。')
        setNoticeIsError(true)
        if (error instanceof CloudAuthError && error.code === 'session-expired') {
          onSignedOut('登录状态已过期，请重新登录。')
        }
      })
      .finally(() => {
        if (active) setBusy(null)
      })
    return () => {
      active = false
    }
  }, [client, onSignedOut, session.user.id, tokenStore])

  if (
    !client.getAccountOverview &&
    !client.updateProfile &&
    !client.logoutAll &&
    !client.deleteAccount
  ) {
    return null
  }

  const updateProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!client.updateProfile) return
    setBusy('profile')
    setNotice(null)
    setNoticeIsError(false)
    try {
      const next = await client.updateProfile(displayName, tokenStore)
      setOverview(next)
      setDisplayName(next.user.displayName ?? '')
      onSessionUpdated({ ...session, user: next.user })
      setNotice('云账号资料已更新。')
    } catch (error) {
      setNotice(readManagementError(error))
      setNoticeIsError(true)
    } finally {
      setBusy(null)
    }
  }

  const logoutAll = async () => {
    if (!client.logoutAll) return
    setBusy('logout-all')
    setNotice(null)
    setNoticeIsError(false)
    try {
      await client.logoutAll(tokenStore)
      onSignedOut('已退出所有设备；本机离线资料仍保留。')
    } catch (error) {
      setNotice(readManagementError(error))
      setNoticeIsError(true)
      setBusy(null)
    }
  }

  const deleteAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!client.deleteAccount || !deleteConfirmed) return
    setBusy('delete')
    setNotice(null)
    setNoticeIsError(false)
    try {
      await client.deleteAccount(deletePassword, tokenStore)
      setDeletePassword('')
      setDeleteConfirmed(false)
      onSignedOut('云账号和云端个人资料已删除；本机离线资料仍保留，可在本机账号中继续使用。')
    } catch (error) {
      setNotice(readManagementError(error))
      setNoticeIsError(true)
      setBusy(null)
    }
  }

  const capabilities = overview
    ? FEATURE_ORDER.flatMap((key) => {
        const capability = overview.capabilities[key]
        return capability ? [[key, capability] as const] : []
      })
    : []

  return (
    <div className="cloud-account-management">
      {overview ? (
        <section className="cloud-plan-card" aria-label="套餐与本期用量">
          <div className="cloud-management-heading">
            <div>
              <p className="eyebrow">套餐与能力</p>
              <h3>{overview.billing.plan === 'pro' ? 'Pro' : '免费版'}</h3>
            </div>
            <Gauge aria-hidden="true" size={20} />
          </div>
          <div className="cloud-quota-grid">
            {capabilities.map(([key, capability]) => (
              <QuotaItem key={key} feature={key} capability={capability} />
            ))}
          </div>
          <p className="settings-note">
            这里只统计云端请求，不记录答案正文。额度会按各能力标注的日期重置。
          </p>
        </section>
      ) : busy === 'loading' ? (
        <p className="settings-note" role="status">正在读取账号能力与本期用量…</p>
      ) : null}

      {client.updateProfile ? (
        <form className="cloud-profile-form" onSubmit={(event) => void updateProfile(event)}>
          <div className="cloud-management-heading">
            <div>
              <p className="eyebrow">基本资料</p>
              <h3>云端昵称</h3>
            </div>
            <UserRound aria-hidden="true" size={20} />
          </div>
          <label className="account-field" htmlFor={displayNameId}>
            <span>昵称</span>
            <input
              id={displayNameId}
              value={displayName}
              maxLength={80}
              autoComplete="nickname"
              placeholder="例如：口语练习者"
              disabled={busy !== null}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="secondary-button compact"
            disabled={busy !== null}
          >
            <Save aria-hidden="true" size={16} />
            {busy === 'profile' ? '正在保存…' : '保存云端资料'}
          </button>
        </form>
      ) : null}

      {client.logoutAll || client.deleteAccount ? (
        <details className="cloud-security-panel">
          <summary>
            <span><ShieldAlert aria-hidden="true" size={18} />账号安全与删除</span>
            <small>展开管理敏感操作</small>
          </summary>
          <div className="cloud-security-content">
            {client.logoutAll ? (
              <div className="cloud-security-action">
                <div>
                  <strong>退出所有设备</strong>
                  <p>撤销当前云账号的全部登录状态，不删除任何资料。</p>
                </div>
                <button
                  type="button"
                  className="secondary-button compact"
                  disabled={busy !== null}
                  onClick={() => void logoutAll()}
                >
                  <LogOut aria-hidden="true" size={16} />
                  {busy === 'logout-all' ? '正在退出…' : '全部退出'}
                </button>
              </div>
            ) : null}

            {client.deleteAccount ? (
              <form className="cloud-delete-form" onSubmit={(event) => void deleteAccount(event)}>
                <div>
                  <strong>永久删除云账号</strong>
                  <p>云端同步资料、用量与会话会被清除；本机离线资料不会自动删除。</p>
                </div>
                <label className="account-field" htmlFor={deletePasswordId}>
                  <span>当前密码</span>
                  <input
                    id={deletePasswordId}
                    type="password"
                    value={deletePassword}
                    minLength={8}
                    maxLength={128}
                    autoComplete="current-password"
                    required
                    disabled={busy !== null}
                    onChange={(event) => setDeletePassword(event.target.value)}
                  />
                </label>
                <label className="cloud-delete-confirmation" htmlFor={deleteConfirmationId}>
                  <input
                    id={deleteConfirmationId}
                    type="checkbox"
                    checked={deleteConfirmed}
                    disabled={busy !== null}
                    onChange={(event) => setDeleteConfirmed(event.target.checked)}
                  />
                  <span>我理解云端个人资料将永久删除，且无法恢复。</span>
                </label>
                <button
                  type="submit"
                  className="danger-button compact"
                  disabled={busy !== null || !deleteConfirmed || deletePassword.length < 8}
                >
                  <Trash2 aria-hidden="true" size={16} />
                  {busy === 'delete' ? '正在删除…' : '永久删除云账号'}
                </button>
              </form>
            ) : null}
          </div>
        </details>
      ) : null}

      {notice ? (
        <p className="notice" role={noticeIsError ? 'alert' : 'status'}>{notice}</p>
      ) : null}
    </div>
  )
}

function QuotaItem({
  feature,
  capability,
}: {
  feature: typeof FEATURE_ORDER[number]
  capability: CloudFeatureCapability
}) {
  const limit = capability.quotaLimit
  const value = limit === null ? 0 : Math.min(capability.quotaUsed, limit)
  const disabledReason = capability.reason === 'email-not-verified'
    ? '验证邮箱后启用'
    : (capability.enabled ? null : '当前不可用')

  return (
    <article className="cloud-quota-item">
      <div>
        <strong>{featureLabel(feature)}</strong>
        <span>{disabledReason ?? quotaLabel(capability)}</span>
      </div>
      {limit !== null ? (
        <progress
          aria-label={`${featureLabel(feature)}用量`}
          max={Math.max(1, limit)}
          value={value}
        />
      ) : (
        <span className="cloud-unlimited-badge">不限量</span>
      )}
      <small>重置：{formatShortDate(capability.resetsAt)}</small>
    </article>
  )
}

function featureLabel(feature: typeof FEATURE_ORDER[number]): string {
  if (feature === 'feedback') return 'AI 反馈'
  if (feature === 'tts') return '自然语音'
  return '云同步'
}

function quotaLabel(capability: CloudFeatureCapability): string {
  if (capability.quotaLimit === null) return '不限量'
  const unit = capability.unit === 'character' ? '字符' : '次'
  return `${capability.quotaUsed} / ${capability.quotaLimit} ${unit}`
}

function formatShortDate(value: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function readManagementError(error: unknown): string {
  if (error instanceof CloudAuthError) return error.message
  if (error instanceof Error && error.message.trim()) return error.message
  return '云账号操作失败，请稍后重试。'
}
