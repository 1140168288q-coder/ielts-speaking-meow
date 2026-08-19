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
  /**
   * 本地 RAG 检索出的 IELTS 教学原则(不含用户答案)。
   * 客户端只负责检索,第三方调用仍全部经由自建 Backend。
   */
  tutorContext?: string
  /**
   * 用户长期记忆聚合:练过次数、近期重点、可复用素材。
   * 长度有限,且只包含用户已经保存在本机的数据。
   */
  learnerContext?: string
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
