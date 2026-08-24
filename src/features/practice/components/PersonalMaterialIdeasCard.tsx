import { Lightbulb } from 'lucide-react'
import type { ReusablePersonalMaterial } from '../../../domain'

export function PersonalMaterialIdeasCard({
  items,
  onUse,
}: {
  items: ReusablePersonalMaterial[]
  onUse: (item: ReusablePersonalMaterial) => void
}) {
  return (
    <section className="personal-material-ideas-card">
      <div className="section-heading compact-heading">
        <span className="memory-icon"><Lightbulb aria-hidden="true" size={20} /></span>
        <div>
          <p className="eyebrow">你的个人素材 · 说什么</p>
          <h2>这些真实经历可能适合本题</h2>
        </div>
      </div>
      <div className="personal-material-ideas-list">
        {items.map((item) => (
          <article key={item.material.id}>
            <div><strong>{item.material.title}</strong><small>{item.reason}</small></div>
            <p>{item.material.content}</p>
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => onUse(item)}
            >
              用作思路
            </button>
          </article>
        ))}
      </div>
      <small className="privacy-caption">仅在本机展示，不会自动发送给 AI；需要个性化生成时应再次由你确认。</small>
    </section>
  )
}
