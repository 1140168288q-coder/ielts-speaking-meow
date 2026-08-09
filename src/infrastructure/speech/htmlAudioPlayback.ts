import type { RecordingPlayback } from '../../ports/speech'

export interface HTMLAudioElementLike {
  src: string
  currentTime: number
  onended: (() => void) | null
  onerror: (() => void) | null
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

/** Plays persisted answer recordings through a single reusable focus boundary. */
export class HTMLAudioPlayback implements RecordingPlayback {
  private readonly createAudio: HTMLAudioElementFactory | undefined
  private active: ActivePlayback | null = null

  constructor(createAudio = browserAudioFactory()) {
    this.createAudio = createAudio
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
      element.onended = () => {
        this.settle(active, 'resolve')
      }
      element.onerror = () => {
        this.settle(active, 'reject', new Error('Recording playback failed'))
      }

      void element.play().catch((error: unknown) => {
        this.settle(active, 'reject', error)
      })
    })
  }

  stop(): Promise<void> {
    const active = this.active
    if (!active) {
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
    this.active = null
    if (outcome === 'resolve') {
      active.resolve()
    } else {
      active.reject(reason)
    }
  }
}
