import { z } from 'zod'

const nonEmptyText = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength)

export const isoDateTimeSchema = z.iso.datetime({ offset: true })

export const ieltsPartSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
])

export const questionDifficultySchema = z.enum([
  'foundation',
  'developing',
  'stretch',
])

const questionBaseSchema = z
  .object({
    id: z.string().regex(/^p[123]-[a-z0-9-]+$/),
    topic: nonEmptyText(80),
    prompt: nonEmptyText(500),
    difficulty: questionDifficultySchema.optional(),
    source: nonEmptyText(160).optional(),
  })
  .strict()

export const partOneQuestionSchema = questionBaseSchema.extend({
  part: z.literal(1),
})

export const partTwoQuestionSchema = questionBaseSchema.extend({
  part: z.literal(2),
  cuePoints: z.array(nonEmptyText(160)).min(2).max(5),
})

export const partThreeQuestionSchema = questionBaseSchema.extend({
  part: z.literal(3),
})

export const questionSchema = z.discriminatedUnion('part', [
  partOneQuestionSchema,
  partTwoQuestionSchema,
  partThreeQuestionSchema,
])

export const questionBankSchema = z
  .array(questionSchema)
  .min(3)
  .superRefine((questions, context) => {
    const ids = new Set<string>()

    for (const [index, question] of questions.entries()) {
      if (ids.has(question.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate question id: ${question.id}`,
          path: [index, 'id'],
        })
      }
      ids.add(question.id)
    }

    for (const part of [1, 2, 3] as const) {
      if (!questions.some((question) => question.part === part)) {
        context.addIssue({
          code: 'custom',
          message: `Question bank must include IELTS Speaking Part ${part}`,
        })
      }
    }
  })

export type IeltsPart = z.infer<typeof ieltsPartSchema>
export type QuestionDifficulty = z.infer<typeof questionDifficultySchema>
export type Question = z.infer<typeof questionSchema>

export const feedbackCategorySchema = z.enum([
  'fluency',
  'grammar',
  'vocabulary',
  'coherence',
])

export const feedbackKindSchema = z.enum(['focus', 'improvement', 'notice'])

export const actionableFeedbackSchema = z
  .object({
    category: feedbackCategorySchema,
    kind: feedbackKindSchema,
    title: nonEmptyText(100),
    observation: nonEmptyText(320),
    action: nonEmptyText(320),
    evidence: z.string().trim().max(240).nullable(),
  })
  .strict()

export const actionableFeedbackListSchema = z
  .array(actionableFeedbackSchema)
  .max(3)

export const answerRevisionSchema = z
  .object({
    minimalFix: z.string().trim().max(1_500).nullable(),
    naturalVersion: z.string().trim().max(1_500).nullable(),
    stretchVersion: z.string().trim().max(1_500).nullable(),
  })
  .strict()

/** 一行问题 + 一行建议的中文反馈摘要。 */
export const feedbackSummarySchema = z
  .object({
    problem: nonEmptyText(200),
    suggestion: nonEmptyText(200),
  })
  .strict()

/** AI 给出的一个可选回答版本(风格/难度略有差异)。 */
export const answerVersionOptionSchema = z
  .object({
    style: nonEmptyText(40),
    text: nonEmptyText(1_500),
    hint: nonEmptyText(500),
  })
  .strict()

/**
 * 跟读复盘中的一条疑似发音问题。仅来自 STT 转写与范本的逐词比对,
 * 不是发音评分或 ground truth。
 */
export const pronunciationIssueSchema = z
  .object({
    word: nonEmptyText(80),
    heardAs: z.string().trim().max(80).nullable(),
  })
  .strict()

export const aiFeedbackSchema = z
  .object({
    keyIssues: actionableFeedbackListSchema.optional(),
    secondAttemptTips: z.array(nonEmptyText(320)).max(3).optional(),
    revisions: answerRevisionSchema.optional(),
    summary: feedbackSummarySchema.optional(),
    versions: z.array(answerVersionOptionSchema).max(3).optional(),
  })
  .strict()

export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>
export type FeedbackKind = z.infer<typeof feedbackKindSchema>
export type ActionableFeedback = z.infer<typeof actionableFeedbackSchema>
export type AiFeedback = z.infer<typeof aiFeedbackSchema>
export type FeedbackSummary = z.infer<typeof feedbackSummarySchema>
export type AnswerVersionOption = z.infer<typeof answerVersionOptionSchema>
export type PronunciationIssue = z.infer<typeof pronunciationIssueSchema>
export type ReadAloudRecord = z.infer<typeof readAloudRecordSchema>

export const acousticSpeechMetricsSchema = z
  .object({
    analysisVersion: z.literal(1),
    analyzedDurationMs: z.number().finite().positive(),
    activeSpeechMs: z.number().finite().nonnegative(),
    silenceRatio: z.number().finite().min(0).max(1),
    pauseCount: z.number().int().nonnegative(),
    longPauseCount: z.number().int().nonnegative(),
    averagePauseMs: z.number().finite().nonnegative().nullable(),
  })
  .strict()

export type AcousticSpeechMetrics = z.infer<typeof acousticSpeechMetricsSchema>

export const fillerCountSchema = z
  .object({
    phrase: nonEmptyText(40),
    count: z.number().int().nonnegative(),
  })
  .strict()

export const repeatedWordSchema = z
  .object({
    word: nonEmptyText(80),
    count: z.number().int().positive(),
  })
  .strict()

export const speechMetricsSchema = z
  .object({
    durationMs: z.number().finite().nonnegative(),
    wordCount: z.number().int().nonnegative(),
    wordsPerMinute: z.number().finite().nonnegative().nullable(),
    fillerWords: z.array(fillerCountSchema),
    fillerCount: z.number().int().nonnegative(),
    repeatedWords: z.array(repeatedWordSchema),
    repeatedWordCount: z.number().int().nonnegative(),
    acoustic: acousticSpeechMetricsSchema.nullable().optional(),
    caveats: z.array(nonEmptyText(240)).max(5),
  })
  .strict()

export type SpeechMetrics = z.infer<typeof speechMetricsSchema>

export const transcriptSchema = z
  .object({
    status: z.enum(['pending', 'ready', 'failed']),
    text: z.string().max(10_000),
    originalText: z.string().max(10_000).nullable(),
    source: z.enum(['stt', 'manual', 'edited']).nullable(),
    errorCode: z.string().max(120).nullable(),
    updatedAt: isoDateTimeSchema,
  })
  .strict()

export const audioAssetSchema = z
  .object({
    id: nonEmptyText(120),
    relativePath: nonEmptyText(1_024),
    mimeType: nonEmptyText(120),
    durationMs: z.number().finite().positive(),
    createdAt: isoDateTimeSchema,
  })
  .strict()

export const practiceAttemptSchema = z
  .object({
    id: nonEmptyText(120),
    attemptNumber: z.union([z.literal(1), z.literal(2)]),
    audio: audioAssetSchema,
    transcript: transcriptSchema,
    metrics: speechMetricsSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()

export type Transcript = z.infer<typeof transcriptSchema>
export type AudioAsset = z.infer<typeof audioAssetSchema>
export type PracticeAttempt = z.infer<typeof practiceAttemptSchema>

export const readAloudRecordSchema = z
  .object({
    audio: audioAssetSchema,
    transcript: transcriptSchema,
    targetVersionIndex: z.number().int().min(0).max(2),
    issues: z.array(pronunciationIssueSchema).max(30),
  })
  .strict()

export const metricDeltaSchema = z
  .object({
    first: z.number().finite().nonnegative(),
    second: z.number().finite().nonnegative(),
    delta: z.number().finite(),
  })
  .strict()

export const attemptComparisonSchema = z
  .object({
    durationMs: metricDeltaSchema,
    wordsPerMinute: metricDeltaSchema.nullable(),
    fillerCount: metricDeltaSchema.nullable(),
    repeatedWordCount: metricDeltaSchema.nullable(),
    silenceRatio: metricDeltaSchema.nullable().optional(),
    longPauseCount: metricDeltaSchema.nullable().optional(),
    feedback: actionableFeedbackListSchema,
  })
  .strict()

export type MetricDelta = z.infer<typeof metricDeltaSchema>
export type AttemptComparison = z.infer<typeof attemptComparisonSchema>

export const trainingSessionStatusSchema = z.enum([
  'first-ready',
  'first-review',
  'feedback-ready',
  'second-ready',
  'comparison-ready',
  'completed',
])

export const trainingSessionSchema = z
  .object({
    id: nonEmptyText(120),
    questionId: nonEmptyText(120),
    status: trainingSessionStatusSchema,
    attempts: z.array(practiceAttemptSchema).max(2),
    localFeedback: actionableFeedbackListSchema,
    aiFeedback: aiFeedbackSchema.nullable(),
    aiComparison: aiFeedbackSchema.nullable().optional(),
    comparison: attemptComparisonSchema.nullable(),
    selectedVersionIndex: z.number().int().min(0).max(2).nullable().optional(),
    readAloud: readAloudRecordSchema.nullable().optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((session, context) => {
    const attemptNumbers = session.attempts.map(
      (attempt) => attempt.attemptNumber,
    )

    if (new Set(attemptNumbers).size !== attemptNumbers.length) {
      context.addIssue({
        code: 'custom',
        message: 'A training session cannot contain duplicate attempt numbers',
        path: ['attempts'],
      })
    }
  })

export type TrainingSessionStatus = z.infer<
  typeof trainingSessionStatusSchema
>
export type TrainingSession = z.infer<typeof trainingSessionSchema>

export const savedExpressionSchema = z
  .object({
    id: nonEmptyText(120),
    text: nonEmptyText(1_000),
    topic: nonEmptyText(80),
    questionId: nonEmptyText(120),
    sessionId: nonEmptyText(120),
    sourceAttempt: z.union([z.literal(1), z.literal(2)]).nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema.optional(),
    reviewCount: z.number().int().nonnegative().optional(),
    lastReviewedAt: isoDateTimeSchema.nullable().optional(),
  })
  .strict()

export type SavedExpression = z.infer<typeof savedExpressionSchema>

/** 练习页顶部三行自定义文字,任意一行均可留白。 */
export const practiceTextsSchema = z
  .object({
    top: z.string().trim().max(200),
    middle: z.string().trim().max(200),
    bottom: z.string().trim().max(200),
  })
  .strict()

export type PracticeTexts = z.infer<typeof practiceTextsSchema>

export const DEFAULT_PRACTICE_TEXTS: PracticeTexts = {
  top: '口语目标分：6.0',
  middle: '旅途的意义在于旅途本身',
  bottom: '请输入文本',
}
