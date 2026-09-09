import { z } from 'zod'

export const naturalUpgradeLevelSchema = z.enum([
  'simple',
  'medium',
  'challenging',
])

export const spokenEnglishStyleSchema = z.enum(['british', 'american'])

export const feedbackGenerationProfileSchema = z
  .object({
    level: naturalUpgradeLevelSchema,
    style: spokenEnglishStyleSchema,
    profileVersion: z.literal(1),
  })
  .strict()

export type NaturalUpgradeLevel = z.infer<typeof naturalUpgradeLevelSchema>
export type SpokenEnglishStyle = z.infer<typeof spokenEnglishStyleSchema>
export type FeedbackGenerationProfile = z.infer<typeof feedbackGenerationProfileSchema>

export const DEFAULT_FEEDBACK_GENERATION_PROFILE: FeedbackGenerationProfile = {
  level: 'medium',
  style: 'british',
  profileVersion: 1,
}

export const naturalUpgradeLevelLabels: Record<NaturalUpgradeLevel, string> = {
  simple: '简单',
  medium: '中等',
  challenging: '较难',
}

export const spokenEnglishStyleLabels: Record<SpokenEnglishStyle, string> = {
  british: '英式自然口语',
  american: '美式自然口语',
}

export interface FeedbackLengthBudget {
  minWords: number
  maxWords: number
  targetSeconds: number | null
}

export function feedbackLengthBudget(
  part: 1 | 2 | 3,
  level: NaturalUpgradeLevel,
): FeedbackLengthBudget {
  if (part === 2) {
    return level === 'simple'
      ? { minWords: 120, maxWords: 160, targetSeconds: 75 }
      : level === 'medium'
        ? { minWords: 150, maxWords: 190, targetSeconds: 90 }
        : { minWords: 180, maxWords: 230, targetSeconds: 105 }
  }

  if (part === 3) {
    return level === 'simple'
      ? { minWords: 35, maxWords: 48, targetSeconds: 15 }
      : level === 'medium'
        ? { minWords: 45, maxWords: 62, targetSeconds: 20 }
        : { minWords: 58, maxWords: 78, targetSeconds: 25 }
  }

  return level === 'simple'
    ? { minWords: 30, maxWords: 40, targetSeconds: 15 }
    : level === 'medium'
      ? { minWords: 40, maxWords: 52, targetSeconds: 20 }
      : { minWords: 50, maxWords: 65, targetSeconds: 25 }
}
