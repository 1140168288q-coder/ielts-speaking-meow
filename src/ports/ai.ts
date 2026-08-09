import type {
  AiFeedback,
  AttemptComparison,
  Question,
  SpeechMetrics,
} from '../domain/models'
import type { ImportQuestionCandidate } from '../domain/imports'
import type {
  SttConfiguration,
  TextAiConfiguration,
  VoiceAiConfiguration,
} from '../domain/apiConfiguration'

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

export interface MaterialQuestionRequest {
  fileName: string
  extractedText: string
}

/** Optional Text AI helper. Calling it is an explicit user upload action. */
export interface MaterialQuestionOrganizer {
  isConfigured(): boolean
  extractQuestions(
    request: MaterialQuestionRequest,
  ): Promise<ImportQuestionCandidate[]>
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

export type TextAIConfiguration = TextAiConfiguration
export type VoiceAIConfiguration = VoiceAiConfiguration
export type STTConfiguration = SttConfiguration
