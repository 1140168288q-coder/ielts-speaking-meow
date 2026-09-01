import { z } from 'zod'
import {
  aiFeedbackSchema,
  importQuestionCandidateListSchema,
  materialSuggestionListSchema,
  secondAttemptAnalysisSchema,
  type AiFeedback,
  type ImportQuestionCandidate,
  type MaterialSuggestion,
} from '../../domain'
import type {
  LLMFeedbackRequest,
  LLMSecondAttemptRequest,
  LLMProvider,
  MaterialQuestionOrganizer,
  MaterialQuestionRequest,
  MaterialSuggestionRequest,
  MaterialSuggester,
} from '../../ports/ai'
import { ApiProviderError } from '../ai/providerErrors'
import type { BackendClient } from './backendClient'
import type { BackendHealthCache } from './backendHealth'

const TEXT_TIMEOUT_MS = 45_000

/**
 * Text AI 通过自建 Backend 调用(Backend 内部再调 DeepSeek)。
 * 客户端不接触 DeepSeek Key;提示词与输出校验分别在 Backend 与本端各做一次。
 * 配置状态由 BackendHealthCache 驱动,状态未知时保持乐观(失败时本地反馈兜底)。
 */
export class BackendTextProvider
  implements LLMProvider, MaterialQuestionOrganizer, MaterialSuggester
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
    const data = await this.client.postJson<unknown>(
      '/v1/feedback',
      {
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
      },
      TEXT_TIMEOUT_MS,
    )
    return parseValidated(
      data,
      aiFeedbackSchema,
      'Text AI 返回结构不完整,已保留本地结果。',
    )
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
    const data = await this.client.postJson<unknown>(
      '/v1/feedback/second-attempt',
      {
        part: request.question.part,
        question,
        answer: request.answer,
      },
      TEXT_TIMEOUT_MS,
    )
    return parseValidated(
      data,
      secondAttemptAnalysisSchema,
      '第二次回答分析结果不完整,已保留你的答案。',
    )
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
}

const organizeResponseSchema = z.object({
  questions: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
})

const materialSuggestResponseSchema = z.object({
  suggestions: materialSuggestionListSchema,
})

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
