import type {
  Question,
  SavedExpression,
  TrainingSession,
} from './models'

export type RecurringFocusKey =
  | 'filler'
  | 'repetition'
  | 'long-pauses'
  | 'transcript'

export interface RecurringFocus {
  key: RecurringFocusKey
  label: string
  sessionCount: number
}

export interface TopicProgress {
  topic: string
  practiceCount: number
}

export interface ProgressSummary {
  startedSessions: number
  completedSessions: number
  secondAttemptSessions: number
  secondAttemptRate: number | null
  improvedSessions: number
  improvementRate: number | null
  averageFillerDelta: number | null
  averageLongPauseDelta: number | null
  activeTopics: TopicProgress[]
  recurringFocus: RecurringFocus[]
}

export interface QuestionRecommendation {
  question: Question
  reason: string
}

const focusLabels: Record<RecurringFocusKey, string> = {
  filler: '减少填充词',
  repetition: '减少重复词',
  'long-pauses': '缩短长停顿',
  transcript: '补全或修正转写',
}

export function buildProgressSummary(
  sessions: TrainingSession[],
  questions: Question[],
): ProgressSummary {
  const started = sessions.filter((session) => session.attempts.length > 0)
  const twoAttempts = started.filter((session) => session.attempts.length >= 2)
  const comparable = twoAttempts.filter((session) => session.comparison !== null)
  const improvedSessions = comparable.filter(hasMeasurableImprovement).length

  const topicCounts = new Map<string, number>()
  for (const session of started) {
    const question = questions.find((item) => item.id === session.questionId)
    if (question) {
      topicCounts.set(question.topic, (topicCounts.get(question.topic) ?? 0) + 1)
    }
  }

  const focusCounts = new Map<RecurringFocusKey, number>()
  for (const session of started) {
    const first = session.attempts.find((attempt) => attempt.attemptNumber === 1)
    if (!first) continue
    if (first.metrics.fillerCount >= 2) increment(focusCounts, 'filler')
    if (first.metrics.repeatedWordCount >= 1) increment(focusCounts, 'repetition')
    if ((first.metrics.acoustic?.longPauseCount ?? 0) >= 2) {
      increment(focusCounts, 'long-pauses')
    }
    if (first.transcript.status !== 'ready' || !first.transcript.text.trim()) {
      increment(focusCounts, 'transcript')
    }
  }

  return {
    startedSessions: started.length,
    completedSessions: started.filter((session) => session.status === 'completed').length,
    secondAttemptSessions: twoAttempts.length,
    secondAttemptRate: percentage(twoAttempts.length, started.length),
    improvedSessions,
    improvementRate: percentage(improvedSessions, comparable.length),
    averageFillerDelta: average(
      comparable.map((session) => session.comparison?.fillerCount?.delta ?? null),
    ),
    averageLongPauseDelta: average(
      comparable.map((session) => session.comparison?.longPauseCount?.delta ?? null),
    ),
    activeTopics: [...topicCounts.entries()]
      .map(([topic, practiceCount]) => ({ topic, practiceCount }))
      .sort((a, b) => b.practiceCount - a.practiceCount || a.topic.localeCompare(b.topic))
      .slice(0, 4),
    recurringFocus: [...focusCounts.entries()]
      .map(([key, sessionCount]) => ({
        key,
        label: focusLabels[key],
        sessionCount,
      }))
      .sort((a, b) => b.sessionCount - a.sessionCount || a.label.localeCompare(b.label))
      .slice(0, 3),
  }
}

export function recommendQuestion(
  questions: Question[],
  sessions: TrainingSession[],
): QuestionRecommendation | null {
  if (questions.length === 0) return null

  const practiced = sessions
    .filter((session) => session.attempts.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  if (practiced.length === 0) {
    const first = questions.find((question) => question.part === 1) ?? questions[0]!
    return { question: first, reason: '不用完美，先张嘴。节奏比流利更重要。' }
  }

  const questionCounts = new Map<string, number>()
  const topicCounts = new Map<string, number>()
  const partCounts = new Map<number, number>()
  const topicByQuestion = new Map(questions.map((question) => [question.id, question.topic]))
  for (const session of practiced) {
    const topic = topicByQuestion.get(session.questionId)
    questionCounts.set(session.questionId, (questionCounts.get(session.questionId) ?? 0) + 1)
    if (topic) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1)
    const part = questions.find((question) => question.id === session.questionId)?.part
    if (part) partCounts.set(part, (partCounts.get(part) ?? 0) + 1)
  }
  const mostRecentQuestionId = practiced[0]?.questionId

  const ranked = questions
    .map((question, index) => ({
      question,
      index,
      score:
        (questionCounts.get(question.id) ?? 0) * 8 +
        (topicCounts.get(question.topic) ?? 0) * 2 +
        (partCounts.get(question.part) ?? 0) * 0.25 +
        (question.id === mostRecentQuestionId ? 6 : 0),
    }))
    .sort((a, b) => a.score - b.score || a.index - b.index)

  const question = ranked[0]!.question
  const questionCount = questionCounts.get(question.id) ?? 0
  const topicCount = topicCounts.get(question.topic) ?? 0
  const reason =
    topicCount === 0
      ? `“${question.topic}”还没练过，补一个新主题。`
      : questionCount === 0
        ? '你练过相近主题，但还没回答过这道题。'
        : '根据本机记录，这道题练得相对较少，适合再巩固一次。'

  return { question, reason }
}

export function selectExpressionReviewQueue(
  expressions: SavedExpression[],
  now: Date = new Date(),
  limit = 3,
): SavedExpression[] {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000
  return expressions
    .filter((expression) => {
      if (!expression.lastReviewedAt) return true
      return now.getTime() - new Date(expression.lastReviewedAt).getTime() >= sevenDaysMs
    })
    .sort((a, b) => {
      const aLast = a.lastReviewedAt ?? ''
      const bLast = b.lastReviewedAt ?? ''
      return (
        aLast.localeCompare(bLast) ||
        (a.reviewCount ?? 0) - (b.reviewCount ?? 0) ||
        a.createdAt.localeCompare(b.createdAt)
      )
    })
    .slice(0, Math.max(0, limit))
}

function hasMeasurableImprovement(session: TrainingSession): boolean {
  const comparison = session.comparison
  if (!comparison) return false
  const deltas = [
    comparison.fillerCount?.delta,
    comparison.repeatedWordCount?.delta,
    comparison.longPauseCount?.delta,
  ].filter((value): value is number => value !== null && value !== undefined)
  if (deltas.length > 0 && deltas.reduce((sum, value) => sum + value, 0) < 0) {
    return true
  }
  return comparison.feedback.some((item) => item.kind === 'improvement')
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 100)
}

function average(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null)
  if (available.length === 0) return null
  return Math.round((available.reduce((sum, value) => sum + value, 0) / available.length) * 10) / 10
}

function increment(map: Map<RecurringFocusKey, number>, key: RecurringFocusKey): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}
