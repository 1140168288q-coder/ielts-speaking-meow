import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  Cloud,
  KeyRound,
  LogOut,
  MailCheck,
  Send,
  ShieldCheck,
} from 'lucide-react'
import {
  CloudAuthError,
  type AuthTokenStore,
  type CloudAccountSession,
  type CloudAuthGateway,
} from '../../domain/cloudAccount'
import { CloudAccountManagement } from './CloudAccountManagement'

type AuthMode =
  | 'login'
  | 'register'
  | 'reset-request'
  | 'reset-confirm'
  | 'verify-confirm'
const ignoreSessionChange = () => undefined

export interface CloudAccountPanelProps {
  client: CloudAuthGateway
  tokenStore: AuthTokenStore
  onSessionChange?: (session: CloudAccountSession | null) => void
}

export function CloudAccountPanel({
  client,
  tokenStore,
  onSessionChange = ignoreSessionChange,
}: CloudAccountPanelProps) {
  const emailId = useId()
  const passwordId = useId()
  const confirmId = useId()
  const accountTokenId = useId()
  const verificationTokenId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const onSessionChangeRef = useRef(onSessionChange)
  const [linkIntent] = useState(readAccountLinkIntent)
  const [mode, setMode] = useState<AuthMode>(() => {
    if (linkIntent?.action === 'verify-email') return 'verify-confirm'
    if (linkIntent?.action === 'reset-password') return 'reset-confirm'
    return 'login'
  })
  const [session, setSession] = useState<CloudAccountSession | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [accountToken, setAccountToken] = useState(
    linkIntent?.action === 'reset-password' ? linkIntent.token : '',
  )
  const [verificationToken, setVerificationToken] = useState(
    linkIntent?.action === 'verify-email' ? linkIntent.token : '',
  )
  const [status, setStatus] = useState<'restoring' | 'idle' | 'submitting'>('restoring')
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    onSessionChangeRef.current = onSessionChange
  }, [onSessionChange])

  useEffect(() => {
    if (linkIntent) stripSensitiveAccountQuery()
  }, [linkIntent])

  useEffect(() => {
    let active = true
    void client.restoreSession(tokenStore)
      .then((restored) => {
        if (!active) return
        setSession(restored)
        onSessionChangeRef.current(restored)
        setStatus('idle')
      })
      .catch((error: unknown) => {
        if (!active) return
        setSession(null)
        onSessionChangeRef.current(null)
        setIsError(true)
        setMessage(readErrorMessage(error))
        setStatus('idle')
      })
    return () => {
      active = false
    }
  }, [client, tokenStore])

  const selectMode = (nextMode: AuthMode, keepMessage = false) => {
    setMode(nextMode)
    setPassword('')
    setConfirmation('')
    setAccountToken('')
    if (!keepMessage) setMessage(null)
    setIsError(false)
    globalThis.requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
    })
  }

  const showError = (value: string) => {
    setMessage(value)
    setIsError(true)
  }

  const submitCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    setIsError(false)

    if (mode === 'register' && password !== confirmation) {
      showError('两次输入的密码不一致。')
      return
    }

    setStatus('submitting')
    try {
      const next = mode === 'login'
        ? await client.login({ email, password }, tokenStore)
        : await client.register({ email, password }, tokenStore)
      setSession(next)
      setPassword('')
      setConfirmation('')
      setMessage(
        next.user.emailVerified
          ? '已登录云账号。'
          : (mode === 'register'
              ? '云账号已创建。请验证邮箱后再启用跨设备能力。'
              : '已登录。当前邮箱还未验证。'),
      )
      onSessionChangeRef.current(next)
    } catch (error) {
      showError(readErrorMessage(error))
    } finally {
      setStatus('idle')
    }
  }

  const requestPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('submitting')
    setMessage(null)
    setIsError(false)
    try {
      await client.requestPasswordReset(email, tokenStore)
      setMessage('如果该邮箱已注册，重置邮件会很快送达。请粘贴邮件中的重置凭证。')
      selectMode('reset-confirm', true)
    } catch (error) {
      showError(readErrorMessage(error))
    } finally {
      setStatus('idle')
    }
  }

  const confirmPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    setIsError(false)
    if (password !== confirmation) {
      showError('两次输入的新密码不一致。')
      return
    }
    setStatus('submitting')
    try {
      await client.confirmPasswordReset(accountToken, password, tokenStore)
      setMessage('密码已更新，请使用新密码登录。其他设备上的旧登录状态已失效。')
      selectMode('login', true)
    } catch (error) {
      showError(readErrorMessage(error))
    } finally {
      setStatus('idle')
    }
  }

  const requestVerification = async () => {
    setStatus('submitting')
    setMessage(null)
    setIsError(false)
    try {
      await client.requestEmailVerification(tokenStore)
      setMessage('验证邮件已请求。请粘贴邮件中的验证凭证。')
    } catch (error) {
      showError(readErrorMessage(error))
    } finally {
      setStatus('idle')
    }
  }

  const confirmVerification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('submitting')
    setMessage(null)
    setIsError(false)
    try {
      const next = await client.confirmEmailVerification(
        verificationToken,
        tokenStore,
      )
      setVerificationToken('')
      if (next) {
        setSession(next)
        setMessage('邮箱验证完成。')
        onSessionChangeRef.current(next)
      } else {
        setMessage('邮箱验证完成，请登录云账号。')
        selectMode('login', true)
      }
    } catch (error) {
      showError(readErrorMessage(error))
    } finally {
      setStatus('idle')
    }
  }

  const logout = async () => {
    setStatus('submitting')
    setMessage(null)
    setIsError(false)
    try {
      await client.logout(tokenStore)
      setMessage('已退出云账号，本机资料仍保留。')
    } catch (error) {
      setMessage(
        error instanceof CloudAuthError && error.code === 'network'
          ? '已从本机退出；因网络异常，云端注销暂未确认。'
          : readErrorMessage(error),
      )
      setIsError(true)
    } finally {
      setSession(null)
      onSessionChangeRef.current(null)
      setStatus('idle')
    }
  }
  const updateManagedSession = (next: CloudAccountSession) => {
    setSession(next)
    onSessionChangeRef.current(next)
  }

  const finishManagedSignOut = (nextMessage: string) => {
    setSession(null)
    setMessage(nextMessage)
    setIsError(false)
    setStatus('idle')
    onSessionChangeRef.current(null)
  }


  if (status === 'restoring') {
    return (
      <section className="account-create-card" aria-busy="true">
        <p className="eyebrow">云账号</p>
        <h2>正在恢复登录状态…</h2>
        <p className="settings-note">本机练习不受影响，你仍可离线使用。</p>
      </section>
    )
  }

  if (session) {
    return (
      <section className="account-current-card cloud-account-panel">
        <div className="cloud-account-content">
          <div className="account-status-heading">
            <div>
              <p className="eyebrow">
                云账号 · {session.user.emailVerified ? '已验证' : '待验证'}
              </p>
              <h2>{session.user.email}</h2>
            </div>
            <span
              className={session.user.emailVerified ? 'verified-badge' : 'pending-badge'}
            >
              {session.user.emailVerified ? <ShieldCheck size={16} /> : <MailCheck size={16} />}
              {session.user.emailVerified ? '邮箱已验证' : '需要验证邮箱'}
            </span>
          </div>
          <p className="settings-note">
            登录有效期至 {formatAccountDate(session.expiresAt)}。学习资料同步启用前，
            本机内容不会自动上传。
          </p>

          {!session.user.emailVerified ? (
            <div className="account-verification-panel">
              <div>
                <h3>验证邮箱归属</h3>
                <p>发送验证邮件后，把邮件中的安全凭证粘贴到这里。</p>
              </div>
              <button
                type="button"
                className="secondary-button compact"
                disabled={status === 'submitting'}
                onClick={() => void requestVerification()}
              >
                <Send aria-hidden="true" size={16} />
                发送验证邮件
              </button>
              <form
                className="verification-form"
                onSubmit={(event) => void confirmVerification(event)}
              >
                <label className="account-field" htmlFor={verificationTokenId}>
                  <span>验证凭证</span>
                  <input
                    id={verificationTokenId}
                    value={verificationToken}
                    autoComplete="one-time-code"
                    placeholder="粘贴邮件中的完整凭证"
                    required
                    disabled={status === 'submitting'}
                    onChange={(event) => setVerificationToken(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="primary-button compact"
                  disabled={status === 'submitting'}
                >
                  确认验证
                </button>
              </form>
            </div>
          ) : null}

          <CloudAccountManagement
            client={client}
            tokenStore={tokenStore}
            session={session}
            onSessionUpdated={updateManagedSession}
            onSignedOut={finishManagedSignOut}
          />

          {message ? (
            <p className="notice" role={isError ? 'alert' : 'status'}>{message}</p>
          ) : null}
          <button
            type="button"
            className="secondary-button compact"
            disabled={status === 'submitting'}
            onClick={() => void logout()}
          >
            <LogOut aria-hidden="true" size={17} />

            {status === 'submitting' ? '正在处理…' : '退出云账号'}
          </button>
        </div>
        <span className="account-avatar" aria-hidden="true"><ShieldCheck size={24} /></span>
      </section>
    )
  }

  const isResetMode = mode === 'reset-request' || mode === 'reset-confirm'
  const isTokenMode = isResetMode || mode === 'verify-confirm'
  return (
    <section ref={panelRef} className="account-create-card cloud-account-panel">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">云账号</p>
          <h2>
            {mode === 'verify-confirm'
              ? '验证云账号邮箱'
              : (isResetMode ? '找回云账号密码' : '先建立安全的云端身份')}
          </h2>
        </div>
        <span className="account-avatar" aria-hidden="true">
          {isTokenMode ? <KeyRound size={22} /> : <Cloud size={22} />}
        </span>
      </div>

      <p className="settings-note">
        {mode === 'verify-confirm'
          ? '验证凭证只会使用一次；完成后再登录即可继续。'
          : isResetMode
            ? '重置请求不会显示邮箱是否存在；收到邮件后才能设置新密码。'
            : '登录不会把手机里的数据直接上传；跨设备恢复将在你明确允许同步范围后启用。'}
      </p>

      {!isTokenMode ? (
        <div className="segmented-control" role="tablist" aria-label="云账号操作">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'active' : ''}
            onClick={() => selectMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            onClick={() => selectMode('register')}
          >
            注册
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="text-button account-back-button"
          onClick={() => selectMode('login')}
        >
          <ArrowLeft aria-hidden="true" size={16} />
          返回登录
        </button>
      )}

      {message ? (
        <div className="notice" role={isError ? 'alert' : 'status'}>{message}</div>
      ) : null}

      {mode === 'verify-confirm' ? (
        <form className="page-stack" onSubmit={(event) => void confirmVerification(event)}>
          <label className="account-field" htmlFor={verificationTokenId}>
            <span>邮件中的验证凭证</span>
            <input
              id={verificationTokenId}
              value={verificationToken}
              autoComplete="one-time-code"
              placeholder="粘贴完整凭证"
              required
              disabled={status === 'submitting'}
              onChange={(event) => setVerificationToken(event.target.value)}
            />
          </label>
          <button type="submit" className="primary-button" disabled={status === 'submitting'}>
            {status === 'submitting' ? '正在验证…' : '完成邮箱验证'}
          </button>
        </form>
      ) : mode === 'reset-request' ? (
        <form className="page-stack" onSubmit={(event) => void requestPasswordReset(event)}>
          <EmailField
            id={emailId}
            value={email}
            disabled={status === 'submitting'}
            onChange={setEmail}
          />
          <button type="submit" className="primary-button" disabled={status === 'submitting'}>
            {status === 'submitting' ? '正在发送…' : '发送重置邮件'}
          </button>
        </form>
      ) : mode === 'reset-confirm' ? (
        <form className="page-stack" onSubmit={(event) => void confirmPasswordReset(event)}>
          <label className="account-field" htmlFor={accountTokenId}>
            <span>邮件中的重置凭证</span>
            <input
              id={accountTokenId}
              value={accountToken}
              autoComplete="one-time-code"
              placeholder="粘贴完整凭证"
              required
              disabled={status === 'submitting'}
              onChange={(event) => setAccountToken(event.target.value)}
            />
          </label>
          <PasswordFields
            passwordId={passwordId}
            confirmationId={confirmId}
            password={password}
            confirmation={confirmation}
            disabled={status === 'submitting'}
            onPasswordChange={setPassword}
            onConfirmationChange={setConfirmation}
            newPassword
          />
          <button type="submit" className="primary-button" disabled={status === 'submitting'}>
            {status === 'submitting' ? '正在更新…' : '更新密码'}
          </button>
        </form>
      ) : (
        <form className="page-stack" onSubmit={(event) => void submitCredentials(event)}>
          <EmailField
            id={emailId}
            value={email}
            disabled={status === 'submitting'}
            onChange={setEmail}
          />
          <PasswordFields
            passwordId={passwordId}
            confirmationId={confirmId}
            password={password}
            confirmation={confirmation}
            disabled={status === 'submitting'}
            onPasswordChange={setPassword}
            onConfirmationChange={setConfirmation}
            newPassword={mode === 'register'}
            showConfirmation={mode === 'register'}
          />
          {mode === 'login' ? (
            <button
              type="button"
              className="text-button forgot-password-button"
              onClick={() => selectMode('reset-request')}
            >
              忘记密码？
            </button>
          ) : null}
          <button type="submit" className="primary-button" disabled={status === 'submitting'}>
            {status === 'submitting'
              ? (mode === 'login' ? '正在登录…' : '正在创建…')
              : (mode === 'login' ? '登录云账号' : '创建云账号')}
          </button>
        </form>
      )}

      <p className="settings-note">
        网页预览关闭后需要重新登录；Android App 会使用系统安全存储保持登录状态。
      </p>
    </section>
  )
}

function EmailField({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="account-field" htmlFor={id}>
      <span>邮箱</span>
      <input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="email"
        value={value}
        placeholder="name@example.com"
        required
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function PasswordFields({
  passwordId,
  confirmationId,
  password,
  confirmation,
  disabled,
  onPasswordChange,
  onConfirmationChange,
  newPassword,
  showConfirmation = true,
}: {
  passwordId: string
  confirmationId: string
  password: string
  confirmation: string
  disabled: boolean
  onPasswordChange: (value: string) => void
  onConfirmationChange: (value: string) => void
  newPassword: boolean
  showConfirmation?: boolean
}) {
  return (
    <>
      <label className="account-field" htmlFor={passwordId}>
        <span>{newPassword ? '新密码' : '密码'}</span>
        <input
          id={passwordId}
          type="password"
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          minLength={8}
          maxLength={128}
          value={password}
          placeholder="至少 8 个字符"
          required
          disabled={disabled}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </label>
      {showConfirmation ? (
        <label className="account-field" htmlFor={confirmationId}>
          <span>再次输入{newPassword ? '新密码' : '密码'}</span>
          <input
            id={confirmationId}
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            value={confirmation}
            required
            disabled={disabled}
            onChange={(event) => onConfirmationChange(event.target.value)}
          />
        </label>
      ) : null}
    </>
  )
}

function readErrorMessage(error: unknown): string {
  if (error instanceof CloudAuthError) return error.message
  return '云账号操作失败，请稍后重试。'
}

function formatAccountDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value))
}

type AccountLinkIntent = {
  action: 'verify-email' | 'reset-password'
  token: string
}

function readAccountLinkIntent(): AccountLinkIntent | null {
  const params = new URLSearchParams(globalThis.location?.search ?? '')
  const action = params.get('action')
  const token = params.get('token')?.trim() ?? ''
  if (
    (action === 'verify-email' || action === 'reset-password') &&
    cloudAccountTokenIsValid(token)
  ) {
    return { action, token }
  }
  return null
}

function stripSensitiveAccountQuery(): void {
  const url = new URL(globalThis.location.href)
  url.searchParams.delete('action')
  url.searchParams.delete('token')
  const query = url.searchParams.toString()
  globalThis.history.replaceState(
    globalThis.history.state,
    '',
    `${url.pathname}${query ? `?${query}` : ''}${url.hash}`,
  )
}

function cloudAccountTokenIsValid(token: string): boolean {
  return token.length >= 32 && token.length <= 512
}
