import { z } from 'zod'
import { ieltsPartSchema, isoDateTimeSchema } from './models'
import { importExtractionModeSchema, importFileFormatSchema } from './imports'
import type { Question } from './models'
import type { TutorKnowledgeFunction } from './tutorKnowledge'

const text = (maximum: number) => z.string().trim().min(1).max(maximum)

export const userKnowledgeFunctionSchema = z.enum([
  'exam-format', 'structure', 'fluency', 'grammar', 'vocabulary', 'topic',
  'memory', 'feedback', 'coherence', 'routine',
])

export const userKnowledgeSourceSchema = z.object({
  id: text(120),
  ownerId: text(120),
  fileName: text(255),
  mimeType: z.string().trim().max(160),
  fileSize: z.number().int().nonnegative().max(25 * 1024 * 1024),
  format: importFileFormatSchema,
  extractionMode: importExtractionModeSchema,
  originalFileId: text(120),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  title: text(160),
  status: z.enum(['draft', 'ready', 'disabled', 'failed']),
  entryCount: z.number().int().nonnegative().max(500),
  importedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
}).strict()

export const userKnowledgeEntrySchema = z.object({
  id: text(160),
  sourceId: text(120),
  ownerId: text(120),
  title: text(160),
  body: text(2_000),
  originalExcerpt: text(1_000),
  sourcePage: z.number().int().positive().nullable(),
  sourceSection: z.string().trim().max(240).nullable(),
  part: z.union([z.literal('all'), ieltsPartSchema]),
  topics: z.array(text(80)).max(20),
  keywords: z.array(text(80)).max(40),
  tags: z.array(text(80)).max(20),
  functions: z.array(userKnowledgeFunctionSchema).min(1).max(8),
  level: z.enum(['basic', 'developing', 'stretch']),
  confidence: z.enum(['high', 'medium', 'low']),
  enabled: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
}).strict()

export type UserKnowledgeFunction = TutorKnowledgeFunction
export type UserKnowledgeSource = z.infer<typeof userKnowledgeSourceSchema>
export type UserKnowledgeEntry = z.infer<typeof userKnowledgeEntrySchema>

export interface UserKnowledgeDraft {
  source: UserKnowledgeSource
  entries: UserKnowledgeEntry[]
  originalFile: Blob
}

export interface RetrievedUserKnowledge {
  entry: UserKnowledgeEntry
  source: UserKnowledgeSource | null
  score: number
  reason: string
}

export function retrieveUserKnowledge(
  question: Question,
  entries: readonly UserKnowledgeEntry[],
  sources: readonly UserKnowledgeSource[] = [],
  maximum = 4,
  level: UserKnowledgeEntry['level'] = 'developing',
): RetrievedUserKnowledge[] {
  const limit = Math.max(0, Math.min(8, Math.floor(maximum)))
  if (limit === 0) return []
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const query = tokenize([
    question.topic,
    question.prompt,
    question.category ?? '',
    ...(question.part === 2 ? question.cuePoints : []),
  ].join(' '))
  const questionText = `${question.topic} ${question.prompt}`.toLowerCase()

  return entries
    .filter((entry) => entry.deletedAt === null && entry.enabled)
    .filter((entry) => {
      const source = sourceById.get(entry.sourceId)
      return source === undefined || (source.deletedAt === null && source.status === 'ready')
    })
    .map((entry) => {
      const keywords = new Set(entry.keywords.flatMap(tokenize))
      const topics = new Set(entry.topics.flatMap(tokenize))
      const body = new Set(tokenize(`${entry.title} ${entry.body} ${entry.tags.join(' ')}`))
      let score = entry.part === 'all' || entry.part === question.part ? 7 : -2
      score += query.filter((token) => keywords.has(token)).length * 5
      score += query.filter((token) => topics.has(token)).length * 4
      score += query.filter((token) => body.has(token)).length
      score += entry.level === level ? 2 : 0
      if (entry.part === 'all' || entry.part === question.part) score += 2
      const reasonParts = [
        entry.part === 'all' || entry.part === question.part ? 'Part 匹配' : '',
        query.some((token) => topics.has(token)) ? '主题匹配' : '',
        query.some((token) => keywords.has(token)) ? '关键词匹配' : '',
        questionText.includes(entry.title.toLowerCase()) ? '标题匹配' : '',
      ].filter(Boolean)
      return {
        entry,
        source: sourceById.get(entry.sourceId) ?? null,
        score,
        reason: reasonParts.join(' · ') || '正文相关',
      }
    })
    .filter((item) => item.score > 2)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    .slice(0, limit)
}

export function buildUserKnowledgeContext(
  question: Question,
  entries: readonly UserKnowledgeEntry[],
  sources: readonly UserKnowledgeSource[] = [],
  maximum = 4,
  level: UserKnowledgeEntry['level'] = 'developing',
): string {
  return retrieveUserKnowledge(question, entries, sources, maximum, level)
    .map(({ entry, source, reason }) =>
      `[id=${entry.id} sourceId=${entry.sourceId} kind=user_knowledge title=${source?.title ?? entry.title} reason=${reason}] ${entry.body}`,
    )
    .join('\n')
    .slice(0, 2_400)
}

export function chunkKnowledgeText(
  pages: readonly { pageNumber: number | null; text: string }[],
  maximumChunks = 24,
  maximumCharacters = 48_000,
): Array<{ index: number; pageNumber: number | null; section: string | null; text: string }> {
  const chunks: Array<{ index: number; pageNumber: number | null; section: string | null; text: string }> = []
  let total = 0
  for (const page of pages) {
    const paragraphs = page.text.split(/\n{2,}|(?=^#{1,6}\s)/m).map((value) => value.trim()).filter(Boolean)
    for (const paragraph of paragraphs) {
      if (chunks.length >= maximumChunks || total >= maximumCharacters) return chunks
      const remaining = maximumCharacters - total
      const textValue = paragraph.slice(0, Math.min(2_400, remaining)).trim()
      if (textValue.length < 20) continue
      chunks.push({
        index: chunks.length,
        pageNumber: page.pageNumber,
        section: /^#{1,6}\s+(.+)/.exec(textValue)?.[1]?.trim() ?? null,
        text: textValue,
      })
      total += textValue.length
    }
  }
  return chunks
}

function tokenize(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').split(/\s+/)
    .filter((token) => token.length > 1)
}
