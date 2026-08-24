import type { PracticeAttempt } from '../../../../domain'
import { createLocalSummary } from '../../../../domain'

export function LocalFeedbackCard({
  attempt,
  busy,
}: {
  attempt: PracticeAttempt
  busy: boolean
}) {
  const summary = createLocalSummary(attempt.metrics)
  return (
    <section className="summary-feedback-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{busy ? '正在分析' : '本地规则提示'}</p>
          <h2>先看最值得改的一点</h2>
        </div>
      </div>
      {busy ? (
        <div className="inline-note" role="status">
          正在获取 AI 文本分析…
        </div>
      ) : (
        <>
          <div className="summary-line problem">
            <small>问题</small>
            <p>{summary.problem}</p>
          </div>
          <div className="summary-line suggestion">
            <small>建议</small>
            <p>{summary.suggestion}</p>
          </div>
        </>
      )}
    </section>
  )
}
