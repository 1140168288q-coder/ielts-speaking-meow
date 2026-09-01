import type { AiFeedback } from '../../../../domain'

export function AnswerFrameworkCard({ feedback }: { feedback: AiFeedback }) {
  if (feedback.answerFramework.length === 0) return null

  return (
    <section className="answer-framework-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">本题要点</p>
          <h2>用几个提示，重新组织一次回答</h2>
        </div>
      </div>
      <ol>
        {feedback.answerFramework.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            <strong>{item.label}</strong>
            <span>{item.template}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
