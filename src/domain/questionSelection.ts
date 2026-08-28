import type { IeltsPart, Question } from './models'

export type QuestionDoneFilter = 'all' | 'undone' | 'done'

export interface QuestionSelectionFilters {
  part: IeltsPart
  topic?: string
  done?: QuestionDoneFilter
  query?: string
  category?: string
  newOnly?: boolean
}

export function filterPracticeQuestions(
  questions: Question[],
  states: Record<string, boolean>,
  filters: QuestionSelectionFilters,
): Question[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? ''
  return questions.filter((question) => {
    if (question.part !== filters.part) return false
    if (filters.topic && filters.topic !== 'all' && question.topic !== filters.topic) {
      return false
    }
    if (filters.category && filters.category !== 'all' &&
      (question.category ?? '导入题目') !== filters.category) {
      return false
    }
    if (filters.newOnly === true && question.isNew === false) return false
    const isDone = states[question.id] === true
    if (filters.done === 'done' && !isDone) return false
    if (filters.done === 'undone' && isDone) return false
    if (!query) return true
    return [question.topic, question.prompt, question.category ?? '']
      .some((value) => value.toLocaleLowerCase().includes(query))
  })
}

export function pickRandomQuestion(
  questions: Question[],
  randomValue = Math.random(),
): Question | null {
  if (questions.length === 0) return null
  const bounded = Math.min(0.999999999, Math.max(0, randomValue))
  return questions[Math.floor(bounded * questions.length)] ?? null
}
