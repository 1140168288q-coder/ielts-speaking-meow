import { useEffect, useState } from 'react'
import { useManualTimer } from '../hooks/useManualTimer'
import { formatTimer, readPracticeDraft } from '../practiceDraft'

export function AnswerEntryStage({
  eyebrow,
  heading,
  buttonLabel,
  busy,
  insertSeed = null,
  draftKey,
  onSubmit,
}: {
  eyebrow: string
  heading: string
  buttonLabel: string
  busy: boolean
  insertSeed?: { nonce: number; text: string } | null
  draftKey: string
  onSubmit: (text: string, answerDurationMs: number | null) => void
}) {
  const [draft, setDraft] = useState(() => readPracticeDraft(draftKey))
  const { elapsedMs, status, start, pause, resume, reset } = useManualTimer()

  useEffect(() => {
    try {
      if (draft.trim().length === 0) {
        window.localStorage.removeItem(draftKey)
      } else {
        window.localStorage.setItem(draftKey, draft)
      }
    } catch {
      // The answer remains in component state if local draft storage is unavailable.
    }
  }, [draft, draftKey])

  // 用户点击“插入素材”时,把历史表达追加到当前答案框。
  useEffect(() => {
    if (insertSeed === null) return
    const text = insertSeed.text.trim()
    if (text.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 把外部点击事件转成受控 textarea 的一次性追加
    setDraft((current) => {
      const cleanCurrent = current.trim()
      return cleanCurrent.length === 0
        ? text
        : `${cleanCurrent} ${text}`
    })
  }, [insertSeed])

  const submit = () => {
    const text = draft.trim()
    if (text.length === 0 || busy) return
    onSubmit(text, elapsedMs > 0 ? elapsedMs : null)
  }

  return (
    <section className="answer-entry-card">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{heading}</h2>
      <label className="answer-field">
        <span>你的答案文本</span>
        <textarea
          value={draft}
          rows={7}
          maxLength={10_000}
          placeholder="在这里输入你的英文回答。也可以用手机键盘上的麦克风语音输入，再手动改掉识别错误。"
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <p className="keyboard-hint">
        手机系统键盘自带语音输入，可以直接说英文；本应用不会录音或转写。
      </p>
      <div className="manual-timer">
        <div className="manual-timer-head">
          <span>参考计时</span>
          <strong>{formatTimer(elapsedMs)}</strong>
        </div>
        <p>计时仅供参考，不会强制结束或自动提交。</p>
        <div className="manual-timer-actions">
          {status === 'running' ? (
            <button type="button" className="secondary-button compact" onClick={pause}>
              暂停
            </button>
          ) : null}
          {status === 'paused' ? (
            <button type="button" className="secondary-button compact" onClick={resume}>
              继续
            </button>
          ) : null}
          {status === 'idle' ? (
            <button type="button" className="secondary-button compact" onClick={start}>
              开始计时
            </button>
          ) : null}
          <button type="button" className="secondary-button compact" onClick={reset}>
            重置
          </button>
        </div>
      </div>
      <button
        type="button"
        className="primary-button"
        disabled={busy || draft.trim().length === 0}
        onClick={submit}
      >
        {busy ? '正在保存…' : buttonLabel}
      </button>
    </section>
  )
}
