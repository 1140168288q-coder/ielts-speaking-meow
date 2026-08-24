import type { AcousticSpeechMetrics } from '../domain/models'

export type SpeechCapability = 'tts'

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

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused'

export interface PlaybackSnapshot {
  status: PlaybackStatus
  positionSeconds: number
  durationSeconds: number | null
  canPause: boolean
  canSeek: boolean
  providerId: string | null
}

export type PlaybackListener = (snapshot: PlaybackSnapshot) => void

/**
 * Capability-aware controls for prepared audio. Providers such as Android
 * System TTS may omit this boundary when they cannot expose reliable progress.
 */
export interface PlaybackController {
  readonly snapshot: PlaybackSnapshot
  subscribePlayback(listener: PlaybackListener): () => void
  pause(): Promise<boolean>
  resume(): Promise<boolean>
  seekTo(positionSeconds: number): Promise<boolean>
}

export const IDLE_PLAYBACK_SNAPSHOT: PlaybackSnapshot = {
  status: 'idle',
  positionSeconds: 0,
  durationSeconds: null,
  canPause: false,
  canSeek: false,
  providerId: null,
}

/**
 * A provider owns one TTS playback at a time. `speak` resolves when playback
 * finishes or is deliberately stopped, and rejects only for a real failure.
 */
export interface TTSProvider {
  readonly id: string
  readonly capabilities: TTSCapabilities
  readonly playbackController?: PlaybackController
  isAvailable(): boolean
  speak(request: TTSRequest): Promise<void>
  stop(): Promise<void>
}

/** 本机系统 TTS 的状态:引擎、英语语音包与实际可用性。 */
export interface SystemTtsStatus {
  available: boolean
  /** 当前默认引擎名(如 com.google.android.tts);未知时为 null。 */
  engine: string | null
  /** 已安装的引擎列表(名称 + 显示名)。 */
  engines: Array<{ name: string; label: string | null }>
  /** 是否检测到可用的英语语音包(决定 en-US 播报能否出声)。 */
  englishAvailable: boolean
}

/**
 * 本机系统 TTS(Android 或浏览器)。设置页的「测试系统朗读」必须直接
 * 调用它,不能走 AI 优先的 FallbackTTSProvider,否则测不出真实降级路径。
 */
export interface SystemTTSProvider extends TTSProvider {
  getStatus(): Promise<SystemTtsStatus>
}

export interface RecordedAudioAnalyzer {
  /**
   * Returns simple local timing evidence, never pronunciation or IELTS scores.
   * Unsupported/undecodable audio resolves to null so saving can continue.
   */
  analyze(audio: Blob): Promise<AcousticSpeechMetrics | null>
}

/** Playback of an answer recording saved by V1.6 or earlier. */
export interface RecordingPlayback {
  readonly playbackController?: PlaybackController
  play(source: string): Promise<void>
  stop(): Promise<void>
}

export type AudioFocusState = 'idle' | 'tts' | 'recording-playback'
export type AudioFocusListener = (state: AudioFocusState) => void

/**
 * The UI-facing audio boundary. Implementations enforce a single active audio
 * playback across TTS and V1.6-or-earlier saved recordings.
 */
export interface AudioFocus {
  readonly state: AudioFocusState
  readonly ttsPlayback?: PlaybackSnapshot
  subscribe(listener: AudioFocusListener): () => void
  subscribeTTSPlayback?(listener: PlaybackListener): () => void
  speak(request: TTSRequest): Promise<void>
  stopTTS(): Promise<void>
  pauseTTS?(): Promise<boolean>
  resumeTTS?(): Promise<boolean>
  seekTTS?(positionSeconds: number): Promise<boolean>
  playRecording(source: string): Promise<void>
  stopRecordingPlayback(): Promise<void>
  stopAllPlayback(): Promise<void>
}
