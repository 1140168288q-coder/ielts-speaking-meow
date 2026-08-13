import { ttsCacheEntrySchema } from '../../domain'
import type { TtsCacheStorage } from '../../ports/imports'
import type {
  RecordingPlayback,
  TTSCapabilities,
  TTSProvider,
  TTSRequest,
} from '../../ports/speech'
import { ApiProviderError } from '../ai/providerErrors'
import type { BackendClient } from './backendClient'

const capabilities: TTSCapabilities = {
  language: false,
  voice: false,
  rate: false,
  pitch: false,
  style: false,
}

const TTS_TIMEOUT_MS = 60_000

/**
 * AI 语音通过自建 Backend 调用(Backend 内部再调火山语音合成 2.0)。
 * 音色由服务端统一配置;失败时 FallbackTTSProvider 会切回系统 TTS。
 */
export class BackendTtsProvider implements TTSProvider {
  readonly id = 'backend-tts'
  readonly capabilities = capabilities
  private generation = 0

  constructor(
    private readonly client: BackendClient,
    private readonly cache: TtsCacheStorage,
    private readonly playback: RecordingPlayback,
  ) {}

  isAvailable(): boolean {
    return true
  }

  async speak(request: TTSRequest): Promise<void> {
    const generation = ++this.generation
    await this.playback.stop()
    if (!this.isCurrent(generation)) return

    const cacheId = await createCacheId({ text: request.text })
    if (!this.isCurrent(generation)) return

    const cached = await this.cache.getTtsCacheEntry(cacheId).catch(() => null)
    if (!this.isCurrent(generation)) return

    let audio = cached?.audio ?? null

    if (audio === null) {
      const response = await this.client.postBinary(
        '/v1/tts',
        { text: request.text },
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
