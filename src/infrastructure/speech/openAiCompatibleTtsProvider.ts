import type { ApiConfigurationService } from '../../application/apiConfigurationService'
import { ttsCacheEntrySchema } from '../../domain'
import type { TtsCacheStorage } from '../../ports/imports'
import type {
  RecordingPlayback,
  TTSCapabilities,
  TTSProvider,
  TTSRequest,
} from '../../ports/speech'
import type { ApiTransport } from '../ai/apiTransport'
import { joinEndpoint } from '../ai/openAiCompatibleTextProvider'
import {
  ApiProviderError,
  assertSuccessfulStatus,
  mapTransportFailure,
} from '../ai/providerErrors'

const capabilities: TTSCapabilities = {
  language: false,
  voice: true,
  rate: true,
  pitch: false,
  style: true,
}

export class OpenAICompatibleTtsProvider implements TTSProvider {
  readonly id = 'openai-compatible-voice'
  readonly capabilities = capabilities
  private generation = 0

  constructor(
    private readonly settings: ApiConfigurationService,
    private readonly transport: ApiTransport,
    private readonly cache: TtsCacheStorage,
    private readonly playback: RecordingPlayback,
  ) {}

  isAvailable(): boolean {
    return this.settings.getStatus('voice-ai').configured
  }

  async speak(request: TTSRequest): Promise<void> {
    const generation = ++this.generation
    await this.playback.stop()
    if (!this.isCurrent(generation)) return

    const status = this.settings.getStatus('voice-ai')
    const configuration = status.configuration
    const key = await this.settings.getSecret('voice-ai')
    if (!this.isCurrent(generation)) return

    if (
      !status.configured ||
      configuration?.id !== 'voice-ai' ||
      key === null
    ) {
      throw new ApiProviderError('not-configured', 'Voice AI 尚未配置。', false)
    }

    const cacheId = await createCacheId({
      text: request.text,
      endpoint: configuration.endpoint,
      model: configuration.model,
      voice: request.voice ?? configuration.voice,
      rate: request.rate ?? null,
      style: request.style ?? null,
    })
    if (!this.isCurrent(generation)) return

    const cached = await this.cache.getTtsCacheEntry(cacheId).catch(() => null)
    if (!this.isCurrent(generation)) return

    let audio = cached?.audio ?? null

    if (audio === null) {
      const response = await mapTransportFailure(() =>
        this.transport.postJsonForBinary(
          joinEndpoint(configuration.endpoint, 'audio/speech'),
          key,
          {
            model: configuration.model,
            input: request.text,
            voice: request.voice ?? configuration.voice,
            response_format: 'mp3',
            ...(request.rate === undefined ? {} : { speed: request.rate }),
            ...(request.style === undefined
              ? {}
              : { instructions: request.style }),
          },
          60_000,
        ),
      )
      if (!this.isCurrent(generation)) return

      assertSuccessfulStatus(response.status)
      if (response.data.size === 0) {
        throw new ApiProviderError(
          'invalid-response',
          'Voice AI 返回了空音频，已切换系统朗读。',
          true,
        )
      }
      audio = response.data
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
