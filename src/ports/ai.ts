import type {
  AiFeedback,
  AttemptComparison,
  Question,
  SpeechMetrics,
} from '../domain/models'
import type { ImportQuestionCandidate } from '../domain/imports'

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
 * before returning them from this interface. 密钥只在自建 Backend 侧,
 * 客户端实现(BackendTextProvider)不接触任何第三方凭证。
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
