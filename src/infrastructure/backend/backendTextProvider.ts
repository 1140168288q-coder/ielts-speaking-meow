import { z } from 'zod'
import {
  aiFeedbackSchema,
  importQuestionCandidateListSchema,
  type AiFeedback,
  type ImportQuestionCandidate,
} from '../../domain'
import type {
  LLMComparisonRequest,
  LLMFeedbackRequest,
  LLMProvider,
  MaterialQuestionOrganizer,
  MaterialQuestionRequest,
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
export class BackendTextProvider implements LLMProvider, MaterialQuestionOrganizer {
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
    const data = await this.client.postJson<unknown>(
      '/v1/feedback',
      {
        kind: 'first-attempt',
        question: request.question,
        transcript: request.transcript,
        metrics: request.metrics,
      },
      TEXT_TIMEOUT_MS,
    )
    return parseValidated(data, aiFeedbackSchema, 'Text AI 返回结构不完整,已保留本地结果。')
  }

  async compareAttempts(request: LLMComparisonRequest): Promise<AiFeedback> {
    const data = await this.client.postJson<unknown>(
      '/v1/feedback',
      {
        kind: 'comparison',
        question: request.question,
        firstTranscript: request.firstTranscript,
        secondTranscript: request.secondTranscript,
        localComparison: request.localComparison,
      },
      TEXT_TIMEOUT_MS,
    )
    return parseValidated(data, aiFeedbackSchema, 'Text AI 返回结构不完整,已保留本地结果。')
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
}

const organizeResponseSchema = z.object({
  questions: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
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
