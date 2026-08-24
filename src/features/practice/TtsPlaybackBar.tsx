import { Pause, Play, Square } from 'lucide-react'
import type { PlaybackSnapshot } from '../../ports/speech'

export function TtsPlaybackBar({
  playback,
  onPause,
  onResume,
  onSeek,
  onStop,
}: {
  playback: PlaybackSnapshot
  onPause: () => void
  onResume: () => void
  onSeek: (positionSeconds: number) => void
  onStop: () => void
}) {
  const effectiveStatus =
    playback.status === 'idle' ? 'loading' : playback.status
  const duration = playback.durationSeconds
  const position = Math.max(
    0,
    Math.min(playback.positionSeconds, duration ?? playback.positionSeconds),
  )
  const statusText =
    effectiveStatus === 'loading'
      ? '正在准备语音'
      : effectiveStatus === 'paused'
        ? '已暂停'
        : '正在播放'
  const canResume = effectiveStatus === 'paused' && playback.canPause
  const canPause = effectiveStatus === 'playing' && playback.canPause

  return (
    <section className="tts-player-card" aria-label="语音播放器">
      <div className="tts-player-heading">
        <div>
          <span className={`playback-dot ${effectiveStatus}`} aria-hidden="true" />
          <strong>{statusText}</strong>
        </div>
        <span className="tts-time">
          {formatPlaybackTime(position)} / {formatPlaybackTime(duration)}
        </span>
      </div>

      <input
        className="tts-progress"
        type="range"
        min={0}
        max={duration ?? 1}
        step={0.1}
        value={duration === null ? 0 : position}
        disabled={!playback.canSeek || duration === null}
        aria-label="语音播放进度"
        aria-valuetext={
          duration === null
            ? '当前播放方式不提供精确进度'
            : `${formatPlaybackTime(position)} / ${formatPlaybackTime(duration)}`
        }
        onChange={(event) => onSeek(Number(event.currentTarget.value))}
      />

      <div className="tts-player-actions">
        <button
          type="button"
          className="secondary-button compact"
          disabled={!canPause && !canResume}
          onClick={canResume ? onResume : onPause}
          aria-label={canResume ? '继续语音' : '暂停语音'}
        >
          {canResume ? (
            <Play aria-hidden="true" size={14} fill="currentColor" />
          ) : (
            <Pause aria-hidden="true" size={14} fill="currentColor" />
          )}
          {canResume ? '继续' : '暂停'}
        </button>
        <button
          type="button"
          className="secondary-button compact"
          onClick={onStop}
          aria-label="停止语音"
        >
          <Square aria-hidden="true" size={13} fill="currentColor" />
          停止
        </button>
        {duration === null && effectiveStatus !== 'loading' ? (
          <small>系统朗读不提供精确进度或拖动，仍可立即停止。</small>
        ) : null}
      </div>
    </section>
  )
}

function formatPlaybackTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '--:--'
  }
  const totalSeconds = Math.max(0, Math.floor(value))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
