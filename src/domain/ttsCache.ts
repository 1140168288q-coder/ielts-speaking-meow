import { z } from 'zod'

const nonEmptyText = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength)

/**
 * 云端 TTS 音色配置版本。任何影响合成结果的变更(音色、模型、默认
 * 语速/音高处理、缓存键结构)都必须递增此版本,客户端升级时会清空
 * 一次旧 AI TTS 缓存,避免旧音色音频继续命中。
 * V3:缓存键继续区分用户选择的云端 speaker 与对应的 pitch。
 */
export const TTS_VOICE_CONFIG_VERSION = 3

/** TTS 音频缓存条目元数据(自 Backend 化后缓存云端合成音频)。 */
export const ttsCacheEntrySchema = z
  .object({
    id: nonEmptyText(128),
    mimeType: nonEmptyText(120),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export type TtsCacheEntry = z.infer<typeof ttsCacheEntrySchema>
