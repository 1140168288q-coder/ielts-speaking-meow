import type { TrainingSession } from '../../domain'

export function practiceDraftKey(session: TrainingSession, attemptNumber: 1 | 2): string {
  return `ielts-speaking-meow:draft:${session.ownerId ?? 'local'}:${session.id}:${attemptNumber}`
}

export function clearPracticeDraft(session: TrainingSession, attemptNumber: 1 | 2): void {
  try {
    window.localStorage.removeItem(practiceDraftKey(session, attemptNumber))
  } catch {
    // Draft persistence is best-effort; the durable answer is already saved.
  }
}

export function readPracticeDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export function suggestReusableSnippet(text: string): string {
  const clean = text.trim()
  const firstSentence = clean.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? clean
  return firstSentence.slice(0, 320)
}

export function formatTimer(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
