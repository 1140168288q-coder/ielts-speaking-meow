import { z } from 'zod'

const nonEmptyText = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength)

/** TTS 音频缓存条目元数据(自 Backend 化后缓存云端合成音频)。 */
export const ttsCacheEntrySchema = z
  .object({
    id: nonEmptyText(128),
    mimeType: nonEmptyText(120),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export type TtsCacheEntry = z.infer<typeof ttsCacheEntrySchema>
