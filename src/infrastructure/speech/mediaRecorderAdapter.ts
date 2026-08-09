import {
  SpeechCapabilityUnavailableError,
  type AudioRecorder,
  type AudioRecording,
  type RecorderState,
  type RecordingOptions,
} from '../../ports/speech'

export interface MediaStreamTrackLike {
  stop(): void
}

export interface MediaStreamLike {
  getTracks(): readonly MediaStreamTrackLike[]
}

export interface MediaRecorderLike {
  readonly mimeType: string
  readonly state: string
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: ((event: { error?: unknown }) => void) | null
  start(): void
  stop(): void
}

export interface MediaRecorderAdapterDependencies {
  /** Pass null to explicitly disable browser auto-detection (useful in tests). */
  getUserMedia?: (() => Promise<MediaStreamLike>) | null
  createRecorder?:
    | ((
        stream: MediaStreamLike,
        options: RecordingOptions,
      ) => MediaRecorderLike)
    | null
  isTypeSupported?: ((mimeType: string) => boolean) | null
  now?: () => number
}

const preferredMimeTypes = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
]

function browserDependencies(): MediaRecorderAdapterDependencies {
  const browser = globalThis as typeof globalThis & {
    MediaRecorder?: typeof MediaRecorder
    navigator?: Navigator
  }
  const Recorder = browser.MediaRecorder
  const mediaDevices = browser.navigator?.mediaDevices

  if (!Recorder || !mediaDevices?.getUserMedia) {
    return {}
  }

  return {
    getUserMedia: async () =>
      await mediaDevices.getUserMedia({ audio: true }),
    createRecorder: (stream, options) => {
      const nativeOptions: MediaRecorderOptions = {}
      if (options.mimeType) {
        nativeOptions.mimeType = options.mimeType
      }
      if (options.audioBitsPerSecond !== undefined) {
        nativeOptions.audioBitsPerSecond = options.audioBitsPerSecond
      }
      return new Recorder(
        stream as unknown as MediaStream,
        nativeOptions,
      ) as unknown as MediaRecorderLike
    },
    isTypeSupported: (mimeType) => Recorder.isTypeSupported(mimeType),
  }
}

export class MediaRecorderAdapter implements AudioRecorder {
  private readonly getUserMedia: (() => Promise<MediaStreamLike>) | undefined
  private readonly createRecorder:
    | ((stream: MediaStreamLike, options: RecordingOptions) => MediaRecorderLike)
    | undefined
  private readonly isTypeSupported: ((mimeType: string) => boolean) | undefined
  private readonly now: () => number

  private currentState: RecorderState = 'idle'
  private recorder: MediaRecorderLike | null = null
  private stream: MediaStreamLike | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private selectedMimeType = ''
  private stopPromise: Promise<AudioRecording> | null = null
  private resolveStop: ((recording: AudioRecording) => void) | null = null
  private rejectStop: ((reason: unknown) => void) | null = null

  constructor(dependencies: MediaRecorderAdapterDependencies = {}) {
    const browser = browserDependencies()
    const configuredGetUserMedia = dependencies.getUserMedia
    const configuredRecorderFactory = dependencies.createRecorder
    const configuredTypeSupport = dependencies.isTypeSupported
    this.getUserMedia =
      configuredGetUserMedia === null
        ? undefined
        : (configuredGetUserMedia ?? browser.getUserMedia ?? undefined)
    this.createRecorder =
      configuredRecorderFactory === null
        ? undefined
        : (configuredRecorderFactory ?? browser.createRecorder ?? undefined)
    this.isTypeSupported =
      configuredTypeSupport === null
        ? undefined
        : (configuredTypeSupport ?? browser.isTypeSupported ?? undefined)
    this.now = dependencies.now ?? Date.now
  }

  get state(): RecorderState {
    return this.currentState
  }

  isAvailable(): boolean {
    return Boolean(this.getUserMedia && this.createRecorder)
  }

  async start(options: RecordingOptions = {}): Promise<void> {
    if (this.currentState !== 'idle') {
      throw new Error('A recording is already active')
    }
    if (!this.getUserMedia || !this.createRecorder) {
      throw new SpeechCapabilityUnavailableError(
        'recording',
        'Microphone recording is unavailable on this device',
      )
    }

    const selectedMimeType = this.selectMimeType(options.mimeType)
    const recorderOptions: RecordingOptions = {}
    if (selectedMimeType) {
      recorderOptions.mimeType = selectedMimeType
    }
    if (options.audioBitsPerSecond !== undefined) {
      recorderOptions.audioBitsPerSecond = options.audioBitsPerSecond
    }

    const stream = await this.getUserMedia()
    try {
      const recorder = this.createRecorder(stream, recorderOptions)
      this.stream = stream
      this.recorder = recorder
      this.chunks = []
      this.selectedMimeType = recorder.mimeType || selectedMimeType
      this.startedAt = this.now()

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data)
        }
      }
      recorder.onstop = () => {
        this.finalizeRecording()
      }
      recorder.onerror = (event) => {
        this.failRecording(event.error ?? new Error('MediaRecorder failed'))
      }

      recorder.start()
      this.currentState = 'recording'
    } catch (error) {
      this.reset(stream)
      throw error
    }
  }

  stop(): Promise<AudioRecording> {
    if (this.stopPromise) {
      return this.stopPromise
    }
    if (this.currentState !== 'recording' || !this.recorder) {
      return Promise.reject(new Error('No recording is active'))
    }

    this.currentState = 'stopping'
    this.stopPromise = new Promise<AudioRecording>((resolve, reject) => {
      this.resolveStop = resolve
      this.rejectStop = reject
    })
    const stopPromise = this.stopPromise

    try {
      this.recorder.stop()
    } catch (error) {
      this.failRecording(error)
    }

    return stopPromise
  }

  async cancel(): Promise<void> {
    if (this.currentState === 'idle') {
      return
    }
    await this.stop()
  }

  private selectMimeType(requested?: string): string {
    if (requested) {
      if (this.isTypeSupported && !this.isTypeSupported(requested)) {
        throw new TypeError(`Unsupported recording MIME type: ${requested}`)
      }
      return requested
    }

    return (
      preferredMimeTypes.find(
        (mimeType) => !this.isTypeSupported || this.isTypeSupported(mimeType),
      ) ?? ''
    )
  }

  private finalizeRecording(): void {
    const recorder = this.recorder
    const stream = this.stream
    const resolve = this.resolveStop
    const endedAt = this.now()
    const mimeType = recorder?.mimeType || this.selectedMimeType || 'audio/webm'
    const recording: AudioRecording = {
      blob: new Blob(this.chunks, { type: mimeType }),
      mimeType,
      durationMs: Math.max(0, endedAt - this.startedAt),
      startedAt: this.startedAt,
      endedAt,
    }

    this.reset(stream)
    resolve?.(recording)
  }

  private failRecording(error: unknown): void {
    const stream = this.stream
    const reject = this.rejectStop
    this.reset(stream)
    reject?.(error)
  }

  private reset(stream: MediaStreamLike | null): void {
    if (this.recorder) {
      this.recorder.ondataavailable = null
      this.recorder.onstop = null
      this.recorder.onerror = null
    }
    stream?.getTracks().forEach((track) => {
      track.stop()
    })
    this.currentState = 'idle'
    this.recorder = null
    this.stream = null
    this.chunks = []
    this.startedAt = 0
    this.selectedMimeType = ''
    this.stopPromise = null
    this.resolveStop = null
    this.rejectStop = null
  }
}
