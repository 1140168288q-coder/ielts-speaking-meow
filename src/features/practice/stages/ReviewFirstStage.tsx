import type { AiFeedback, PracticeAttempt } from '../../../domain'
import { AnswerTextCard } from '../components/AnswerTextCard'
import { AiFeedbackCard } from '../components/feedback/AiFeedbackCard'
import { LocalFeedbackCard } from '../components/feedback/LocalFeedbackCard'

export function ReviewFirstStage({
  firstAttempt,
  aiFeedback,
  aiConfigured,
  aiBusy,
  aiNote,
  aiRetryable = true,
  busy,
  feedbackDetail,
  speakingKey,
  onToggleSpeak,
  onRequestAiFeedback,
  onPrepareSecond,
}: {
  firstAttempt: PracticeAttempt
  aiFeedback: AiFeedback | null
  aiConfigured: boolean
  aiBusy: boolean
  aiNote: string | null
  aiRetryable?: boolean
  busy: boolean
  feedbackDetail: 'focused' | 'expanded'
  speakingKey: string | null
  onToggleSpeak: (key: string, text: string) => void
  onRequestAiFeedback: () => void
  onPrepareSecond: () => void
}) {
  return (
    <div className="practice-stack">
      <AnswerTextCard attempt={firstAttempt} />
      {aiFeedback ? (
        <AiFeedbackCard
          feedback={aiFeedback}
          playingKey={speakingKey}
          onToggle={onToggleSpeak}
          detail={feedbackDetail}
        />
      ) : (
        <LocalFeedbackCard busy={aiBusy} attempt={firstAttempt} />
      )}
      {aiNote ? <div className="inline-note">{aiNote}</div> : null}
      {aiConfigured && !aiFeedback && aiRetryable ? (
        <button
          type="button"
          className="secondary-button"
          disabled={busy || aiBusy}
          onClick={onRequestAiFeedback}
        >
          {aiBusy ? '正在获取 AI 分析…' : '重试 AI 分析'}
        </button>
      ) : null}
      <section className="next-attempt-card">
        <p className="eyebrow">第二次是核心</p>
        <h2>先用本地重点继续练；AI 结果会在后台补充。</h2>
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={onPrepareSecond}
        >
          进入第二次回答
        </button>
      </section>
    </div>
  )
}
