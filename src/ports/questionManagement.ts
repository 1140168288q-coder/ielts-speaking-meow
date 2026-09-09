import type {
  QuestionBankExclusion,
  QuestionExclusion,
} from '../domain/questionManagement'

export interface QuestionManagementStorage {
  listQuestionExclusions(ownerId: string, options?: { includeDeleted?: boolean }): Promise<QuestionExclusion[]>
  listQuestionBankExclusions(ownerId: string, options?: { includeDeleted?: boolean }): Promise<QuestionBankExclusion[]>
  saveQuestionExclusion(exclusion: QuestionExclusion): Promise<void>
  saveQuestionExclusions?(exclusions: QuestionExclusion[]): Promise<void>
  saveQuestionBankExclusion(exclusion: QuestionBankExclusion): Promise<void>
  /** Atomically apply a clear-all state and its per-imported-question exclusions. */
  saveQuestionBankState?(
    bankExclusion: QuestionBankExclusion,
    questionExclusions: QuestionExclusion[],
  ): Promise<void>
}
