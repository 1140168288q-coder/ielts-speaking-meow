import {
  TTS_VOICE_CONFIG_VERSION,
  ttsCacheEntrySchema,
} from '../../domain'
import type { TtsCacheStorage } from '../../ports/imports'
import type {
  PlaybackController,
  RecordingPlayback,
  TTSCapabilities,
  TTSProvider,
  TTSRequest,
} from '../../ports/speech'
import { ApiProviderError } from '../ai/providerErrors'
import type { BackendClient } from './backendClient'
import type { BackendHealthCache } from './backendHealth'

const capabilities: TTSCapabilities = {
  language: true,
  voice: false,
  rate: true,
  pitch: true,
  style: false,
}

const TTS_TIMEOUT_MS = 60_000
/** 云端合成失败后的短期熔断时长:期间直接走系统 TTS,避免反复等待云端。 */
const CIRCUIT_BREAK_MS = 60_000

/**
 * AI 语音通过自建 Backend 调用(Backend 内部再调火山语音合成 2.0)。
 * 音色由服务端统一配置,language/rate/pitch 会随请求转发。
 *
 * 可用性由 BackendHealthCache 驱动:
 * - 云端状态未知(启动后健康检查未完成或 Backend 不可达)时不可用,
 *   FallbackTTSProvider 会立即使用系统 TTS,不等待云端超时;
 * - 云端确认未配置 TTS 时不可用;
 * - 一次云端合成失败后进入 60 秒熔断,期间同样直接走系统 TTS。
 */
export class BackendTtsProvider implements TTSProvider {
  readonly id = 'backend-tts'
  readonly capabilities = capabilities
  readonly playbackController?: PlaybackController
  private generation = 0
  private trippedUntil = 0


  constructor(
    private readonly client: BackendClient,
    private readonly cache: TtsCacheStorage,
    private readonly playback: RecordingPlayback,
    private readonly health?: BackendHealthCache,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (playback.playbackController) {
      this.playbackController = playback.playbackController
    }
  }

  isAvailable(): boolean {
    if (this.health) {
      // 健康状态未知(Backend 不可达 / 尚未检查)时立即回退系统 TTS
      if (this.health.statusOf('volc_tts') !== 'configured') {
        return false
      }
    }
    return !this.isTripped()
  }

  async speak(request: TTSRequest): Promise<void> {
    const generation = ++this.generation
    await this.playback.stop()
    if (!this.isCurrent(generation)) return

    const cacheId = await createCacheId({
      text: request.text,
      provider: this.id,
      model: this.voiceModel(),
      speaker: this.voiceSpeaker(),
      language: request.language ?? null,
      rate: request.rate ?? null,
      pitch: request.pitch ?? null,
      voiceConfigVersion: TTS_VOICE_CONFIG_VERSION,
    })
    if (!this.isCurrent(generation)) return

    const cached = await this.cache.getTtsCacheEntry(cacheId).catch(() => null)
    if (!this.isCurrent(generation)) return

    let audio = cached?.audio ?? null

    if (audio === null) {
      try {
        const response = await this.client.postBinary(
          '/v1/tts',
          buildTtsPayload(request),
          TTS_TIMEOUT_MS,
        )
        if (!this.isCurrent(generation)) return

        if (response.size === 0) {
          throw new ApiProviderError(
            'invalid-response',
            '云端语音返回了空音频,已切换系统朗读。',
            true,
          )
        }
        audio = new Blob([response], { type: response.type || 'audio/mpeg' })
        this.trippedUntil = 0
      } catch (error) {
        // 云端失败后短期熔断,让后续请求立即走系统 TTS
        this.trippedUntil = this.now() + CIRCUIT_BREAK_MS
        throw error
      }

      const metadata = ttsCacheEntrySchema.parse({
        id: cacheId,
        mimeType: audio.type || 'audio/mpeg',
        createdAt: new Date().toISOString(),
      })
      await this.cache.putTtsCacheEntry(metadata, audio).catch(() => undefined)
      if (!this.isCurrent(generation)) return
    }

    if (!this.isCurrent(generation)) return
    const source = URL.createObjectURL(audio)
    try {
      await this.playback.play(source)
    } finally {
      URL.revokeObjectURL(source)
    }
  }

  stop(): Promise<void> {
    this.generation += 1
    return this.playback.stop()
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation
  }

  private isTripped(): boolean {
    return this.trippedUntil > this.now()
  }

  /** 服务端当前 TTS 模型;健康信息未知时用占位值(此时也不会走云端)。 */
  private voiceModel(): string {
    return this.health?.providerInfo('volc_tts')?.model ?? 'unknown'
  }

  /** 服务端当前音色 ID;换音色后缓存键随之变化,不会命中旧音色音频。 */
  private voiceSpeaker(): string {
    return this.health?.providerInfo('volc_tts')?.speaker?.id ?? 'unknown'
  }
}

function buildTtsPayload(request: TTSRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = { text: request.text }
  if (request.language !== undefined) payload.language = request.language
  if (request.rate !== undefined) payload.rate = request.rate
  if (request.pitch !== undefined) payload.pitch = request.pitch
  if (request.voice !== undefined) payload.voice = request.voice
  if (request.style !== undefined) payload.style = request.style
  return payload
}

async function createCacheId(value: unknown): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify(value))
  if (globalThis.crypto?.subtle !== undefined) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', input)
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
  }

  let hash = 2166136261
  for (const byte of input) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return `fallback-${(hash >>> 0).toString(16)}`
}
