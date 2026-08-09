import type {
  AiFeedback,
  AttemptComparison,
  Question,
  SpeechMetrics,
} from '../domain/models'

export interface LLMFeedbackRequest {
  question: Question
  transcript: string
  metrics: SpeechMetrics
}

export interface LLMComparisonRequest {
  question: Question
  firstTranscript: string
  secondTranscript: string
  localComparison: AttemptComparison
}

/**
 * Text AI boundary. Implementations must runtime-validate vendor responses
 * before returning them from this interface.
 */
export interface LLMProvider {
  readonly id: string
  isConfigured(): boolean
  getFeedback(request: LLMFeedbackRequest): Promise<AiFeedback>
  compareAttempts(request: LLMComparisonRequest): Promise<AiFeedback>
}

/** Reserved for future acoustic evidence. V1 does not provide pronunciation scores. */
export interface PronunciationProvider {
  readonly id: string
  isConfigured(): boolean
}

export type SecretName =
  | 'text-ai-api-key'
  | 'voice-ai-api-key'
  | 'stt-api-key'

/** Sensitive credentials never belong in LocalStorage or normal logs. */
export interface SecureSecretStorage {
  get(name: SecretName): Promise<string | null>
  set(name: SecretName, value: string): Promise<void>
  remove(name: SecretName): Promise<void>
}

export interface TextAIConfiguration {
  provider: string
  endpoint: string
  model: string
}

export interface VoiceAIConfiguration {
  provider: string
  endpoint: string
  model: string
  voice: string
}

export interface STTConfiguration {
  provider: string
  endpoint: string
  model: string
}
