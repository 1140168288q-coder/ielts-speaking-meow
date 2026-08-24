import type { AiFeedback, ReferenceAnswer } from '../../../../domain'
import { TtsPlayButton } from '../TtsPlayButton'

export function TtsSection({
  title,
  text,
  playingKey,
  onToggle,
}: {
  title: string
  text: string
  playingKey: string | null
  onToggle: (key: string, text: string) => void
}) {
  const key = `tts:${title}:${text}`
  return (
    <section className="tts-section">
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <TtsPlayButton
        label="试听"
        playingLabel="停止"
        playing={playingKey === key}
        onClick={() => onToggle(key, text)}
      />
    </section>
  )
}

export function ReferenceAnswerCard({
  reference,
  playingKey,
  onToggle,
}: {
  reference: ReferenceAnswer
  playingKey: string | null
  onToggle: (key: string, text: string) => void
}) {
  const key = `tts:reference:${reference.label}:${reference.text}`
  return (
    <article className="reference-answer-card">
      <div className="version-head">
        <strong>{reference.label}</strong>
      </div>
      <p>{reference.text}</p>
      <TtsPlayButton
        label={`试听 ${reference.label}`}
        playingLabel="停止"
        playing={playingKey === key}
        onClick={() => onToggle(key, reference.text)}
      />
    </article>
  )
}

export function ReferenceRecap({
  feedback,
  playingKey,
  onToggle,
}: {
  feedback: AiFeedback
  playingKey: string | null
  onToggle: (key: string, text: string) => void
}) {
  return (
    <section className="reference-recap-card">
      <p className="eyebrow">上一轮参考</p>
      <h2>回答前可随时试听优化版和 3 个参考回答</h2>
      <div className="reference-recap-actions">
        <TtsPlayButton
          label="优化答案"
          playingLabel="停止"
          playing={playingKey === `tts:recap:improved:${feedback.improvedAnswer}`}
          onClick={() => onToggle(`tts:recap:improved:${feedback.improvedAnswer}`, feedback.improvedAnswer)}
        />
        {feedback.referenceAnswers.map((reference, index) => {
          const key = `tts:recap:reference:${index}:${reference.text}`
          return (
            <TtsPlayButton
              key={key}
              label={reference.label}
              playingLabel="停止"
              playing={playingKey === key}
              onClick={() => onToggle(key, reference.text)}
            />
          )
        })}
      </div>
    </section>
  )
}
