import type { TrainingPlan } from '../../../domain'

const sourceLabels: Record<TrainingPlan['sources'][number]['kind'], string> = {
  teaching: '教学要点',
  feedback: '本次反馈',
  'personal-material': '个人素材',
  expression: '个人表达',
  fallback: '离线规则',
}

export function TrainingPlanCard({ plan }: { plan: TrainingPlan }) {
  return (
    <section className="training-plan-card" aria-label="本题训练小计划">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">本题训练小计划</p>
          <h2>{plan.outcome.status === 'completed' ? '这次练习留下了什么' : '把刚才的重点用到二答'}</h2>
        </div>
        <span className="plan-status">{plan.outcome.status === 'completed' ? '已完成' : '进行中'}</span>
      </div>
      <p className="training-plan-goal"><strong>目标</strong>{plan.goal}</p>
      <ol className="training-plan-actions">
        {plan.actions.map((action, index) => <li key={`${action}-${index}`}>{action}</li>)}
      </ol>
      <details className="training-plan-sources">
        <summary>为什么这样安排（{plan.sources.length} 个依据）</summary>
        <ul>
          {plan.sources.map((source) => (
            <li key={`${source.kind}-${source.label}`}>
              <strong>{sourceLabels[source.kind]} · {source.label}</strong>
              <span>{source.detail}</span>
            </li>
          ))}
        </ul>
      </details>
      {plan.outcome.evidence.length > 0 ? (
        <p className="training-plan-outcome">{plan.outcome.evidence.join(' ')}</p>
      ) : null}
    </section>
  )
}
