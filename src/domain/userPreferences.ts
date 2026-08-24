import { z } from 'zod'
import { isoDateTimeSchema } from './models'

export const USER_PREFERENCES_VERSION = 1

export const userPreferencesSchema = z
  .object({
    version: z.literal(USER_PREFERENCES_VERSION),
    ownerId: z.string().trim().min(1).max(120),
    theme: z.enum(['system', 'light', 'dark']),
    ttsVoiceMode: z.enum(['natural-first', 'system']),
    ttsRate: z.number().min(0.75).max(1.2),
    autoPlayQuestion: z.boolean(),
    defaultPart: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    feedbackDetail: z.enum(['focused', 'expanded']),
    memoryEnabled: z.boolean(),
    sharePersonalMaterialsWithAi: z.boolean(),
    reduceMotion: z.boolean(),
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
    ttsVoiceMode: 'natural-first',
    ttsRate: 0.92,
    autoPlayQuestion: true,
    defaultPart: 1,
    feedbackDetail: 'focused',
    memoryEnabled: true,
    sharePersonalMaterialsWithAi: false,
    reduceMotion: false,
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
