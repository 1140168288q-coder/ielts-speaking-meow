import { useEffect, useState } from 'react'
import type { AccountService } from '../../application/accountService'
import type { AccountProfile } from '../../domain/accounts'
import { formatDate } from '../practice/format'

export function AccountView({
  service,
  onSwitched,
}: {
  service: AccountService
  onSwitched: (account: AccountProfile) => void
}) {
  const [accounts, setAccounts] = useState<AccountProfile[]>([])
  const [current, setCurrent] = useState<AccountProfile | null>(() =>
    service.getCurrentAccount(),
  )
  const [message, setMessage] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [pinDraft, setPinDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [switchPin, setSwitchPin] = useState('')

  const refresh = async () => {
    setAccounts(await service.listAccounts())
    setCurrent(service.getCurrentAccount())
  }

  useEffect(() => {
    // 账号列表是一次性异步读取;仅在此处初始化页面数据。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '账号数据读取失败。')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (action: () => Promise<unknown>, success: string) => {
    setMessage(null)
    setBusy(true)
    try {
      await action()
      setMessage(success)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '账号操作失败。')
    } finally {
      setBusy(false)
    }
  }

  const create = () => {
    void run(async () => {
      await service.createAccount(nameDraft, pinDraft || null)
      setNameDraft('')
      setPinDraft('')
    }, '账号已创建。切换到该账号后，练习和个人语料会从空白开始。')
  }

  const switchAccount = (account: AccountProfile) => {
    void run(async () => {
      const next = await service.switchAccount(account.id, switchPin || null)
      setSwitchPin('')
      setSwitchingId(null)
      onSwitched(next)
    }, `已切换到「${account.displayName}」。`)
  }

  return (
    <section className="page-stack account-page">
      <div className="page-title">
        <p className="eyebrow">简易账号</p>
        <h1>先分清是谁的数据</h1>
        <p>
          每个账号的练习记录、AI 反馈、个人表达和导入题互不可见。
          未来接云同步时，以账号的稳定 userId 对齐远端。
        </p>
      </div>

      {message ? <div className="notice" role="status">{message}</div> : null}

      <section className="account-current-card">
        <div>
          <p className="eyebrow">当前账号</p>
          <h2>{current?.displayName ?? '未登录'}</h2>
          <p className="account-user-id">userId: {current?.userId ?? '-'}</p>
        </div>
        <span aria-hidden="true">◎</span>
      </section>

      <section className="account-list-card">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">本机账号</p>
            <h2>切换身份</h2>
          </div>
        </div>
        {accounts.length ? (
          <div className="account-list">
            {accounts.map((account) => {
              const isCurrent = account.id === current?.id
              const hasPin = account.pinHash !== null
              const isSwitching = switchingId === account.id
              return (
                <article key={account.id} className={isCurrent ? 'active' : ''}>
                  <div>
                    <strong>{account.displayName}</strong>
                    <small>
                      创建于 {formatDate(account.createdAt)}
                      {hasPin ? ' · 有本地 PIN' : ' · 无 PIN'}
                    </small>
                  </div>
                  {isCurrent ? (
                    <span className="account-current-tag">当前</span>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button compact"
                      disabled={busy}
                      onClick={() => {
                        setSwitchingId(account.id)
                        setSwitchPin('')
                      }}
                    >
                      切换
                    </button>
                  )}
                  {isSwitching && !isCurrent ? (
                    <div className="account-switch-form">
                      {hasPin ? (
                        <label>
                          <span>输入该账号的 4-6 位 PIN</span>
                          <input
                            type="password"
                            inputMode="numeric"
                            maxLength={6}
                            aria-label="输入该账号的 4-6 位 PIN"
                            value={switchPin}
                            onChange={(event) => setSwitchPin(event.target.value)}
                          />
                        </label>
                      ) : null}
                      <button
                        type="button"
                        className="primary-button compact"
                        disabled={busy || (hasPin && switchPin.length < 4)}
                        onClick={() => void switchAccount(account)}
                      >
                        确认切换
                      </button>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : (
          <p className="settings-note">正在读取账号…</p>
        )}
      </section>

      <section className="account-create-card">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">新账号</p>
            <h2>为家人或另一份学习计划创建身份</h2>
          </div>
        </div>
        <label className="account-field">
          <span>昵称</span>
          <input
            value={nameDraft}
            maxLength={40}
            aria-label="昵称"
            placeholder="例如：小明、妈妈"
            onChange={(event) => setNameDraft(event.target.value)}
          />
        </label>
        <label className="account-field">
          <span>本地 PIN（可选，4-6 位数字）</span>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            aria-label="本地 PIN（可选，4-6 位数字）"
            value={pinDraft}
            placeholder="留空则切换时无需 PIN"
            onChange={(event) => setPinDraft(event.target.value)}
          />
        </label>
        <p className="settings-note">
          PIN 只用于防止误切换到别人账号，不是加密也不是密码找回凭证；
          本应用没有社交、会员或云端注册。
        </p>
        <button
          type="button"
          className="primary-button"
          disabled={busy || nameDraft.trim().length === 0 || (pinDraft.length > 0 && !/^\d{4,6}$/.test(pinDraft))}
          onClick={create}
        >
          {busy ? '正在保存…' : '创建本地账号'}
        </button>
      </section>
    </section>
  )
}
