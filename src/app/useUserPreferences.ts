import { useCallback, useEffect, useState } from 'react'
import {
  createDefaultUserPreferences,
  updateUserPreferences,
  type UserPreferences,
  type UserPreferencesUpdate,
} from '../domain/userPreferences'
import { LOCAL_DEFAULT_USER_ID } from '../domain/accounts'
import type { BrowserRuntime } from './runtime'

export type ThemePreference = 'system' | 'light' | 'dark'
const THEME_STORAGE_KEY = 'ielts-speaking-meow:theme'

function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Private browsing or an embedded WebView may deny localStorage access.
  }
  return 'system'
}

export function useUserPreferences({ runtime }: { runtime: BrowserRuntime }) {
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference)
  const [preferences, setPreferences] = useState<UserPreferences>(() =>
    createDefaultUserPreferences(LOCAL_DEFAULT_USER_ID),
  )
  const [libraryPart, setLibraryPart] = useState<1 | 2 | 3>(1)

  const loadUserPreferences = useCallback(async (ownerId: string) => {
    const stored = await runtime.storage.getUserPreferences(ownerId)
    const next = stored ?? createDefaultUserPreferences(ownerId)
    if (stored === null) await runtime.storage.saveUserPreferences(next)
    runtime.setUserPreferences(next)
    setPreferences(next)
    setTheme(next.theme)
    setLibraryPart(next.defaultPart)
  }, [runtime])

  const changeUserPreferences = useCallback(async (
    update: UserPreferencesUpdate,
  ) => {
    const next = updateUserPreferences(preferences, update)
    await runtime.storage.saveUserPreferences(next)
    runtime.setUserPreferences(next)
    setPreferences(next)
    setTheme(next.theme)
    if (update.defaultPart !== undefined) setLibraryPart(next.defaultPart)
  }, [preferences, runtime])

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = preferences.reduceMotion
      ? 'true'
      : 'false'
  }, [preferences.reduceMotion])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const resolved = theme === 'system'
        ? (media?.matches ? 'dark' : 'light')
        : theme
      document.documentElement.dataset.theme = resolved
      document.documentElement.style.colorScheme = resolved
    }
    applyTheme()
    if (theme !== 'system' || !media) return
    media.addEventListener?.('change', applyTheme)
    return () => media.removeEventListener?.('change', applyTheme)
  }, [theme])

  return {
    theme,
    preferences,
    libraryPart,
    setLibraryPart,
    loadUserPreferences,
    changeUserPreferences,
  }
}
