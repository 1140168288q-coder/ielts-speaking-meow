import {
  IDLE_PLAYBACK_SNAPSHOT,
  type AudioFocus,
  type AudioFocusListener,
  type AudioFocusState,
  type PlaybackListener,
  type PlaybackSnapshot,
  type RecordingPlayback,
  type TTSProvider,
  type TTSRequest,
} from '../../ports/speech'
export interface TtsPlaybackPreferences {
  voiceMode: 'natural-first' | 'system'
  rate: number
}

export interface AudioCoordinatorOptions {
  systemTts?: TTSProvider
  getPlaybackPreferences?: () => TtsPlaybackPreferences
}


export class AudioCoordinator implements AudioFocus {
  private currentState: AudioFocusState = 'idle'
  private currentTtsPlayback: PlaybackSnapshot = IDLE_PLAYBACK_SNAPSHOT
  private readonly listeners = new Set<AudioFocusListener>()
  private readonly ttsPlaybackListeners = new Set<PlaybackListener>()
  private activeTts: TTSProvider
  private transition: Promise<void> = Promise.resolve()
  private activityToken = 0

  constructor(
    private readonly tts: TTSProvider,
    private readonly recordingPlayback: RecordingPlayback,
    private readonly options: AudioCoordinatorOptions = {},
  ) {
    this.activeTts = tts
    for (const provider of this.ttsProviders()) {
      provider.playbackController?.subscribePlayback((snapshot) => {
        if (provider !== this.activeTts) return
        if (this.currentState === 'tts' || snapshot.status === 'idle') {
          this.setTtsPlayback(snapshot)
        }
      })
    }
  }

  get state(): AudioFocusState {
    return this.currentState
  }

  get ttsPlayback(): PlaybackSnapshot {
    return this.currentTtsPlayback
  }

  subscribe(listener: AudioFocusListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeTTSPlayback(listener: PlaybackListener): () => void {
    this.ttsPlaybackListeners.add(listener)
    listener(this.currentTtsPlayback)
    return () => {
      this.ttsPlaybackListeners.delete(listener)
    }
  }

  async speak(request: TTSRequest): Promise<void> {
    let playback: Promise<void> | undefined
    let token = 0

    await this.exclusive(async () => {
      token = ++this.activityToken
      await this.recordingPlayback.stop()
      await this.stopTtsProviders()
      const preferences = this.options.getPlaybackPreferences?.()
      this.activeTts = preferences?.voiceMode === 'system' && this.options.systemTts
        ? this.options.systemTts
        : this.tts
      const effectiveRequest = preferences === undefined
        ? request
        : { ...request, rate: preferences.rate }
      this.setState('tts')
      this.setTtsPlayback({
        ...IDLE_PLAYBACK_SNAPSHOT,
        status: 'loading',
        providerId: this.activeTts.id,
      })
      playback = this.activeTts.speak(effectiveRequest)

      const providerSnapshot = this.activeTts.playbackController?.snapshot
      if (providerSnapshot && providerSnapshot.status !== 'idle') {
        this.setTtsPlayback(providerSnapshot)
      } else if (!this.activeTts.playbackController) {
        this.setTtsPlayback({
          ...IDLE_PLAYBACK_SNAPSHOT,
          status: 'playing',
          providerId: this.activeTts.id,
        })
      }
    })

    try {
      await playback
    } finally {
      await this.exclusive(() => {
        if (token === this.activityToken && this.currentState === 'tts') {
          this.setState('idle')
          this.setTtsPlayback(IDLE_PLAYBACK_SNAPSHOT)
        }
      })
    }
  }

  stopTTS(): Promise<void> {
    return this.exclusive(async () => {
      this.activityToken += 1
      await this.stopTtsProviders()
      if (this.currentState === 'tts') {
        this.setState('idle')
      }
      this.setTtsPlayback(IDLE_PLAYBACK_SNAPSHOT)
    })
  }

  pauseTTS(): Promise<boolean> {
    return this.controlTts((controller) => controller.pause())
  }

  resumeTTS(): Promise<boolean> {
    return this.controlTts((controller) => controller.resume())
  }

  seekTTS(positionSeconds: number): Promise<boolean> {
    return this.controlTts((controller) =>
      controller.seekTo(positionSeconds),
    )
  }

  async playRecording(source: string): Promise<void> {
    let playback: Promise<void> | undefined
    let token = 0

    await this.exclusive(async () => {
      token = ++this.activityToken
      await this.stopTtsProviders()
      this.setTtsPlayback(IDLE_PLAYBACK_SNAPSHOT)
      await this.recordingPlayback.stop()
      this.setState('recording-playback')
      playback = this.recordingPlayback.play(source)
    })

    try {
      await playback
    } finally {
      await this.exclusive(() => {
        if (
          token === this.activityToken &&
          this.currentState === 'recording-playback'
        ) {
          this.setState('idle')
        }
      })
    }
  }

  stopRecordingPlayback(): Promise<void> {
    return this.exclusive(async () => {
      this.activityToken += 1
      await this.recordingPlayback.stop()
      if (this.currentState === 'recording-playback') {
        this.setState('idle')
      }
    })
  }

  stopAllPlayback(): Promise<void> {
    return this.exclusive(async () => {
      this.activityToken += 1
      await this.stopPlayers()
      this.setState('idle')
      this.setTtsPlayback(IDLE_PLAYBACK_SNAPSHOT)
    })
  }

  private controlTts(
    control: (controller: NonNullable<TTSProvider['playbackController']>) =>
      Promise<boolean>,
  ): Promise<boolean> {
    return this.exclusive(async () => {
      const controller = this.activeTts.playbackController
      if (this.currentState !== 'tts' || !controller) {
        return false
      }
      const changed = await control(controller)
      if (changed) {
        this.setTtsPlayback(controller.snapshot)
      }
      return changed
    })
  }

  private ttsProviders(): TTSProvider[] {
    const systemTts = this.options.systemTts
    return systemTts && systemTts !== this.tts ? [this.tts, systemTts] : [this.tts]
  }

  private async stopTtsProviders(): Promise<void> {
    const results = await Promise.allSettled(
      this.ttsProviders().map((provider) => provider.stop()),
    )
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (failed) throw failed.reason
  }

  private async stopPlayers(): Promise<void> {
    const results = await Promise.allSettled([
      ...this.ttsProviders().map((provider) => provider.stop()),
      this.recordingPlayback.stop(),
    ])
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (failed) {
      throw failed.reason
    }
  }

  private setState(state: AudioFocusState): void {
    if (state === this.currentState) {
      return
    }
    this.currentState = state
    this.listeners.forEach((listener) => {
      try {
        listener(state)
      } catch {
        // A view listener must never break audio safety transitions.
      }
    })
  }

  private setTtsPlayback(snapshot: PlaybackSnapshot): void {
    const previous = this.currentTtsPlayback
    if (
      previous.status === snapshot.status &&
      previous.positionSeconds === snapshot.positionSeconds &&
      previous.durationSeconds === snapshot.durationSeconds &&
      previous.canPause === snapshot.canPause &&
      previous.canSeek === snapshot.canSeek &&
      previous.providerId === snapshot.providerId
    ) {
      return
    }

    this.currentTtsPlayback = snapshot
    this.ttsPlaybackListeners.forEach((listener) => {
      try {
        listener(snapshot)
      } catch {
        // A view listener must never break audio safety transitions.
      }
    })
  }

  private exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.transition.then(operation, operation)
    this.transition = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
