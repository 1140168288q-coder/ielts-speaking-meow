import {
  requestSafePracticeExit,
  resetViewScroll,
  resolveAndroidBackAction,
  resolveInitialView,
} from './app/navigation'
import type { AudioFocusState } from './ports/speech'

function focus(state: AudioFocusState) {
  const stopAllPlayback = vi.fn(() => Promise.resolve())
  return {
    audioFocus: { state, stopAllPlayback },
    stopAllPlayback,
  }
}

describe('requestSafePracticeExit', () => {
  it('also blocks while local persistence is pending', async () => {
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

  it.each(['questions', 'history', 'expressions', 'accounts', 'settings'] as const)(
    'returns from %s to the home screen before exiting',
    (view) => {
      expect(resolveAndroidBackAction(view, false)).toBe('home')
    },
  )

  it('uses WebView history from the root when one exists', () => {
    expect(resolveAndroidBackAction('home', true)).toBe('browser-back')
  })

  it('exits only from the root when WebView has no history', () => {
    expect(resolveAndroidBackAction('home', false)).toBe('exit-app')
  })
})

describe('resetViewScroll', () => {
  it('returns every top-level view to the top-left edge', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    document.documentElement.scrollTop = 180
    document.body.scrollTop = 180

    resetViewScroll()

    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: 'auto',
    })
    expect(document.documentElement.scrollTop).toBe(0)
    expect(document.body.scrollTop).toBe(0)
    scrollTo.mockRestore()
  })
})

describe('resolveInitialView', () => {
  it.each(['verify-email', 'reset-password']) (
    'opens the account screen for a valid %s email link',
    (action) => {
      expect(resolveInitialView(`?action=${action}&token=${'t'.repeat(43)}`)).toBe(
        'accounts',
      )
    },
  )

  it('keeps malformed or unrelated links on the home screen', () => {
    expect(resolveInitialView('?action=reset-password&token=short')).toBe('home')
    expect(resolveInitialView('?topic=hometown')).toBe('home')
  })
})
