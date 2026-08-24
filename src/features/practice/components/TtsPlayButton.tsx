import { Play, Square } from 'lucide-react'

export function TtsPlayButton({
  label,
  playingLabel,
  playing,
  onClick,
}: {
  label: string
  playingLabel: string
  playing: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={playing ? 'secondary-button playing' : 'secondary-button'}
      onClick={onClick}
    >
      {playing ? <Square aria-hidden="true" size={14} fill="currentColor" /> : <Play aria-hidden="true" size={15} fill="currentColor" />}
      {playing ? playingLabel : label}
    </button>
  )
}
