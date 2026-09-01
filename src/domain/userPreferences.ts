import { z } from 'zod'
import { isoDateTimeSchema } from './models'
import { TTS_VOICE_PRESET_IDS } from './ttsPresets'

export const USER_PREFERENCES_VERSION = 1

export const userPreferencesSchema = z
  .object({
    version: z.literal(USER_PREFERENCES_VERSION),
    ownerId: z.string().trim().min(1).max(120),
    theme: z.enum(['system', 'light', 'dark']),
    ttsVoicePreset: z.enum(TTS_VOICE_PRESET_IDS),
    ttsVoiceMode: z.enum(['natural-first', 'system']),
    ttsRate: z.number().min(0.75).max(1.2),
    ttsPitch: z.number().min(0.85).max(1.15),
    autoPlayQuestion: z.boolean(),
    defaultPart: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    feedbackDetail: z.enum(['focused', 'expanded']),
    memoryEnabled: z.boolean(),
    autoMatchPersonalMaterialsWithAi: z.boolean(),
    reduceMotion: z.boolean(),
    /** 首页问候主标题;null 表示使用内置默认文案。 */
    homeTitleOverride: z.string().max(40).nullable().default(null),
    /** 首页问候副标题;null 表示使用内置默认文案。 */
    homeSubtitleOverride: z.string().max(80).nullable().default(null),
    updatedAt: isoDateTimeSchema,
  })
  .strict()

export type UserPreferences = z.infer<typeof userPreferencesSchema>
export type UserPreferencesUpdate = Partial<Omit<
  UserPreferences,
  'version' | 'ownerId' | 'updatedAt'
>>

export function createDefaultUserPreferences(
  ownerId: string,
  now = new Date(),
): UserPreferences {
  return userPreferencesSchema.parse({
    version: USER_PREFERENCES_VERSION,
    ownerId,
    theme: 'system',
    ttsVoicePreset: 'backend-default',
    ttsVoiceMode: 'natural-first',
    ttsRate: 0.92,
    ttsPitch: 1,
    autoPlayQuestion: true,
    defaultPart: 1,
    feedbackDetail: 'focused',
    memoryEnabled: true,
    autoMatchPersonalMaterialsWithAi: true,
    reduceMotion: false,
    homeTitleOverride: null,
    homeSubtitleOverride: null,
    updatedAt: now.toISOString(),
  })
}

export function updateUserPreferences(
  current: UserPreferences,
  update: UserPreferencesUpdate,
  now = new Date(),
): UserPreferences {
  return userPreferencesSchema.parse({
    ...current,
    ...update,
    version: USER_PREFERENCES_VERSION,
    ownerId: current.ownerId,
    updatedAt: now.toISOString(),
  })
}
