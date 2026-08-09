export type SpeechCapability = 'tts' | 'stt' | 'recording'

export class SpeechCapabilityUnavailableError extends Error {
  readonly capability: SpeechCapability

  constructor(capability: SpeechCapability, message?: string) {
    super(message ?? `${capability.toUpperCase()} is not available on this device`)
    this.name = 'SpeechCapabilityUnavailableError'
    this.capability = capability
  }
}

export interface TTSRequest {
  text: string
  language?: string
  voice?: string
  rate?: number
  pitch?: number
  style?: string
}

export interface TTSCapabilities {
  language: boolean
  voice: boolean
  rate: boolean
  pitch: boolean
  style: boolean
}

/**
 * A provider owns one TTS playback at a time. `speak` resolves when playback
 * finishes or is deliberately stopped, and rejects only for a real failure.
 */
export interface TTSProvider {
  readonly id: string
  readonly capabilities: TTSCapabilities
  isAvailable(): boolean
  speak(request: TTSRequest): Promise<void>
  stop(): Promise<void>
}

export interface STTRequest {
  language?: string
  continuous?: boolean
  interimResults?: boolean
}

export interface STTResult {
  transcript: string
  isFinal: boolean
  confidence?: number
}

export type STTErrorCode =
  | 'aborted'
  | 'audio-capture'
  | 'network'
  | 'no-speech'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'unknown'

export class STTError extends Error {
  readonly code: STTErrorCode
  readonly retryable: boolean

  constructor(code: STTErrorCode, message: string, retryable = true) {
    super(message)
    this.name = 'STTError'
    this.code = code
    this.retryable = retryable
  }
}

export interface STTListener {
  onResult(result: STTResult): void
  onError?(error: STTError): void
  onEnd?(): void
}

export interface STTSession {
  stop(): Promise<void>
  abort(): Promise<void>
}

/** Live transcription capability. The original audio is owned separately. */
export interface STTProvider {
  readonly id: string
  isAvailable(): boolean
  start(request: STTRequest, listener: STTListener): Promise<STTSession>
}

export interface RecordedAudioSTTRequest {
  audio: Blob
  mimeType: string
  fileName: string
  language?: string
}

/** Remote/file STT runs only after the original recording has been saved. */
export interface RecordedAudioSTTProvider {
  readonly id: string
  isConfigured(): boolean
  transcribe(request: RecordedAudioSTTRequest): Promise<string>
}

export interface AudioRecording {
  blob: Blob
  mimeType: string
  durationMs: number
  startedAt: number
  endedAt: number
}

export interface RecordingOptions {
  mimeType?: string
  audioBitsPerSecond?: number
}

export type RecorderState = 'idle' | 'recording' | 'stopping'

/** Captures audio only; persisting the returned original blob is a separate port. */
export interface AudioRecorder {
  readonly state: RecorderState
  isAvailable(): boolean
  start(options?: RecordingOptions): Promise<void>
  stop(): Promise<AudioRecording>
  cancel(): Promise<void>
}

/** Playback of an already saved answer. */
export interface RecordingPlayback {
  play(source: string): Promise<void>
  stop(): Promise<void>
}

export type AudioFocusState = 'idle' | 'tts' | 'recording-playback' | 'recording'
export type AudioFocusListener = (state: AudioFocusState) => void

export class AudioFocusConflictError extends Error {
  constructor(message = 'Playback is not allowed while recording') {
    super(message)
    this.name = 'AudioFocusConflictError'
  }
}

/**
 * The UI-facing audio boundary. Implementations enforce a single active audio
 * activity so a question can never be played into the user's recording.
 */
export interface AudioFocus {
  readonly state: AudioFocusState
  subscribe(listener: AudioFocusListener): () => void
  speak(request: TTSRequest): Promise<void>
  stopTTS(): Promise<void>
  playRecording(source: string): Promise<void>
  stopRecordingPlayback(): Promise<void>
  startRecording(options?: RecordingOptions): Promise<void>
  stopRecording(): Promise<AudioRecording>
  cancelRecording(): Promise<void>
  stopAllPlayback(): Promise<void>
}
