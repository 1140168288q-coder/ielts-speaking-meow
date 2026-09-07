import { z } from 'zod'
import type { AiFeedback, Question, TrainingSession } from './models'
import type { RetrievedKnowledgeDoc } from './tutorKnowledge'
import type { ReusableExpression, ReusablePersonalMaterial } from './userMemory'

const nonEmptyText = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength)

const trainingPlanSourceSchema = z
  .object({
    kind: z.enum(['teaching', 'feedback', 'personal-material', 'expression', 'fallback']),
    label: nonEmptyText(160),
    detail: nonEmptyText(320),
  })
  .strict()

const trainingPlanOutcomeSchema = z
  .object({
    status: z.enum(['pending', 'completed']),
    evidence: z.array(nonEmptyText(240)).max(3),
  })
  .strict()

export const trainingPlanSchema = z
  .object({
    goal: nonEmptyText(240),
    actions: z.array(nonEmptyText(240)).min(1).max(2),
    sources: z.array(trainingPlanSourceSchema).min(1).max(4),
    outcome: trainingPlanOutcomeSchema,
  })
  .strict()

export type TrainingPlan = z.infer<typeof trainingPlanSchema>

export interface TrainingPlanInput {
  question: Question
  teachingDocs?: RetrievedKnowledgeDoc[]
  aiFeedback?: AiFeedback | null
  reusableExpressions?: ReusableExpression[]
  reusablePersonalMaterials?: ReusablePersonalMaterial[]
  completedSession?: TrainingSession | null
}

/**
 * A small, deterministic practice plan built from existing retrieval and
 * confirmed learner data. It explains its sources and never writes Memory or
 * generates a replacement answer.
 */
export function buildTrainingPlan(input: TrainingPlanInput): TrainingPlan {
  const {
    question,
    teachingDocs = [],
    aiFeedback = null,
    reusableExpressions = [],
    reusablePersonalMaterials = [],
    completedSession = null,
  } = input
  const sources: TrainingPlan['sources'] = []
  const addSource = (source: TrainingPlan['sources'][number]) => {
    if (!sources.some((item) => item.label === source.label)) sources.push(source)
  }

  for (const item of teachingDocs.slice(0, 2)) {
    addSource({
      kind: 'teaching',
      label: item.doc.title,
      detail: `本地教学检索：${item.reason}`,
    })
  }
  const feedbackAction = firstFeedbackAction(aiFeedback)
  if (feedbackAction !== null) {
    addSource({
      kind: 'feedback',
      label: '本次回答重点',
      detail: shorten(feedbackAction, 320),
    })
  }
  const material = reusablePersonalMaterials[0]
  if (material !== undefined) {
    addSource({
      kind: 'personal-material',
      label: material.material.title,
      detail: `已确认素材：${material.reason}`,
    })
  }
  const expression = reusableExpressions[0]
  if (expression !== undefined) {
    addSource({
      kind: 'expression',
      label: shorten(expression.expression.text, 160),
      detail: shorten(`已确认表达：${expression.reason}`, 320),
    })
  }
  if (sources.length === 0) {
    addSource({
      kind: 'fallback',
      label: '本地训练规则',
      detail: '没有可用的 AI 或个人素材时，仍按题型完成一次可说的二答。',
    })
  }

  const actions = [
    shorten(feedbackAction ?? defaultFirstAction(question), 240),
    material !== undefined
      ? shorten(`用「${material.material.title}」中的一个真实细节，用自己的话回答。`, 240)
      : expression !== undefined
        ? shorten(`尝试复用一个短表达：「${expression.expression.text}」。`, 240)
        : '再完整回答一次：先直接回应题目，再补一个原因、细节或例子。',
  ]

  const evidence: string[] = []
  if (completedSession !== null) {
    const attemptCount = completedSession.attempts.filter(
      (attempt) => attempt.transcript.status === 'ready',
    ).length
    evidence.push(
      attemptCount >= 2
        ? '已保存第一次和第二次回答。'
        : `已保存 ${attemptCount} 次回答，可回看本次练习。`,
    )
    const expressionCount = completedSession.secondAttemptAnalysis?.correctedSentences.length ?? 0
    if (expressionCount > 0) evidence.push(`已确认 ${expressionCount} 条二答修正句。`)
    if ((completedSession.confirmedMemoryFacts?.length ?? 0) > 0) {
      evidence.push(`已确认 ${(completedSession.confirmedMemoryFacts ?? []).length} 条个人信息。`)
    }
  }

  return trainingPlanSchema.parse({
    goal: defaultGoal(question),
    actions: actions.slice(0, 2),
    sources: sources.slice(0, 4),
    outcome: {
      status: completedSession === null ? 'pending' : 'completed',
      evidence,
    },
  })
}

function defaultGoal(question: Question): string {
  if (question.part === 2) {
    return '按 cue card 先说清背景，再补两个具体细节和你的感受。'
  }
  if (question.part === 3) {
    return '先给出清楚观点，再用原因和例子展开，保持答案容易说出口。'
  }
  return '先直接回答，再补一个真实原因或细节，让答案自然完整。'
}

function defaultFirstAction(question: Question): string {
  if (question.part === 2 && question.cuePoints?.length) {
    return `按这张 cue card 的顺序选 ${Math.min(3, question.cuePoints.length)} 个要点，不背整段范文。`
  }
  if (question.part === 3) {
    return '先说自己的观点，再补一个 because/for example 解释。'
  }
  return '先用一句话直接回答题目，再补一个 why 或具体例子。'
}

function firstFeedbackAction(feedback: AiFeedback | null): string | null {
  if (feedback === null) return null
  return feedback.grammarSuggestions[0]
    ?? feedback.vocabularySuggestions[0]
    ?? feedback.naturalUpgradeSuggestions.advancedChanges[0]
    ?? feedback.problems[0]
    ?? null
}

function shorten(value: string, maximum: number): string {
  const trimmed = value.trim()
  return trimmed.length <= maximum ? trimmed : `${trimmed.slice(0, maximum - 1)}…`
}
