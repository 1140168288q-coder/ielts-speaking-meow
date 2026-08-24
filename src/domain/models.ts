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
    /**
     * 题库结构化元数据(内置季度题库生成器写入,导入题没有)。
     * - category: Part 1 的必考/高频分类;Part 2&3 的 PLACE/PEOPLE/
     *   OBJECTS/EVENTS。
     * - isNew: 当季新题;false 表示保留的旧题。
     */
    category: nonEmptyText(80).optional(),
    isNew: z.boolean().optional(),
  })
  .strict()

export const partOneQuestionSchema = questionBaseSchema.extend({
  part: z.literal(1),
})

export const partTwoQuestionSchema = questionBaseSchema.extend({
  part: z.literal(2),
  cuePoints: z.array(nonEmptyText(160)).min(2).max(6),
  /** 同一张 cue card 对应的 Part 3 跟进题 id(按题库原顺序)。 */
  relatedPart3Ids: z
    .array(z.string().regex(/^p3-[a-z0-9-]+$/))
    .max(12)
    .optional(),
})

export const partThreeQuestionSchema = questionBaseSchema.extend({
  part: z.literal(3),
  /** 来源 Part 2 cue card 的 id;内置题必有,导入题可缺省。 */
  part2QuestionId: z.string().regex(/^p2-[a-z0-9-]+$/).optional(),
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

// ---- 兼容 V1.6 及更早版本的旧会话字段。新流程不再生成这些结构,
// 仅用于读取历史数据,避免用户已有记录丢失。----

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

/** 一行问题 + 一行建议的中文反馈摘要(无 AI 时的本地降级摘要)。 */
export const feedbackSummarySchema = z
  .object({
    problem: nonEmptyText(200),
    suggestion: nonEmptyText(200),
  })
  .strict()

/** V1.6 的旧回答版本结构,仅用于迁移历史 AI 反馈。 */
export const answerVersionOptionSchema = z
  .object({
    style: nonEmptyText(40),
    text: nonEmptyText(1_500),
    hint: nonEmptyText(500),
  })
  .strict()

/** V1.6 的旧跟读发音比对结构,仅用于读取历史会话。 */
export const pronunciationIssueSchema = z
  .object({
    word: nonEmptyText(80),
    heardAs: z.string().trim().max(80).nullable(),
  })
  .strict()

export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>
export type FeedbackKind = z.infer<typeof feedbackKindSchema>
export type ActionableFeedback = z.infer<typeof actionableFeedbackSchema>
export type FeedbackSummary = z.infer<typeof feedbackSummarySchema>
export type AnswerVersionOption = z.infer<typeof answerVersionOptionSchema>
export type PronunciationIssue = z.infer<typeof pronunciationIssueSchema>

// ---- V1.7 Text AI 结构 ----
// DeepSeek 只分析用户提交的答案文本,绝不评价发音、语速、停顿、语调,
// 也不给出任何 IELTS Band 分数或水平评分。

const forbiddenAiAnalysisClaim =
  /\b(?:ielts\s*)?band\b|\bpronunciation\b|\bintonation\b|\bspeech\s+rate\b|\bspeaking\s+speed\b|\bpauses?\b|发音|语速|语调|声调|停顿|口音|(?:雅思|能力|水平).{0,8}(?:分数|评分|等级|分段)/i

const aiAnalysisText = (maximumLength: number) =>
  nonEmptyText(maximumLength).refine(
    (value) => !forbiddenAiAnalysisClaim.test(value),
    'AI feedback must not include band scores or unsupported speech claims',
  )

const requiredReferenceLabels = [
  '简单自然版',
  '自然提升版',
  '另一种表达版',
] as const

export const referenceAnswerSchema = z
  .object({
    /** 中文标签,如:简单自然版 / 自然提升版 / 另一种表达版。 */
    label: nonEmptyText(40),
    text: nonEmptyText(1_500),
  })
  .strict()

export const aiFeedbackSchema = z
  .object({
    /** 用中文写的整体小结。 */
    summary: aiAnalysisText(500),
    strengths: z.array(aiAnalysisText(320)).max(3),
    problems: z.array(aiAnalysisText(320)).max(3),
    grammarSuggestions: z.array(aiAnalysisText(320)).max(3),
    vocabularySuggestions: z.array(aiAnalysisText(320)).max(3),
    /** 保持用户原本水平和表达习惯的优化版回答。 */
    improvedAnswer: nonEmptyText(1_500),
    referenceAnswers: z
      .array(referenceAnswerSchema)
      .length(3)
      .superRefine((answers, context) => {
        requiredReferenceLabels.forEach((label, index) => {
          if (answers[index]?.label !== label) {
            context.addIssue({
              code: 'custom',
              message: `Reference answer ${index + 1} must be labeled ${label}`,
              path: [index, 'label'],
            })
          }
        })
      }),
  })
  .strict()

export type ReferenceAnswer = z.infer<typeof referenceAnswerSchema>
export type AiFeedback = z.infer<typeof aiFeedbackSchema>

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

/**
 * V1.7 只保留纯文本指标(词数、填充词、相邻重复词)供本地降级反馈;
 * wordsPerMinute / acoustic 只可能来自 V1.6 历史记录,新流程不再计算,
 * 也不会在 UI 中展示或评价。
 */
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
    // 'stt' 仅用于读取 V1.6 历史记录;V1.7 新回答一律为 'manual' 或 'edited'。
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
    /** V1.7 新回答为 null;旧录音仍可读取。 */
    audio: audioAssetSchema.nullable().optional(),
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

export type ReadAloudRecord = z.infer<typeof readAloudRecordSchema>

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
    /** 本地账号 userId;V1.8 起写入。旧记录缺省时归“本机用户”。 */
    ownerId: nonEmptyText(120).optional(),
    questionId: nonEmptyText(120),
    status: trainingSessionStatusSchema,
    attempts: z.array(practiceAttemptSchema).max(2),
    localFeedback: actionableFeedbackListSchema,
    aiFeedback: aiFeedbackSchema.nullable(),
    // V1.6 历史字段:读取时保留,新流程不再写入。
    aiComparison: z.unknown().nullable().optional(),
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
    /** 本地账号 userId;V1.8 起写入。旧记录缺省时归“本机用户”。 */
    ownerId: nonEmptyText(120).optional(),
    text: nonEmptyText(1_000),
    topic: nonEmptyText(80),
    questionId: nonEmptyText(120),
    sessionId: nonEmptyText(120),
    sourceAttempt: z.union([z.literal(1), z.literal(2)]).nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema.optional(),
    reviewCount: z.number().int().nonnegative().optional(),
    lastReviewedAt: isoDateTimeSchema.nullable().optional(),
    /** 跨题复用次数:用户从“可复用素材”插入一次就 +1。 */
    reuseCount: z.number().int().nonnegative().optional(),
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
  top: '今天也自然地说一点英语',
  middle: '旅途的意义在于旅途本身',
  bottom: '请输入文本',
}
