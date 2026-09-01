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
      autoMatchPersonalMaterialsWithAi: true,
      ttsVoicePreset: 'backend-default',
      ttsVoiceMode: 'natural-first',
      ttsRate: 0.92,
      ttsPitch: 1,
    })
  })

  it('updates supported controls without changing identity', () => {
    const current = createDefaultUserPreferences('owner-a')
    const next = updateUserPreferences(
      current,
      { theme: 'dark', ttsVoicePreset: 'dave', ttsRate: 1.1, ttsPitch: 0.95, defaultPart: 3 },
      new Date('2026-08-24T09:00:00.000Z'),
    )

    expect(next.ownerId).toBe('owner-a')
    expect(next.version).toBe(USER_PREFERENCES_VERSION)
    expect(next.theme).toBe('dark')
    expect(next.ttsRate).toBe(1.1)
    expect(next.ttsVoicePreset).toBe('dave')
    expect(next.ttsPitch).toBe(0.95)
    expect(next.defaultPart).toBe(3)
    expect(next.updatedAt).toBe('2026-08-24T09:00:00.000Z')
  })

  it('rejects unsupported playback rates', () => {
    const current = createDefaultUserPreferences('owner-a')
    expect(() => updateUserPreferences(current, { ttsRate: 1.5 })).toThrow()
  })

  it('rejects unsupported playback pitches', () => {
    const current = createDefaultUserPreferences('owner-a')
    expect(() => updateUserPreferences(current, { ttsPitch: 1.5 })).toThrow()
  })

  it('defaults home greeting overrides to null', () => {
    const preferences = createDefaultUserPreferences('owner-a')
    expect(preferences.homeTitleOverride).toBeNull()
    expect(preferences.homeSubtitleOverride).toBeNull()
  })

  it('saves and clears custom home greeting text', () => {
    const current = createDefaultUserPreferences('owner-a')
    const customized = updateUserPreferences(current, {
      homeTitleOverride: '小明，开嗓了。',
      homeSubtitleOverride: '今天从 Part 2 开始。',
    })
    expect(customized.homeTitleOverride).toBe('小明，开嗓了。')
    expect(customized.homeSubtitleOverride).toBe('今天从 Part 2 开始。')

    const restored = updateUserPreferences(customized, {
      homeTitleOverride: null,
      homeSubtitleOverride: null,
    })
    expect(restored.homeTitleOverride).toBeNull()
    expect(restored.homeSubtitleOverride).toBeNull()
  })

  it('rejects oversized greeting overrides', () => {
    const current = createDefaultUserPreferences('owner-a')
    expect(() =>
      updateUserPreferences(current, { homeTitleOverride: 'a'.repeat(41) }),
    ).toThrow()
    expect(() =>
      updateUserPreferences(current, { homeSubtitleOverride: 'b'.repeat(81) }),
    ).toThrow()
  })
})
