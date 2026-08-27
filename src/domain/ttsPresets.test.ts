import { describe, expect, it } from 'vitest'
import {
  TTS_VOICE_PRESETS,
  getTtsVoicePreset,
  resolveTtsVoicePlaybackSettings,
} from './ttsPresets'

describe('tts voice presets', () => {
  it('contains exactly two male and three female examiner presets', () => {
    expect(TTS_VOICE_PRESETS).toHaveLength(5)
    expect(TTS_VOICE_PRESETS.filter((preset) => preset.gender === 'male')).toHaveLength(2)
    expect(TTS_VOICE_PRESETS.filter((preset) => preset.gender === 'female')).toHaveLength(3)
    expect(new Set(TTS_VOICE_PRESETS.map((preset) => preset.speaker)).size).toBe(5)
  })

  it('keeps the backend default compatible and applies preset adjustments', () => {
    expect(getTtsVoicePreset('unknown').id).toBe('backend-default')
    const settings = resolveTtsVoicePlaybackSettings('dave', 0.92, 1)
    expect(settings.voice).toBe('en_male_dave_moon_bigtts')
    expect(settings.rate).toBeCloseTo(0.9016)
    expect(settings.pitch).toBe(0.93)
  })
})
