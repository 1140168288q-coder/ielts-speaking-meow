import { z } from 'zod'

const nonEmptyText = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength)

/** 用户对某道公共题目的个人练习状态；不写回题库数据。 */
export const questionPracticeStateSchema = z
  .object({
    id: nonEmptyText(300),
    ownerId: nonEmptyText(120),
    questionId: nonEmptyText(120),
    isDone: z.boolean(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export type QuestionPracticeState = z.infer<typeof questionPracticeStateSchema>

export function questionPracticeStateId(ownerId: string, questionId: string): string {
  return `question-practice:${ownerId}:${questionId}`
}
