import { z } from 'zod'
import type { ApiConfigurationService } from '../../application/apiConfigurationService'
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
import type { ApiTransport } from './apiTransport'
import {
  ApiProviderError,
  assertSuccessfulStatus,
  mapTransportFailure,
} from './providerErrors'

const chatCompletionSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough()

const aiQuestionListSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            part: z.union([z.literal(1), z.literal(2), z.literal(3)]),
            topic: z.string().trim().min(1).max(80),
            prompt: z.string().trim().min(1).max(500),
            cuePoints: z.array(z.string().trim().min(1).max(160)).max(5),
            sourcePage: z.number().int().positive().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()

const TEXT_TIMEOUT_MS = 45_000
const MAX_AI_IMPORT_CHARACTERS = 60_000

export class OpenAICompatibleTextProvider
  implements LLMProvider, MaterialQuestionOrganizer
{
  readonly id = 'openai-compatible-text'

  constructor(
    private readonly settings: ApiConfigurationService,
    private readonly transport: ApiTransport,
  ) {}

  isConfigured(): boolean {
    return this.settings.getStatus('text-ai').configured
  }

  async getFeedback(request: LLMFeedbackRequest): Promise<AiFeedback> {
    const content = await this.completeJson(
      'You are a concise IELTS speaking coach. Return JSON only. Never give an IELTS band score or pronunciation score. Identify 1 to 3 high-impact, actionable issues. Prefer natural, speakable English and do not replace the learner with a full model answer.',
      JSON.stringify({
        task: 'feedback-after-first-attempt',
        requiredShape: {
          keyIssues: [
            {
              category: 'fluency | grammar | vocabulary | coherence',
              kind: 'focus | improvement | notice',
              title: 'short title',
              observation: 'what happened',
              action: 'one concrete action',
              evidence: 'short quote or null',
            },
          ],
          secondAttemptTips: ['maximum 3 short tips'],
          revisions: {
            minimalFix: 'string or null',
            naturalVersion: 'string or null',
            stretchVersion: 'string or null',
          },
        },
        question: request.question,
        transcript: request.transcript,
        localMetrics: request.metrics,
      }),
    )
    return parseValidatedJson(content, aiFeedbackSchema)
  }

  async compareAttempts(request: LLMComparisonRequest): Promise<AiFeedback> {
    const content = await this.completeJson(
      'You are a concise IELTS speaking coach comparing two attempts. Return JSON only. Use at most 3 evidence-based observations. If evidence is missing, say so. Never invent an IELTS band or pronunciation score.',
      JSON.stringify({
        task: 'compare-two-speaking-attempts',
        requiredShape: {
          keyIssues: [
            {
              category: 'fluency | grammar | vocabulary | coherence',
              kind: 'focus | improvement | notice',
              title: 'short title',
              observation: 'evidence-based comparison',
              action: 'one next action',
              evidence: 'short quote or null',
            },
          ],
          secondAttemptTips: [],
          revisions: {
            minimalFix: 'string or null',
            naturalVersion: 'string or null',
            stretchVersion: 'string or null',
          },
        },
        question: request.question,
        firstTranscript: request.firstTranscript,
        secondTranscript: request.secondTranscript,
        localComparison: request.localComparison,
      }),
    )
    return parseValidatedJson(content, aiFeedbackSchema)
  }

  async extractQuestions(
    request: MaterialQuestionRequest,
  ): Promise<ImportQuestionCandidate[]> {
    const content = await this.completeJson(
      'Extract IELTS Speaking questions from the supplied private material. Return JSON only. Do not generate answers. Keep original questions when present; when the material is prose, create only concise speaking questions grounded in it. Part 2 needs 2 to 5 cue points. Return at most 50 questions.',
      JSON.stringify({
        task: 'organize-imported-speaking-questions',
        requiredShape: {
          questions: [
            {
              part: '1 | 2 | 3 as a number',
              topic: 'short topic',
              prompt: 'question text',
              cuePoints: ['Part 2 only; otherwise empty'],
              sourcePage: 'page number or null',
            },
          ],
        },
        fileName: request.fileName,
        material: request.extractedText.slice(0, MAX_AI_IMPORT_CHARACTERS),
      }),
    )
    const parsed = parseValidatedJson(content, aiQuestionListSchema)
    return importQuestionCandidateListSchema.parse(
      parsed.questions.map((question, index) => ({
        id: `ai-candidate-${index + 1}`,
        ...question,
      })),
    )
  }

  async testConnection(): Promise<void> {
    const content = await this.completeJson(
      'Return JSON only.',
      JSON.stringify({ task: 'connection-check', requiredShape: { ok: true } }),
    )
    try {
      JSON.parse(
        content
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, ''),
      )
    } catch {
      throw new ApiProviderError(
        'invalid-response',
        '连接成功，但模型没有按要求返回 JSON。',
        false,
      )
    }
  }

  private async completeJson(system: string, user: string): Promise<string> {
    const status = this.settings.getStatus('text-ai')
    const configuration = status.configuration
    const key = await this.settings.getSecret('text-ai')
    if (
      !status.configured ||
      configuration?.id !== 'text-ai' ||
      key === null
    ) {
      throw new ApiProviderError('not-configured', 'Text AI 尚未配置。', false)
    }

    const response = await mapTransportFailure(() =>
      this.transport.postJson(
        joinEndpoint(configuration.endpoint, 'chat/completions'),
        key,
        {
          model: configuration.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
        TEXT_TIMEOUT_MS,
      ),
    )
    assertSuccessfulStatus(response.status)

    const completion = chatCompletionSchema.safeParse(response.data)
    const content = completion.success
      ? completion.data.choices[0]?.message.content
      : undefined
    if (content === undefined || content.trim().length === 0) {
      throw new ApiProviderError(
        'invalid-response',
        'Text AI 返回了无法识别的结果，可稍后重试或继续离线练习。',
        true,
      )
    }
    return content
  }
}

function parseValidatedJson<T>(
  content: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
): T {
  const jsonText = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let decoded: unknown
  try {
    decoded = JSON.parse(jsonText)
  } catch {
    throw new ApiProviderError(
      'invalid-response',
      'Text AI 返回的 JSON 无效，已保留本地结果。',
      true,
    )
  }

  const result = schema.safeParse(decoded)
  if (!result.success) {
    throw new ApiProviderError(
      'invalid-response',
      'Text AI 返回结构不完整，已保留本地结果。',
      true,
    )
  }
  return result.data
}

export function joinEndpoint(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
