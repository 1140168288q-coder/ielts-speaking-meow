import type { Question } from '../../domain'

export function buildQuestionSpeechText(question: Question): string {
  if (!('cuePoints' in question)) {
    return question.prompt
  }

  const cuePoints = question.cuePoints
    .map((point) => point.trim())
    .filter((point) => point.length > 0)
    .join('; ')
  return `${question.prompt}. You should say: ${cuePoints}.`
}
