import { z } from 'zod'

const providerSchema = z.literal('openai-compatible')
const nonEmptyText = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength)

const secureEndpointSchema = z
  .url()
  .max(2_048)
  .refine((endpoint) => new URL(endpoint).protocol === 'https:', {
    message: 'API endpoint must use HTTPS.',
  })

const commonConfigurationShape = {
  provider: providerSchema,
  endpoint: secureEndpointSchema,
  model: nonEmptyText(160),
  enabled: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }),
}

export const textAiConfigurationSchema = z
  .object({
    id: z.literal('text-ai'),
    ...commonConfigurationShape,
  })
  .strict()

export const voiceAiConfigurationSchema = z
  .object({
    id: z.literal('voice-ai'),
    ...commonConfigurationShape,
    voice: nonEmptyText(120),
  })
  .strict()

export const sttConfigurationSchema = z
  .object({
    id: z.literal('stt'),
    ...commonConfigurationShape,
  })
  .strict()

export const apiConfigurationSchema = z.discriminatedUnion('id', [
  textAiConfigurationSchema,
  voiceAiConfigurationSchema,
  sttConfigurationSchema,
])

export const apiCapabilitySchema = z.enum(['text-ai', 'voice-ai', 'stt'])

export type ApiCapability = z.infer<typeof apiCapabilitySchema>
export type TextAiConfiguration = z.infer<typeof textAiConfigurationSchema>
export type VoiceAiConfiguration = z.infer<typeof voiceAiConfigurationSchema>
export type SttConfiguration = z.infer<typeof sttConfigurationSchema>
export type ApiConfiguration = z.infer<typeof apiConfigurationSchema>

export const ttsCacheEntrySchema = z
  .object({
    id: nonEmptyText(128),
    mimeType: nonEmptyText(120),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export type TtsCacheEntry = z.infer<typeof ttsCacheEntrySchema>
