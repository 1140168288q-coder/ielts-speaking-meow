import { z } from 'zod'
import type { Question } from './models'
import { isoDateTimeSchema } from './models'

const questionSourceSchema = z.enum(['built-in', 'imported'])
const exclusionReasonSchema = z.enum(['single', 'multi-select', 'category', 'clear-all'])

export const questionExclusionSchema = z.object({
  id: z.string().trim().min(1).max(240),
  ownerId: z.string().trim().min(1).max(120),
  questionId: z.string().trim().min(1).max(160),
  questionSource: questionSourceSchema,
  reason: exclusionReasonSchema,
  createdAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
}).strict()

export const questionBankExclusionSchema = z.object({
  id: z.string().trim().min(1).max(240),
  ownerId: z.string().trim().min(1).max(120),
  bankFingerprint: z.string().trim().min(8).max(160),
  seasonLabel: z.string().trim().min(1).max(120),
  createdAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
}).strict()

export type QuestionExclusion = z.infer<typeof questionExclusionSchema>
export type QuestionBankExclusion = z.infer<typeof questionBankExclusionSchema>

export function questionExclusionId(ownerId: string, questionId: string): string {
  return `question-exclusion:${ownerId}:${questionId}`
}

export function questionBankExclusionId(ownerId: string, fingerprint: string): string {
  return `question-bank-exclusion:${ownerId}:${fingerprint}`
}

/** Deterministic fingerprint of the packaged question bank; changes when its generated content changes. */
export function questionBankFingerprint(questions: readonly Question[]): string {
  const identity = questions
    .map((question) => `${question.id}\u0000${question.part}\u0000${question.prompt}`)
    .sort()
    .join('\u0001')
  let hash = 2166136261
  for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return `question-bank-${(hash >>> 0).toString(16).padStart(8, '0')}-${questions.length}`
}

export function isBuiltInQuestion(question: Question): boolean {
  return !question.id.includes('-import-')
}

export function filterVisibleQuestions(
  questions: readonly Question[],
  exclusions: readonly QuestionExclusion[],
  bankExclusions: readonly QuestionBankExclusion[],
  fingerprint: string,
): Question[] {
  const hidden = new Set(
    exclusions
      .filter((item) => item.deletedAt === null)
      .map((item) => item.questionId),
  )
  const bankHidden = bankExclusions.some(
    (item) => item.bankFingerprint === fingerprint && item.deletedAt === null,
  )
  return questions.filter((question) =>
    !hidden.has(question.id) && !(bankHidden && isBuiltInQuestion(question)),
  )
}
