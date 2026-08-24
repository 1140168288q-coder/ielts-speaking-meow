import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  IDLE_PLAYBACK_SNAPSHOT,
  type AudioFocus,
  type PlaybackSnapshot,
} from '../../ports/speech'

/**
 * 单页面共享的 TTS 开关状态:
 * - 同一个 key 第一次点击播放,第二次点击立即停止;
 * - 点另一个 key 时 AudioCoordinator 会先停旧播放再播新的;
 * - 云端音频可通过 capability-aware snapshot 暂停、继续和拖动;
 * - 任何播放结束/停止后回到 idle,自动清空状态。
 */
export function useTtsToggle(audioFocus: AudioFocus) {
  const [speakingKey, setSpeakingKey] = useState<string | null>(null)
  const [playback, setPlayback] = useState<PlaybackSnapshot>(
    audioFocus.ttsPlayback ?? IDLE_PLAYBACK_SNAPSHOT,
  )
  const speakingKeyRef = useRef<string | null>(null)

  const clearIfCurrent = useCallback((key: string | null) => {
    if (speakingKeyRef.current === key) {
      speakingKeyRef.current = null
      setSpeakingKey(null)
    }
  }, [])

  useEffect(() => {
    const unsubscribeFocus = audioFocus.subscribe((state) => {
      if (state === 'idle') {
        setPlayback(IDLE_PLAYBACK_SNAPSHOT)
        clearIfCurrent(speakingKeyRef.current)
      }
    })
    const unsubscribePlayback = audioFocus.subscribeTTSPlayback?.((snapshot) => {
      setPlayback(snapshot)
    })
    return () => {
      unsubscribeFocus()
      unsubscribePlayback?.()
    }
  }, [audioFocus, clearIfCurrent])

  const stop = useCallback(async (): Promise<void> => {
    speakingKeyRef.current = null
    setSpeakingKey(null)
    await audioFocus.stopTTS()
  }, [audioFocus])

  const toggle = useCallback(
    async (key: string, text: string): Promise<void> => {
      if (speakingKeyRef.current === key) {
        await stop()
        return
      }

      speakingKeyRef.current = key
      setSpeakingKey(key)
      try {
        await audioFocus.speak({
          text,
          language: 'en-US',
          rate: 0.92,
          pitch: 1,
        })
      } catch (error) {
        if (speakingKeyRef.current === key) {
          speakingKeyRef.current = null
          setSpeakingKey(null)
        }
        throw error
      } finally {
        if (speakingKeyRef.current === key) {
          speakingKeyRef.current = null
          setSpeakingKey(null)
        }
      }
    },
    [audioFocus, stop],
  )

  const pause = useCallback(
    () => audioFocus.pauseTTS?.() ?? Promise.resolve(false),
    [audioFocus],
  )
  const resume = useCallback(
    () => audioFocus.resumeTTS?.() ?? Promise.resolve(false),
    [audioFocus],
  )
  const seek = useCallback(
    (positionSeconds: number) =>
      audioFocus.seekTTS?.(positionSeconds) ?? Promise.resolve(false),
    [audioFocus],
  )

  return {
    speakingKey,
    playback,
    toggle,
    pause,
    resume,
    seek,
    stop,
  }
}
