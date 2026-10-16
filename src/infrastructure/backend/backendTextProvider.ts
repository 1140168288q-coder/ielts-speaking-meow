import { z } from 'zod'
import {
  aiFeedbackSchema,
  feedbackContextReferencesAreValid,
  importQuestionCandidateListSchema,
  materialSuggestionListSchema,
  secondAttemptAnalysisSchema,
  type AiFeedback,
  type ImportQuestionCandidate,
  type MaterialSuggestion,
} from '../../domain'
import {
  userKnowledgeFunctionSchema,
} from '../../domain/userKnowledge'
import type {
  LLMFeedbackRequest,
  LLMSecondAttemptRequest,
  LLMProvider,
  MaterialQuestionOrganizer,
  MaterialQuestionRequest,
  MaterialSuggestionRequest,
  MaterialSuggester,
  UserKnowledgeOrganizer,
  UserKnowledgeOrganizeRequest,
  UserKnowledgeCandidate,
} from '../../ports/ai'
import { ApiProviderError } from '../ai/providerErrors'
import type { BackendClient, BackendPostOptions } from './backendClient'
import type { BackendHealthCache } from './backendHealth'

// Backend's 90s total budget must settle before the mobile/browser transport.
const TEXT_TIMEOUT_MS = 105_000

/**
 * Text AI 通过自建 Backend 调用(Backend 内部再调 DeepSeek)。
 * 客户端不接触 DeepSeek Key;提示词与输出校验分别在 Backend 与本端各做一次。
 * 配置状态由 BackendHealthCache 驱动,状态未知时保持乐观(失败时本地反馈兜底)。
 */
