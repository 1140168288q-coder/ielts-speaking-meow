import {
  SpeechCapabilityUnavailableError,
  type TTSCapabilities,
  type TTSProvider,
  type TTSRequest,
} from '../../ports/speech'

function commonCapabilities(
  primary: TTSCapabilities,
  fallback: TTSCapabilities,
): TTSCapabilities {
  return {
    language: primary.language && fallback.language,
    voice: primary.voice && fallback.voice,
    rate: primary.rate && fallback.rate,
    pitch: primary.pitch && fallback.pitch,
    style: primary.style && fallback.style,
  }
}

/** Uses an optional AI provider first and transparently falls back to system TTS. */
export class FallbackTTSProvider implements TTSProvider {
  readonly id: string
  readonly capabilities: TTSCapabilities

  private generation = 0

  constructor(
    private readonly primary: TTSProvider,
    private readonly fallback: TTSProvider,
  ) {
    this.id = `${primary.id}-with-${fallback.id}-fallback`
    this.capabilities = commonCapabilities(
      primary.capabilities,
      fallback.capabilities,
    )
  }

  isAvailable(): boolean {
    return this.primary.isAvailable() || this.fallback.isAvailable()
  }

  async speak(request: TTSRequest): Promise<void> {
    await this.stop()
    const generation = ++this.generation

    if (this.primary.isAvailable()) {
      try {
        await this.primary.speak(request)
        return
      } catch (primaryError) {
        if (generation !== this.generation) {
          return
        }

        try {
          await this.primary.stop()
        } catch {
          throw primaryError
        }

        if (!this.fallback.isAvailable()) {
          throw primaryError
        }

        await this.fallback.speak(request)
        return
      }
    }

    if (this.fallback.isAvailable()) {
      await this.fallback.speak(request)
      return
    }

    throw new SpeechCapabilityUnavailableError(
      'tts',
      'Neither the preferred nor the system TTS provider is available',
    )
  }

  async stop(): Promise<void> {
    this.generation += 1
    const results = await Promise.allSettled([
      this.primary.stop(),
      this.fallback.stop(),
    ])
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (failed) {
      throw failed.reason
    }
  }
}
