/**
 * IELTS examiner-style cloud voice presets.
 *
 * The provider speaker IDs are kept in this small, explicit allow-list so the
 * settings UI can offer stable choices without accepting arbitrary vendor
 * values from local storage or the Backend API.
 */
export const DEFAULT_TTS_VOICE_PRESET_ID = 'backend-default' as const

export const TTS_VOICE_PRESET_IDS = [
  DEFAULT_TTS_VOICE_PRESET_ID,
  'dave',
  'corey',
  'daisy',
  'onez',
  'emily',
] as const

export type TtsVoicePresetId = typeof TTS_VOICE_PRESET_IDS[number]

export interface TtsVoicePreset {
  id: TtsVoicePresetId
  label: string
  gender: 'male' | 'female'
  accent: '英式英语'
  description: string
  speaker?: string
  resourceId?: string
  rateFactor: number
  pitchFactor: number
}

export const TTS_VOICE_PRESETS = [
  {
    id: 'dave',
    label: 'Dave · 沉稳男声',
    gender: 'male',
    accent: '英式英语',
    description: '沉稳、磁性，适合 Part 2 / Part 3 长回答。',
    speaker: 'en_male_dave_moon_bigtts',
    resourceId: 'seed-tts-1.0',
    rateFactor: 0.98,
    pitchFactor: 0.93,
  },
  {
    id: 'corey',
    label: 'Corey · 清朗男声',
    gender: 'male',
    accent: '英式英语',
    description: '清朗自然，适合模拟追问和深入讨论。',
    speaker: 'en_male_corey_emo_v2_mars_bigtts',
    resourceId: 'seed-tts-1.0',
    rateFactor: 1.01,
    pitchFactor: 0.96,
  },
  {
    id: 'daisy',
    label: 'Daisy · 清晰女声',
    gender: 'female',
    accent: '英式英语',
    description: '清晰柔和，适合题目播报和自然示范。',
    speaker: 'en_female_daisy_moon_bigtts',
    resourceId: 'seed-tts-1.0',
    rateFactor: 0.98,
    pitchFactor: 1.04,
  },
  {
    id: 'onez',
    label: 'Onez · 亲切女声',
    gender: 'female',
    accent: '英式英语',
    description: '亲切、自然，适合轻松的 Part 1 练习。',
    speaker: 'en_female_onez_moon_bigtts',
    resourceId: 'seed-tts-1.0',
    rateFactor: 1.02,
    pitchFactor: 1.06,
  },
  {
    id: 'emily',
    label: 'Emily · 自然女声',
    gender: 'female',
    accent: '英式英语',
    description: '自然克制，接近标准化口语考官的交流感。',
    speaker: 'en_female_emily_mars_bigtts',
    resourceId: 'seed-tts-1.0',
    rateFactor: 0.96,
    pitchFactor: 1.02,
  },
] as const satisfies readonly TtsVoicePreset[]

const DEFAULT_TTS_VOICE_PRESET: TtsVoicePreset = {
  id: DEFAULT_TTS_VOICE_PRESET_ID,
  label: '云端默认',
  gender: 'female',
  accent: '英式英语',
  description: '沿用云端默认音色，不改变旧版本的默认行为。',
  rateFactor: 1,
  pitchFactor: 1,
}

export function getTtsVoicePreset(value: string | null | undefined): TtsVoicePreset {
  return TTS_VOICE_PRESETS.find((preset) => preset.id === value)
    ?? DEFAULT_TTS_VOICE_PRESET
}

export interface TtsVoicePlaybackSettings {
  rate: number
  pitch: number
  voice?: string
}

function clampRatio(value: number): number {
  return Math.min(2, Math.max(0.5, value))
}

/** Apply a preset's character while retaining the user's global controls. */
export function resolveTtsVoicePlaybackSettings(
  presetId: string | null | undefined,
  rate: number,
  pitch: number,
): TtsVoicePlaybackSettings {
  const preset = getTtsVoicePreset(presetId)
  return {
    rate: clampRatio(rate * preset.rateFactor),
    pitch: clampRatio(pitch * preset.pitchFactor),
    ...(preset.speaker ? { voice: preset.speaker } : {}),
  }
}
