import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { PracticeAttempt } from '../../../domain'
import { formatDuration } from '../format'
import { suggestReusableSnippet } from '../practiceDraft'

export function SubmitCorpusStage({
  attempt,
  busy,
  onSubmit,
  onComplete,
}: {
  attempt: PracticeAttempt
  busy: boolean
  onSubmit: (text: string) => void
  onComplete: () => void
}) {
  const [draft, setDraft] = useState(() => suggestReusableSnippet(attempt.transcript.text))
  const lastIncomingTranscript = useRef({
    attemptId: attempt.id,
    text: attempt.transcript.text,
  })

  useEffect(() => {
    const previous = lastIncomingTranscript.current
    const incomingText = attempt.transcript.text
    lastIncomingTranscript.current = {
      attemptId: attempt.id,
      text: incomingText,
    }
    setDraft((current) =>
      previous.attemptId !== attempt.id || current === previous.text
        ? suggestReusableSnippet(incomingText)
        : current,
    )
  }, [attempt.id, attempt.transcript.text, attempt.transcript.updatedAt])

  return (
    <section className="submit-corpus-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">完成与沉淀</p>
          <h2>这次练习已经完成，要留下一句以后再用吗？</h2>
        </div>
        {attempt.metrics.durationMs > 0 ? (
          <span className="answer-duration">
            作答用时 {formatDuration(attempt.metrics.durationMs)}
          </span>
        ) : null}
      </div>
      <label className="transcript-field">
        <span>
          候选表达
          <small>系统先挑出一句；请确认或改短。完整回答不会进入个人语料库。</small>
        </span>
        <textarea
          value={draft}
          placeholder="例如：It helps me unwind after a long day."
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          maxLength={320}
        />
      </label>
      <div className="corpus-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy || draft.trim().length === 0}
          onClick={() => onSubmit(draft)}
        >
          <Sparkles aria-hidden="true" size={17} />
          {busy ? '正在保存…' : '收进个人语料并完成'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onComplete}
        >
          仅完成练习
        </button>
      </div>
    </section>
  )
}
