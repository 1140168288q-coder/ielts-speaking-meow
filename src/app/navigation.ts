import type { AudioFocus } from '../ports/speech'

export type AppView =
  | 'home'
  | 'questions'
  | 'practice'
  | 'history'
  | 'expressions'
  | 'materials'
  | 'accounts'
  | 'imports'
  | 'settings'

export const SAFE_PRACTICE_BACK_EVENT = 'ielts-speaking-meow:safe-practice-back'

export function resetViewScroll(): void {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  // Some Android WebViews and embedded browser surfaces keep the root element's
  // scroll offset even after window.scrollTo. Reset both roots so every primary
  // navigation starts from the page heading.
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

export type AndroidBackAction =
  | 'safe-practice-exit'
  | 'home'
  | 'origin'
  | 'browser-back'
  | 'exit-app'

/**
 * `origin` 是进入当前视图前的来源(如从"我的"进入设置)。硬件返回优先回到
 * 来源视图,没有记录时才回首页;练习页永远走安全退出守卫。
 */
export const resolveAndroidBackAction = (
  view: AppView,
  canGoBack: boolean,
  origin?: AppView,
): AndroidBackAction => {
  if (view === 'practice') {
    return 'safe-practice-exit'
  }
  if (view !== 'home') {
    return origin !== undefined && origin !== view ? 'origin' : 'home'
  }
  return canGoBack ? 'browser-back' : 'exit-app'
}

export const resolveInitialView = (search: string): AppView => {
  const params = new URLSearchParams(search)
  const action = params.get('action')
  const token = params.get('token')?.trim() ?? ''
  const isAccountAction = action === 'verify-email' || action === 'reset-password'
  return isAccountAction && token.length >= 32 && token.length <= 512
    ? 'accounts'
    : 'home'
}

/**
 * Shared by visible navigation today and a future native Back adapter. Leaving
 * is deliberately denied while an answer is being persisted so it cannot be
 * abandoned silently.
 */
export const requestSafePracticeExit = async (
  audioFocus: Pick<AudioFocus, 'state' | 'stopAllPlayback'>,
  exitGuardActive: boolean,
  onExit: () => void,
): Promise<boolean> => {
  if (exitGuardActive) {
    return false
  }

  await audioFocus.stopAllPlayback()
  onExit()
  return true
}