export class BackendTextProvider
  implements LLMProvider, MaterialQuestionOrganizer, MaterialSuggester, UserKnowledgeOrganizer
{
  readonly id = 'backend-text'

  constructor(
    private readonly client: BackendClient,
    private readonly health?: BackendHealthCache,
  ) {}

  isConfigured(): boolean {
    return this.health
      ? this.health.statusOf('deepseek') !== 'unconfigured'
      : true
  }

  async getFeedback(request: LLMFeedbackRequest): Promise<AiFeedback> {
    const question = {
      part: request.question.part,
      topic: request.question.topic,
      prompt: request.question.prompt,
      ...('cuePoints' in request.question
        ? { cuePoints: request.question.cuePoints }
        : {}),
      ...(request.question.isNew !== undefined
        ? { isNew: request.question.isNew }
        : {}),
      ...(request.question.category !== undefined
        ? { category: request.question.category }
        : {}),
    }
    const body = {
      part: request.question.part,
      question,
      answer: request.answer,
      answerDurationSeconds: request.answerDurationSeconds,
      ...(request.tutorContext
        ? { tutorContext: request.tutorContext }
        : {}),
      ...(request.learnerContext
        ? { learnerContext: request.learnerContext }
        : {}),
      ...(request.userKnowledgeContext
        ? { userKnowledgeContext: request.userKnowledgeContext }
        : {}),
      ...(request.naturalUpgradeLevel
        ? { naturalUpgradeLevel: request.naturalUpgradeLevel }
        : {}),
      ...(request.spokenEnglishStyle
        ? { spokenEnglishStyle: request.spokenEnglishStyle }
        : {}),
    }
    const options = postOptions(request.idempotencyKey)
    try {
      const data = options
        ? await this.client.postJson<unknown>('/v1/feedback', body, TEXT_TIMEOUT_MS, options)
        : await this.client.postJson<unknown>('/v1/feedback', body, TEXT_TIMEOUT_MS)
      const validated = parseValidated(
        data,
        aiFeedbackSchema,
        'Text AI 返回结构不完整,已保留本地结果。',
      )
      if (!feedbackContextReferencesAreValid(validated, [
        request.tutorContext,
        request.learnerContext,
        request.userKnowledgeContext,
      ])) {
        throw new ApiProviderError(
          'invalid-response',
          'Text AI 返回了未提供的来源,已保留本地结果。',
          true,
        )
      }
      return validated
    } finally {
      await this.refreshHealth()
    }
  }

  async getSecondAttemptAnalysis(request: LLMSecondAttemptRequest) {
    const question = {
      part: request.question.part,
      topic: request.question.topic,
      prompt: request.question.prompt,
      ...('cuePoints' in request.question
        ? { cuePoints: request.question.cuePoints }
        : {}),
    }
    const body = {
      part: request.question.part,
      question,
      answer: request.answer,
    }
    const options = postOptions(request.idempotencyKey)
    try {
      const data = options
        ? await this.client.postJson<unknown>(
          '/v1/feedback/second-attempt',
          body,
          TEXT_TIMEOUT_MS,
          options,
        )
        : await this.client.postJson<unknown>(
          '/v1/feedback/second-attempt',
          body,
          TEXT_TIMEOUT_MS,
        )
      return parseValidated(
        data,
        secondAttemptAnalysisSchema,
        '第二次回答分析结果不完整,已保留你的答案。',
      )
    } finally {
      await this.refreshHealth()
    }
  }

  async extractQuestions(
    request: MaterialQuestionRequest,
  ): Promise<ImportQuestionCandidate[]> {
    const data = await this.client.postJson<unknown>(
      '/v1/organize',
      {
        fileName: request.fileName,
        extractedText: request.extractedText,
      },
      TEXT_TIMEOUT_MS,
    )
    const envelope = parseValidated(
      data,
      organizeResponseSchema,
      'Text AI 整理结果不完整,请重试。',
    )
    const withIds = envelope.questions.map((question, index) => ({
      id: `ai-candidate-${index + 1}`,
      ...question,
    }))
    return importQuestionCandidateListSchema.parse(withIds)
  }

  async suggestMaterials(
    request: MaterialSuggestionRequest,
  ): Promise<MaterialSuggestion[]> {
    const data = await this.client.postJson<unknown>(
      '/v1/materials/suggest',
      {
        memoryDigest: request.memoryDigest,
        existingTitles: request.existingTitles.slice(0, 50),
        maxCount: request.maxCount ?? 4,
        ...(request.targetPart === undefined
          ? {}
          : { targetPart: request.targetPart }),
      },
      TEXT_TIMEOUT_MS,
    )
    const envelope = parseValidated(
      data,
      materialSuggestResponseSchema,
      'AI 提炼结果不完整,请重试。',
    )
    return envelope.suggestions
  }

  async organizeKnowledge(
    request: UserKnowledgeOrganizeRequest,
  ): Promise<UserKnowledgeCandidate[]> {
    const body = {
      fileName: request.fileName,
      sourceHash: request.sourceHash,
      chunks: request.chunks.slice(0, 24).map((chunk) => ({
        index: chunk.index,
        pageNumber: chunk.pageNumber,
        section: chunk.section,
        text: chunk.text.slice(0, 2_400),
      })),
    }
    const options = postOptions(request.idempotencyKey)
    const data = options
      ? await this.client.postJson<unknown>('/v1/knowledge/organize', body, TEXT_TIMEOUT_MS, options)
      : await this.client.postJson<unknown>('/v1/knowledge/organize', body, TEXT_TIMEOUT_MS)
    const envelope = parseValidated(
      data,
      knowledgeOrganizeResponseSchema,
      '知识库整理结果不完整，请重试。',
    )
    return envelope.entries
  }

  private async refreshHealth(): Promise<void> {
    if (this.health) {
      await this.health.refresh()
    }
  }
}

function postOptions(idempotencyKey: string | undefined): BackendPostOptions | undefined {
  return idempotencyKey
    ? { idempotencyKey, retry: true }
    : undefined
}

const organizeResponseSchema = z.object({
  questions: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
})

const materialSuggestResponseSchema = z.object({
  suggestions: materialSuggestionListSchema,
})

const knowledgeCandidateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(2_000),
  originalExcerpt: z.string().trim().min(1).max(1_000),
  sourcePage: z.number().int().positive().nullable(),
  sourceSection: z.string().trim().max(240).nullable(),
  part: z.union([z.literal('all'), z.literal(1), z.literal(2), z.literal(3)]),
  topics: z.array(z.string().trim().min(1).max(80)).max(20),
  keywords: z.array(z.string().trim().min(1).max(80)).max(40),
  tags: z.array(z.string().trim().min(1).max(80)).max(20),
  functions: z.array(userKnowledgeFunctionSchema).min(1).max(8),
  level: z.enum(['basic', 'developing', 'stretch']),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict()

const knowledgeOrganizeResponseSchema = z.object({
  entries: z.array(knowledgeCandidateSchema).min(1).max(60),
}).strict()

function parseValidated<T>(
  data: unknown,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  failureMessage: string,
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new ApiProviderError('invalid-response', failureMessage, true)
  }
  return result.data
}
