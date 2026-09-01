import { z } from 'zod'
import {
  aiFeedbackSchema,
  answerVersionOptionSchema,
  trainingSessionSchema,
  type AiFeedback,
  type TrainingSession,
} from './models'

/**
 * 只读兼容层:把 V1.6 会话中的旧 AI 反馈结构转成 V1.7 的文本分析结构。
 * 旧录音、旧跟读记录等字段仍由主 schema 原样读取,不做删除。
 */

const legacySummarySchema = z
  .object({
    problem: z.string().trim().min(1),
    suggestion: z.string().trim().min(1),
  })
  .passthrough()

const legacyKeyIssueSchema = z
  .object({
    category: z.string().optional(),
    kind: z.string().optional(),
    title: z.string().optional(),
    observation: z.string().optional(),
    action: z.string().optional(),
    evidence: z.string().nullable().optional(),
  })
  .passthrough()

const legacyRevisionsSchema = z
  .object({
    minimalFix: z.string().nullable().optional(),
    naturalVersion: z.string().nullable().optional(),
    stretchVersion: z.string().nullable().optional(),
  })
  .passthrough()

const legacyReferenceAnswersSchema = z
  .array(
    z
      .object({
        label: z.string().optional(),
        text: z.string().trim().min(1),
      })
      .passthrough(),
  )
  .optional()

const legacyAiFeedbackSchema = z
  .object({
    keyIssues: z.array(legacyKeyIssueSchema).optional(),
    secondAttemptTips: z.array(z.string()).optional(),
    revisions: legacyRevisionsSchema.optional(),
    summary: legacySummarySchema.optional(),
    versions: z.array(answerVersionOptionSchema).optional(),
    improvedAnswer: z.string().trim().min(1).optional(),
    referenceAnswers: legacyReferenceAnswersSchema,
  })
  .passthrough()

const legacySessionSchema = z
  .object({
    aiFeedback: legacyAiFeedbackSchema,
  })
  .passthrough()

/**
 * 读取任意历史版本的会话并转换为当前 schema。
 * 无法识别的记录返回 null(与存储层既有行为一致:坏记录不阻塞其他数据)。
 */
export function normalizeStoredTrainingSession(
  value: unknown,
): TrainingSession | null {
  if (value === null || typeof value !== 'object') {
    return null
  }

  const direct = trainingSessionSchema.safeParse(value)
  if (direct.success) {
    return direct.data
  }

  const legacy = legacySessionSchema.safeParse(value)
  if (!legacy.success) {
    return null
  }

  const record = value as Record<string, unknown>
  const migrated: Record<string, unknown> = {
    ...record,
    part: inferPart(record.questionId),
    aiFeedback: migrateLegacyAiFeedback(legacy.data.aiFeedback),
  }
  const parsed = trainingSessionSchema.safeParse(migrated)
  return parsed.success ? parsed.data : null
}

function migrateLegacyAiFeedback(value: unknown): AiFeedback {
  const legacy = legacyAiFeedbackSchema.parse(value)
  const versions = legacy.versions ?? []
  const grammarIssues = (legacy.keyIssues ?? []).filter(
    (issue) => issue.category === 'grammar',
  )
  const vocabularyIssues = (legacy.keyIssues ?? []).filter(
    (issue) => issue.category === 'vocabulary',
  )
  const allProblems = (legacy.keyIssues ?? []).map((issue) =>
    [issue.title, issue.observation].filter(Boolean).join(': '),
  )
  const fallbackProblem = legacy.summary?.problem ?? ''
  const problems =
    allProblems.length > 0
      ? allProblems.slice(0, 2)
      : fallbackProblem
        ? [fallbackProblem]
        : ['这次回答还有一些可以改进的地方。']

  const summary = [
    legacy.summary?.problem ?? '',
    legacy.summary?.suggestion ?? '',
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  const simpleAnswer =
    legacy.revisions?.minimalFix ||
    legacy.improvedAnswer ||
    versions[0]?.text ||
    legacy.referenceAnswers?.[0]?.text ||
    legacy.revisions?.naturalVersion ||
    ''
  const naturalAnswer =
    legacy.revisions?.naturalVersion ||
    versions[1]?.text ||
    legacy.referenceAnswers?.[1]?.text ||
    simpleAnswer

  return aiFeedbackSchema.parse({
    summary:
      summary.length > 0
        ? summary
        : '这是从旧版本迁移的 AI 反馈，可重新提交答案获取完整文本分析。',
    strengths: [],
    problems,
    grammarSuggestions: grammarIssues
      .map((issue) => issue.action ?? issue.observation ?? '')
      .filter(Boolean)
      .slice(0, 3),
    vocabularySuggestions: vocabularyIssues
      .map((issue) => issue.action ?? issue.observation ?? '')
      .filter(Boolean)
      .slice(0, 3),
    referenceAnswers: [
      {
        label: '简单优化版',
        text:
          simpleAnswer.length > 0
            ? simpleAnswer
            : 'Keep your original answer and apply the suggestions above.',
      },
      {
        label: '自然提升版',
        text:
          naturalAnswer.length > 0
            ? naturalAnswer
            : 'Keep your original answer and add one clear supporting detail.',
      },
    ],
    naturalUpgradeSuggestions: {
      addableContent: [],
      advancedChanges: (legacy.secondAttemptTips ?? []).slice(0, 3),
    },
    answerFramework: [],
  })
}

function inferPart(questionId: unknown): 1 | 2 | 3 | null {
  if (typeof questionId !== 'string') return null
  const match = /^p([123])-/u.exec(questionId)
  return match === null ? null : Number(match[1]) as 1 | 2 | 3
}
