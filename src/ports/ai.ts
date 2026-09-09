import type {
  AiFeedback,
  Question,
  SecondAttemptAnalysis,
} from '../domain/models'
import type { ImportQuestionCandidate } from '../domain/imports'
import type { MaterialSuggestion } from '../domain/personalMaterials'
import type {
  NaturalUpgradeLevel,
  SpokenEnglishStyle,
} from '../domain/feedbackGeneration'
import type { UserKnowledgeFunction } from '../domain/userKnowledge'

/**
 * DeepSeek 只分析用户提交的答案文本。answerDurationSeconds 是用户主动
 * 使用计时器得到的参考作答时长,可为 null;服务端不会据此评价语速。
 */
export interface LLMFeedbackRequest {
  question: Question
  answer: string
  answerDurationSeconds: number | null
  /**
   * 同一次逻辑分析在自动/手动重试间复用的稳定标识。只用于 Backend
   * 额度幂等，不包含答案正文。
   */
  idempotencyKey?: string
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
  /** 当前账号已确认且启用的个人知识库检索结果。 */
  userKnowledgeContext?: string
  /** 自然提升版生成难度；缺省时 Provider 使用用户默认值。 */
  naturalUpgradeLevel?: NaturalUpgradeLevel
  /** 英式/美式自然口语风格。 */
  spokenEnglishStyle?: SpokenEnglishStyle
}

export interface LLMSecondAttemptRequest {
  question: Question
  answer: string
  /** 同一次二答分析重试复用的稳定额度幂等标识。 */
  idempotencyKey?: string
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

export interface UserKnowledgeChunk {
  index: number
  pageNumber: number | null
  section: string | null
  text: string
}

export interface UserKnowledgeOrganizeRequest {
  fileName: string
  sourceHash: string
  chunks: UserKnowledgeChunk[]
  idempotencyKey?: string
}

export interface UserKnowledgeCandidate {
  title: string
  body: string
  originalExcerpt: string
  sourcePage: number | null
  sourceSection: string | null
  part: 'all' | 1 | 2 | 3
  topics: string[]
  keywords: string[]
  tags: string[]
  functions: UserKnowledgeFunction[]
  level: 'basic' | 'developing' | 'stretch'
  confidence: 'high' | 'medium' | 'low'
}

/** Optional Text AI helper for turning a confirmed local extraction into private RAG entries. */
export interface UserKnowledgeOrganizer {
  isConfigured(): boolean
  organizeKnowledge(
    request: UserKnowledgeOrganizeRequest,
  ): Promise<UserKnowledgeCandidate[]>
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
