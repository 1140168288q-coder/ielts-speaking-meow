import { describe, expect, it } from 'vitest'
import {
  USER_PREFERENCES_VERSION,
  createDefaultUserPreferences,
  updateUserPreferences,
} from './userPreferences'

describe('userPreferences', () => {
  it('starts with focused feedback and private personal materials', () => {
    const preferences = createDefaultUserPreferences(
      'owner-a',
      new Date('2026-08-24T08:00:00.000Z'),
    )

    expect(preferences).toMatchObject({
      version: USER_PREFERENCES_VERSION,
      ownerId: 'owner-a',
      feedbackDetail: 'focused',
      memoryEnabled: true,
      sharePersonalMaterialsWithAi: false,
      ttsVoiceMode: 'natural-first',
      ttsRate: 0.92,
    })
  })

  it('updates supported controls without changing identity', () => {
    const current = createDefaultUserPreferences('owner-a')
    const next = updateUserPreferences(
      current,
      { theme: 'dark', ttsRate: 1.1, defaultPart: 3 },
      new Date('2026-08-24T09:00:00.000Z'),
    )

    expect(next.ownerId).toBe('owner-a')
    expect(next.version).toBe(USER_PREFERENCES_VERSION)
    expect(next.theme).toBe('dark')
    expect(next.ttsRate).toBe(1.1)
    expect(next.defaultPart).toBe(3)
    expect(next.updatedAt).toBe('2026-08-24T09:00:00.000Z')
  })

  it('rejects unsupported playback rates', () => {
    const current = createDefaultUserPreferences('owner-a')
    expect(() => updateUserPreferences(current, { ttsRate: 1.5 })).toThrow()
  })
})
