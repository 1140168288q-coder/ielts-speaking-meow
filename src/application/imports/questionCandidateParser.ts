import {
  importQuestionCandidateListSchema,
  type ImportQuestionCandidate,
  type IeltsPart,
} from '../../domain'
import type { ExtractedPage } from './materialExtractor'

const PART_HEADING = /^(?:#+\s*)?(?:ielts\s+speaking\s+)?part\s*([123])\b/i
const TOPIC_HEADING = /^(?:#+\s*)?(?:topic|主题)\s*[:：-]?\s*(.+)$/i
const QUESTION_START = /^(?:what|why|when|where|who|whose|which|how|do|does|did|are|is|was|were|can|could|would|should|have|has|had|will|tell me|describe|talk about)\b/i
const PART_TWO_START = /^(?:describe|talk about)\b/i

export function parseQuestionCandidates(
  pages: ExtractedPage[],
): ImportQuestionCandidate[] {
  const candidates: ImportQuestionCandidate[] = []
  let currentPart: IeltsPart = 1
  let currentTopic = '导入题目'
  let pendingPartTwo: ImportQuestionCandidate | null = null
  let nextId = 1

  const flushPartTwo = () => {
    if (pendingPartTwo !== null) {
      candidates.push(pendingPartTwo)
      pendingPartTwo = null
    }
  }

  for (const page of pages) {
    const lines = splitIntoLines(page.text)
    for (const rawLine of lines) {
      const partMatch = PART_HEADING.exec(rawLine)
      if (partMatch?.[1] !== undefined) {
        flushPartTwo()
        currentPart = Number(partMatch[1]) as IeltsPart
        continue
      }

      const topicMatch = TOPIC_HEADING.exec(rawLine)
      if (topicMatch?.[1] !== undefined) {
        flushPartTwo()
        currentTopic = cleanLine(topicMatch[1]).slice(0, 80) || currentTopic
        continue
      }

      const line = cleanLine(rawLine)
      if (line.length === 0 || /^---\s*第\s*\d+\s*页\s*---$/.test(line)) {
        continue
      }

      if (currentPart === 2 && PART_TWO_START.test(line)) {
        flushPartTwo()
        pendingPartTwo = {
          id: `candidate-${nextId}`,
          part: 2,
          topic: currentTopic,
          prompt: line.slice(0, 500),
          cuePoints: [],
          sourcePage: page.pageNumber,
        }
        nextId += 1
        continue
      }

      if (pendingPartTwo !== null && isCuePoint(line)) {
        if (pendingPartTwo.cuePoints.length < 5) {
          pendingPartTwo.cuePoints.push(line.slice(0, 160))
        }
        continue
      }

      const questions = extractQuestions(line)
      if (questions.length === 0) {
        if (looksLikeHeading(rawLine, line)) {
          currentTopic = line.slice(0, 80)
        }
        continue
      }

      flushPartTwo()
      for (const prompt of questions) {
        candidates.push({
          id: `candidate-${nextId}`,
          part: currentPart,
          topic: currentTopic,
          prompt: prompt.slice(0, 500),
          cuePoints: [],
          sourcePage: page.pageNumber,
        })
        nextId += 1
      }
    }
  }

  flushPartTwo()
  return importQuestionCandidateListSchema.parse(candidates.slice(0, 300))
}

function splitIntoLines(text: string): string[] {
  return text
    .replace(/([?？])\s+(?=[A-Z])/g, '$1\n')
    .split(/\n+/)
}

function cleanLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\(?\d{1,3}[.)、]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractQuestions(line: string): string[] {
  const matches = line.match(/[^?？]+[?？]/g)
  if (matches !== null) {
    return matches
      .map(cleanLine)
      .filter((question) => QUESTION_START.test(question))
  }

  return QUESTION_START.test(line) && line.length <= 500 ? [line] : []
}

function looksLikeHeading(rawLine: string, line: string): boolean {
  return (
    /^#{1,6}\s+/.test(rawLine.trim()) ||
    (/^[A-Z][A-Za-z &/-]{2,60}$/.test(line) && !QUESTION_START.test(line))
  )
}

function isCuePoint(line: string): boolean {
  return (
    /^(?:you should say|who|what|when|where|why|how)\b/i.test(line) ||
    (!/[?？]$/.test(line) && line.length <= 160)
  )
}
