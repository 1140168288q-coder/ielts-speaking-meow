import type { PracticeAttempt } from '../../../domain'
import { formatDuration } from '../format'

export function AnswerTextCard({
  attempt,
  eyebrow = '已保存的第一次回答',
  heading = '这次说了什么',
}: {
  attempt: PracticeAttempt
  eyebrow?: string
  heading?: string
}) {
  const durationMs = attempt.metrics.durationMs
  return (
    <section className="answer-text-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{heading}</h2>
        </div>
        {durationMs > 0 ? (
          <span className="answer-duration">作答用时 {formatDuration(durationMs)}</span>
        ) : null}
      </div>
      <p className="answer-quote">{attempt.transcript.text}</p>
    </section>
  )
}
