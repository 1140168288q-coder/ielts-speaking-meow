import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { AudioFocus } from '../../ports/speech'

/**
 * 单页面共享的 TTS 开关状态:
 * - 同一个 key 第一次点击播放,第二次点击立即停止;
 * - 点另一个 key 时 AudioCoordinator 会先停旧播放再播新的,本 hook
 *   只负责跟踪“当前在播哪个 key”;
 * - 任何播放结束/停止后回到 idle,自动清空状态。
 */
export function useTtsToggle(audioFocus: AudioFocus) {
  const [speakingKey, setSpeakingKey] = useState<string | null>(null)
  const speakingKeyRef = useRef<string | null>(null)

  const clearIfCurrent = useCallback((key: string | null) => {
    if (speakingKeyRef.current === key) {
      speakingKeyRef.current = null
      setSpeakingKey(null)
    }
  }, [])

  useEffect(() => {
    return audioFocus.subscribe((state) => {
      if (state === 'idle') {
        clearIfCurrent(speakingKeyRef.current)
      }
    })
  }, [audioFocus, clearIfCurrent])

  const toggle = useCallback(
    async (key: string, text: string): Promise<void> => {
      if (speakingKeyRef.current === key) {
        speakingKeyRef.current = null
        setSpeakingKey(null)
        await audioFocus.stopTTS()
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
    [audioFocus],
  )

  return { speakingKey, toggle }
}
