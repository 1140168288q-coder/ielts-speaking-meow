import type { RetrievedKnowledgeDoc } from '../../../domain'

export function TutorKnowledgeCard({
  docs,
}: {
  docs: RetrievedKnowledgeDoc[]
}) {
  if (docs.length === 0) return null
  return (
    <details className="tutor-knowledge-card">
      <summary>
        本题备考要点（{docs.length} 条）· 离线可用
      </summary>
      <div className="tutor-knowledge-list">
        {docs.map((item) => (
          <article key={item.doc.id}>
            <strong>{item.doc.title}</strong>
            <p>{item.doc.body}</p>
          </article>
        ))}
      </div>
    </details>
  )
}
