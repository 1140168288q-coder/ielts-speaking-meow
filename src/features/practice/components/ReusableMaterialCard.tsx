import { Play, Square } from 'lucide-react'
import type { ReusableExpression } from '../../../domain'

export function ReusableMaterialCard({
  items,
  playingKey,
  onToggle,
  onUse,
}: {
  items: ReusableExpression[]
  playingKey: string | null
  onToggle: (key: string, text: string) => void
  onUse: (item: ReusableExpression) => void
}) {
  return (
    <section className="reusable-material-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">你的个人语料</p>
          <h2>挑一句你说过的话，放进这次回答</h2>
        </div>
      </div>
      <div className="reusable-material-list">
        {items.map((item) => {
          const key = `reuse:${item.expression.id}:${item.expression.text}`
          return (
            <article key={item.expression.id}>
              <div className="reusable-material-meta">
                <span>{item.expression.topic}</span>
                <small>{item.reason}</small>
              </div>
              <p>{item.expression.text}</p>
              <div className="reusable-material-actions">
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => onToggle(key, item.expression.text)}
                >
                  {playingKey === key ? <><Square aria-hidden="true" size={13} fill="currentColor" /> 停止</> : <><Play aria-hidden="true" size={14} fill="currentColor" /> 试听</>}
                </button>
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => onUse(item)}
                >
                  + 插入答案
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
