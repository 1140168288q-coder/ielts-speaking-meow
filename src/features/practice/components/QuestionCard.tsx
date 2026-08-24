import { Play, Square } from 'lucide-react'
import type { Question } from '../../../domain'
import { partLabel } from '../format'

export function QuestionCard({
  question,
  playing,
  compact,
  onToggle,
}: {
  question: Question
  playing: boolean
  compact: boolean
  onToggle: () => void
}) {
  const cueList = 'cuePoints' in question ? (
    <ul className="cue-list">
      {question.cuePoints.map((point) => (
        <li key={point}>{point}</li>
      ))}
    </ul>
  ) : null

  return (
    <article className={compact ? 'prompt-card compact' : 'prompt-card'}>
      <div className="prompt-meta">
        <span>{partLabel(question.part)}</span>
        <span>{question.topic}</span>
      </div>
      <h1>{question.prompt}</h1>
      {compact && cueList ? (
        <details className="compact-cue-list">
          <summary>查看提示点</summary>
          {cueList}
        </details>
      ) : cueList}
      <div className="prompt-actions">
        <button
          type="button"
          className={playing ? 'sound-button playing' : 'sound-button'}
          onClick={onToggle}
        >
          {playing ? <Square aria-hidden="true" size={15} fill="currentColor" /> : <Play aria-hidden="true" size={16} fill="currentColor" />}
          {playing ? '停止播报' : '播放题目'}
        </button>
        <span className="audio-state">
          {playing ? '正在播报' : '可随时试听题目'}
        </span>
      </div>
    </article>
  )
}
