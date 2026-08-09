import {
  formatMicrophoneStartError,
  requestSafePracticeExit,
  resetViewScroll,
  resolveAndroidBackAction,
} from './App'
import type { AudioFocusState } from './ports/speech'

function focus(state: AudioFocusState) {
  const stopAllPlayback = vi.fn(() => Promise.resolve())
  return {
    audioFocus: { state, stopAllPlayback },
    stopAllPlayback,
  }
}

describe('requestSafePracticeExit', () => {
  it('blocks visible navigation while the microphone is recording', async () => {
    const { audioFocus, stopAllPlayback } = focus('recording')
    const onExit = vi.fn()

    await expect(
      requestSafePracticeExit(audioFocus, false, onExit),
    ).resolves.toBe(false)
    expect(stopAllPlayback).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
  })

  it('also blocks while microphone permission or local persistence is pending', async () => {
    const { audioFocus, stopAllPlayback } = focus('idle')
    const onExit = vi.fn()

    await expect(
      requestSafePracticeExit(audioFocus, true, onExit),
    ).resolves.toBe(false)
    expect(stopAllPlayback).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
  })

  it('stops playback before a safe navigation callback runs', async () => {
    const order: string[] = []
    const audioFocus = {
      state: 'tts' as const,
      stopAllPlayback: vi.fn(() => {
        order.push('stop')
        return Promise.resolve()
      }),
    }

    await expect(
      requestSafePracticeExit(audioFocus, false, () => order.push('exit')),
    ).resolves.toBe(true)
    expect(order).toEqual(['stop', 'exit'])
  })

  it('does not navigate when active playback cannot be stopped safely', async () => {
    const onExit = vi.fn()
    const audioFocus = {
      state: 'tts' as const,
      stopAllPlayback: vi.fn(() => Promise.reject(new Error('stop failed'))),
    }

    await expect(
      requestSafePracticeExit(audioFocus, false, onExit),
    ).rejects.toThrow('stop failed')
    expect(onExit).not.toHaveBeenCalled()
  })
})

describe('resolveAndroidBackAction', () => {
  it('always reuses the safe practice guard while a practice is open', () => {
    expect(resolveAndroidBackAction('practice', false)).toBe(
      'safe-practice-exit',
    )
    expect(resolveAndroidBackAction('practice', true)).toBe(
      'safe-practice-exit',
    )
  })

  it.each(['history', 'expressions'] as const)(
    'returns from %s to the question library before exiting',
    (view) => {
      expect(resolveAndroidBackAction(view, false)).toBe('questions')
    },
  )

  it('uses WebView history from the root when one exists', () => {
    expect(resolveAndroidBackAction('questions', true)).toBe('browser-back')
  })

  it('exits only from the root when WebView has no history', () => {
    expect(resolveAndroidBackAction('questions', false)).toBe('exit-app')
  })
})

describe('resetViewScroll', () => {
  it('returns every top-level view to the top-left edge', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    resetViewScroll()

    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: 'auto',
    })
    scrollTo.mockRestore()
  })
})

describe('formatMicrophoneStartError', () => {
  it('gives an actionable Android settings path for NotAllowedError', () => {
    const error = new DOMException('The request is not allowed', 'NotAllowedError')

    expect(formatMicrophoneStartError(error)).toContain(
      '系统设置 → 应用 → 雅思口语喵 → 权限 → 麦克风',
    )
  })

  it('recognizes a provider Permission denied message case-insensitively', () => {
    expect(formatMicrophoneStartError(new Error('PERMISSION DENIED'))).toContain(
      '系统设置 → 应用 → 雅思口语喵 → 权限 → 麦克风',
    )
  })

  it('preserves the existing semantics for unrelated recorder errors', () => {
    const error = new Error('Microphone is already in use')
    error.name = 'NotReadableError'

    expect(formatMicrophoneStartError(error)).toBe(
      '无法开始录音：Microphone is already in use',
    )
  })

  it('preserves the generic fallback for non-Error failures', () => {
    expect(formatMicrophoneStartError('unknown failure')).toBe(
      '无法开始录音，请检查麦克风权限。',
    )
  })
})
