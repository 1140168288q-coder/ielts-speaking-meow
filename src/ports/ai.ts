import type {
  AiFeedback,
  Question,
  SecondAttemptAnalysis,
} from '../domain/models'
import type { ImportQuestionCandidate } from '../domain/imports'
import type { MaterialSuggestion } from '../domain/personalMaterials'

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

export interface LLMSecondAttemptRequest {
  question: Question
  answer: string
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
  getSecondAttemptAnalysis?: (
    request: LLMSecondAttemptRequest,
  ) => Promise<SecondAttemptAnalysis>
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

/** 一条候选个人素材;确认前不落盘、不进入任何 AI 上下文。 */
export type MaterialSuggestionPayload = MaterialSuggestion

export interface MaterialSuggestionRequest {
  /** 本地聚合的练习轨迹摘要(≤1900 字符),只含本机已持久化数据。 */
  memoryDigest: string
  /** 已有素材标题,用于让 AI 避免重复提炼。 */
  existingTitles: string[]
  maxCount?: number
  targetPart?: 1 | 2 | 3
}

/**
 * Optional Text AI helper. 从练习记忆与个人语料中归纳"可能值得保存的生活素材",
 * 结果必须经用户逐条确认后才会写入素材库。
 */
export interface MaterialSuggester {
  isConfigured(): boolean
  suggestMaterials(
    request: MaterialSuggestionRequest,
  ): Promise<MaterialSuggestionPayload[]>
}
