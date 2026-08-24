import {
  IDLE_PLAYBACK_SNAPSHOT,
  SpeechCapabilityUnavailableError,
  type PlaybackController,
  type PlaybackListener,
  type PlaybackSnapshot,
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

class DelegatingPlaybackController implements PlaybackController {
  private activeProvider: TTSProvider | null = null
  private currentSnapshot: PlaybackSnapshot = IDLE_PLAYBACK_SNAPSHOT
  private readonly listeners = new Set<PlaybackListener>()

  constructor(providers: readonly TTSProvider[]) {
    providers.forEach((provider) => {
      provider.playbackController?.subscribePlayback((snapshot) => {
        if (this.activeProvider !== provider) {
          return
        }
        this.currentSnapshot = {
          ...snapshot,
          providerId: provider.id,
        }
        this.publish()
      })
    })
  }

  get snapshot(): PlaybackSnapshot {
    return this.currentSnapshot
  }

  subscribePlayback(listener: PlaybackListener): () => void {
    this.listeners.add(listener)
    listener(this.currentSnapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }

  activate(provider: TTSProvider): void {
    this.activeProvider = provider
    this.currentSnapshot = {
      ...IDLE_PLAYBACK_SNAPSHOT,
      status: 'loading',
      providerId: provider.id,
    }
    this.publish()
  }

  markStartedIfUncontrolled(provider: TTSProvider): void {
    if (
      this.activeProvider === provider &&
      provider.playbackController === undefined
    ) {
      this.currentSnapshot = {
        ...this.currentSnapshot,
        status: 'playing',
      }
      this.publish()
    }
  }

  complete(provider?: TTSProvider): void {
    if (provider !== undefined && this.activeProvider !== provider) {
      return
    }
    this.activeProvider = null
    this.currentSnapshot = IDLE_PLAYBACK_SNAPSHOT
    this.publish()
  }

  pause(): Promise<boolean> {
    return this.activeProvider?.playbackController?.pause() ??
      Promise.resolve(false)
  }

  resume(): Promise<boolean> {
    return this.activeProvider?.playbackController?.resume() ??
      Promise.resolve(false)
  }

  seekTo(positionSeconds: number): Promise<boolean> {
    return this.activeProvider?.playbackController?.seekTo(positionSeconds) ??
      Promise.resolve(false)
  }

  private publish(): void {
    const snapshot = this.currentSnapshot
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot)
      } catch {
        // UI listeners cannot disrupt the fallback path.
      }
    })
  }
}

/** Uses an optional AI provider first and transparently falls back to system TTS. */
export class FallbackTTSProvider implements TTSProvider {
  readonly id: string
  readonly capabilities: TTSCapabilities
  readonly playbackController: PlaybackController

  private generation = 0
  private readonly delegatedPlayback: DelegatingPlaybackController

  constructor(
    private readonly primary: TTSProvider,
    private readonly fallback: TTSProvider,
  ) {
    this.id = `${primary.id}-with-${fallback.id}-fallback`
    this.capabilities = commonCapabilities(
      primary.capabilities,
      fallback.capabilities,
    )
    this.delegatedPlayback = new DelegatingPlaybackController([
      primary,
      fallback,
    ])
    this.playbackController = this.delegatedPlayback
  }

  isAvailable(): boolean {
    return this.primary.isAvailable() || this.fallback.isAvailable()
  }

  async speak(request: TTSRequest): Promise<void> {
    const generation = ++this.generation
    this.delegatedPlayback.complete()
    await this.stopProviders()
    if (generation !== this.generation) return

    if (this.primary.isAvailable()) {
      try {
        await this.speakWith(this.primary, request, generation)
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
        if (generation !== this.generation) return

        if (!this.fallback.isAvailable()) {
          throw primaryError
        }

        await this.speakWith(this.fallback, request, generation)
        return
      }
    }

    if (this.fallback.isAvailable()) {
      await this.speakWith(this.fallback, request, generation)
      return
    }

    throw new SpeechCapabilityUnavailableError(
      'tts',
      'Neither the preferred nor the system TTS provider is available',
    )
  }

  async stop(): Promise<void> {
    this.generation += 1
    this.delegatedPlayback.complete()
    await this.stopProviders()
  }

  private async speakWith(
    provider: TTSProvider,
    request: TTSRequest,
    generation: number,
  ): Promise<void> {
    this.delegatedPlayback.activate(provider)
    try {
      const playback = provider.speak(request)
      this.delegatedPlayback.markStartedIfUncontrolled(provider)
      await playback
    } finally {
      if (generation === this.generation) {
        this.delegatedPlayback.complete(provider)
      }
    }
  }

  private async stopProviders(): Promise<void> {
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
