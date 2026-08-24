import {
  IDLE_PLAYBACK_SNAPSHOT,
  type PlaybackController,
  type PlaybackListener,
  type PlaybackSnapshot,
  type PlaybackStatus,
  type RecordingPlayback,
} from '../../ports/speech'

export interface HTMLAudioElementLike {
  src: string
  currentTime: number
  duration?: number
  onended: (() => void) | null
  onerror: (() => void) | null
  onloadedmetadata?: (() => void) | null
  ontimeupdate?: (() => void) | null
  onplay?: (() => void) | null
  onpause?: (() => void) | null
  play(): Promise<void>
  pause(): void
}

export type HTMLAudioElementFactory = () => HTMLAudioElementLike

interface ActivePlayback {
  element: HTMLAudioElementLike
  resolve: () => void
  reject: (reason: unknown) => void
}

function browserAudioFactory(): HTMLAudioElementFactory | undefined {
  const browser = globalThis as typeof globalThis & {
    Audio?: new () => HTMLAudioElement
  }
  const AudioElement = browser.Audio
  return AudioElement
    ? () => new AudioElement() as unknown as HTMLAudioElementLike
    : undefined
}

function finiteSeconds(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

/**
 * Plays generated TTS audio and legacy recordings through one reusable HTML
 * audio boundary. Prepared cloud audio exposes real duration, pause/resume and
 * seek; callers can feature-detect the controller before showing controls.
 */
export class HTMLAudioPlayback implements RecordingPlayback, PlaybackController {
  readonly playbackController: PlaybackController = this

  private readonly createAudio: HTMLAudioElementFactory | undefined
  private active: ActivePlayback | null = null
  private currentSnapshot: PlaybackSnapshot = IDLE_PLAYBACK_SNAPSHOT
  private readonly playbackListeners = new Set<PlaybackListener>()

  constructor(createAudio = browserAudioFactory()) {
    this.createAudio = createAudio
  }

  get snapshot(): PlaybackSnapshot {
    const active = this.active
    if (!active) {
      return this.currentSnapshot
    }
    return this.snapshotFor(this.currentSnapshot.status, active.element)
  }

  subscribePlayback(listener: PlaybackListener): () => void {
    this.playbackListeners.add(listener)
    listener(this.snapshot)
    return () => {
      this.playbackListeners.delete(listener)
    }
  }

  isAvailable(): boolean {
    return Boolean(this.createAudio)
  }

  async play(source: string): Promise<void> {
    if (!source.trim()) {
      throw new TypeError('Recording source must not be empty')
    }
    const createAudio = this.createAudio
    if (!createAudio) {
      throw new Error('Audio playback is unavailable on this device')
    }

    await this.stop()
    const element = createAudio()
    element.src = source
    element.currentTime = 0

    return new Promise<void>((resolve, reject) => {
      const active: ActivePlayback = { element, resolve, reject }
      this.active = active
      this.publish('loading', element)

      element.onloadedmetadata = () => {
        this.publish(this.currentSnapshot.status, element)
      }
      element.ontimeupdate = () => {
        this.publish(this.currentSnapshot.status, element)
      }
      element.onplay = () => {
        this.publish('playing', element)
      }
      element.onpause = () => {
        if (this.active === active) {
          this.publish('paused', element)
        }
      }
      element.onended = () => {
        this.settle(active, 'resolve')
      }
      element.onerror = () => {
        this.settle(active, 'reject', new Error('Audio playback failed'))
      }

      void element.play().then(
        () => {
          if (this.active === active) {
            this.publish('playing', element)
          }
        },
        (error: unknown) => {
          this.settle(active, 'reject', error)
        },
      )
    })
  }

  pause(): Promise<boolean> {
    const active = this.active
    if (!active || this.currentSnapshot.status !== 'playing') {
      return Promise.resolve(false)
    }
    active.element.pause()
    this.publish('paused', active.element)
    return Promise.resolve(true)
  }

  async resume(): Promise<boolean> {
    const active = this.active
    if (!active || this.currentSnapshot.status !== 'paused') {
      return false
    }
    try {
      await active.element.play()
      if (this.active === active) {
        this.publish('playing', active.element)
      }
      return true
    } catch (error) {
      this.settle(active, 'reject', error)
      return false
    }
  }

  seekTo(positionSeconds: number): Promise<boolean> {
    const active = this.active
    const duration = finiteSeconds(active?.element.duration)
    if (!active || duration === null || duration === 0) {
      return Promise.resolve(false)
    }

    const nextPosition = Math.min(duration, Math.max(0, positionSeconds))
    try {
      active.element.currentTime = nextPosition
      this.publish(this.currentSnapshot.status, active.element)
      return Promise.resolve(true)
    } catch {
      return Promise.resolve(false)
    }
  }

  stop(): Promise<void> {
    const active = this.active
    if (!active) {
      this.publish('idle')
      return Promise.resolve()
    }

    active.element.pause()
    try {
      active.element.currentTime = 0
    } catch {
      // Some remote streams do not allow seeking; pausing is still sufficient.
    }
    this.settle(active, 'resolve')
    return Promise.resolve()
  }

  private snapshotFor(
    status: PlaybackStatus,
    element?: HTMLAudioElementLike,
  ): PlaybackSnapshot {
    if (status === 'idle' || !element) {
      return IDLE_PLAYBACK_SNAPSHOT
    }

    const duration = finiteSeconds(element.duration)
    const position = finiteSeconds(element.currentTime) ?? 0
    return {
      status,
      positionSeconds: duration === null ? position : Math.min(position, duration),
      durationSeconds: duration,
      canPause: status === 'playing' || status === 'paused',
      canSeek: duration !== null && duration > 0,
      providerId: 'html-audio',
    }
  }

  private publish(
    status: PlaybackStatus,
    element = this.active?.element,
  ): void {
    this.currentSnapshot = this.snapshotFor(status, element)
    const snapshot = this.currentSnapshot
    this.playbackListeners.forEach((listener) => {
      try {
        listener(snapshot)
      } catch {
        // UI listeners cannot disrupt playback.
      }
    })
  }

  private settle(
    active: ActivePlayback,
    outcome: 'resolve' | 'reject',
    reason?: unknown,
  ): void {
    if (this.active !== active) {
      return
    }

    active.element.onended = null
    active.element.onerror = null
    active.element.onloadedmetadata = null
    active.element.ontimeupdate = null
    active.element.onplay = null
    active.element.onpause = null
    this.active = null
    this.publish('idle')
    if (outcome === 'resolve') {
      active.resolve()
    } else {
      active.reject(reason)
    }
  }
}
