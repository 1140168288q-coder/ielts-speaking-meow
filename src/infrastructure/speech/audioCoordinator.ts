import {
  AudioFocusConflictError,
  type AudioFocus,
  type AudioFocusListener,
  type AudioFocusState,
  type AudioRecorder,
  type AudioRecording,
  type RecordingOptions,
  type RecordingPlayback,
  type TTSProvider,
  type TTSRequest,
} from '../../ports/speech'

export class AudioCoordinator implements AudioFocus {
  private currentState: AudioFocusState = 'idle'
  private readonly listeners = new Set<AudioFocusListener>()
  private transition: Promise<void> = Promise.resolve()
  private activityToken = 0

  constructor(
    private readonly tts: TTSProvider,
    private readonly recorder: AudioRecorder,
    private readonly recordingPlayback: RecordingPlayback,
  ) {}

  get state(): AudioFocusState {
    return this.currentState
  }

  subscribe(listener: AudioFocusListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async speak(request: TTSRequest): Promise<void> {
    let playback: Promise<void> | undefined
    let token = 0

    await this.exclusive(async () => {
      this.assertPlaybackAllowed()
      token = ++this.activityToken
      await this.recordingPlayback.stop()
      await this.tts.stop()
      this.setState('tts')
      playback = this.tts.speak(request)
    })

    try {
      await playback
    } finally {
      await this.exclusive(() => {
        if (token === this.activityToken && this.currentState === 'tts') {
          this.setState('idle')
        }
      })
    }
  }

  stopTTS(): Promise<void> {
    return this.exclusive(async () => {
      this.activityToken += 1
      await this.tts.stop()
      if (this.currentState === 'tts') {
        this.setState('idle')
      }
    })
  }

  async playRecording(source: string): Promise<void> {
    let playback: Promise<void> | undefined
    let token = 0

    await this.exclusive(async () => {
      this.assertPlaybackAllowed()
      token = ++this.activityToken
      await this.tts.stop()
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

  startRecording(options?: RecordingOptions): Promise<void> {
    return this.exclusive(async () => {
      if (this.recorder.state !== 'idle' || this.currentState === 'recording') {
        throw new AudioFocusConflictError('A recording is already active')
      }

      this.activityToken += 1
      await this.stopPlayers()

      try {
        await this.recorder.start(options)
        this.setState('recording')
      } catch (error) {
        this.setState('idle')
        throw error
      }
    })
  }

  stopRecording(): Promise<AudioRecording> {
    return this.exclusive(async () => {
      if (
        this.currentState !== 'recording' ||
        this.recorder.state !== 'recording'
      ) {
        throw new Error('No recording is active')
      }

      try {
        return await this.recorder.stop()
      } finally {
        if (this.recorderIsIdle()) {
          this.setState('idle')
        }
      }
    })
  }

  cancelRecording(): Promise<void> {
    return this.exclusive(async () => {
      if (this.recorder.state === 'idle') {
        if (this.currentState === 'recording') {
          this.setState('idle')
        }
        return
      }

      try {
        await this.recorder.cancel()
      } finally {
        if (this.recorderIsIdle()) {
          this.setState('idle')
        }
      }
    })
  }

  stopAllPlayback(): Promise<void> {
    return this.exclusive(async () => {
      this.activityToken += 1
      await this.stopPlayers()
      if (this.currentState !== 'recording') {
        this.setState('idle')
      }
    })
  }

  private assertPlaybackAllowed(): void {
    if (this.currentState === 'recording' || this.recorder.state !== 'idle') {
      throw new AudioFocusConflictError()
    }
  }

  private recorderIsIdle(): boolean {
    return this.recorder.state === 'idle'
  }

  private async stopPlayers(): Promise<void> {
    const results = await Promise.allSettled([
      this.tts.stop(),
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

  private exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.transition.then(operation, operation)
    this.transition = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
