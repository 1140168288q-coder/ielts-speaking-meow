import { aiFeedbackSchema, type AiFeedback } from '../../domain/models'
import type {
  LLMComparisonRequest,
  LLMFeedbackRequest,
  LLMProvider,
} from '../../ports/ai'

export interface RawLLMProvider {
  readonly id: string
  isConfigured(): boolean
  getFeedback(request: LLMFeedbackRequest): Promise<unknown>
  compareAttempts(request: LLMComparisonRequest): Promise<unknown>
}

/** Contains vendor-specific shapes at the edge and rejects invalid AI output. */
export class ValidatedLLMProvider implements LLMProvider {
  readonly id: string

  constructor(private readonly rawProvider: RawLLMProvider) {
    this.id = rawProvider.id
  }

  isConfigured(): boolean {
    return this.rawProvider.isConfigured()
  }

  async getFeedback(request: LLMFeedbackRequest): Promise<AiFeedback> {
    const response = await this.rawProvider.getFeedback(request)
    return aiFeedbackSchema.parse(response)
  }

  async compareAttempts(request: LLMComparisonRequest): Promise<AiFeedback> {
    const response = await this.rawProvider.compareAttempts(request)
    return aiFeedbackSchema.parse(response)
  }
}
