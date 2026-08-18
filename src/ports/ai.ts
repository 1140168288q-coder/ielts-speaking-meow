import type { AiFeedback, Question } from '../domain/models'
import type { ImportQuestionCandidate } from '../domain/imports'

/**
 * DeepSeek 只分析用户提交的答案文本。answerDurationSeconds 是用户主动
 * 使用计时器得到的参考作答时长,可为 null;服务端不会据此评价语速。
 */
export interface LLMFeedbackRequest {
  question: Question
  answer: string
  answerDurationSeconds: number | null
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
