import { z } from 'zod'
import generatedTutorKnowledge from '../data/tutorKnowledge.generated.json'
import type { Question } from './models'

export const TUTOR_KNOWLEDGE_VERSION = '2026.08-v3'
export type TutorKnowledgeSource = 'official-guidance' | 'product-authored'
export type TutorKnowledgeLevel = 'basic' | 'developing' | 'stretch'
export type TutorKnowledgeFunction =
  | 'exam-format'
  | 'structure'
  | 'fluency'
  | 'grammar'
  | 'vocabulary'
  | 'topic'
  | 'memory'
  | 'feedback'
  | 'coherence'
  | 'routine'
  | 'scoring'
  | 'pronunciation'

export type TutorKnowledgeNeed =
  | 'feedback'
  | 'answer-planning'
  | 'vocabulary'
  | 'grammar'
  | 'personal-materials'
  | 'routine'

const tutorKnowledgeFunctionSchema = z.enum([
  'exam-format',
  'structure',
  'fluency',
  'grammar',
  'vocabulary',
  'topic',
  'memory',
  'feedback',
  'coherence',
  'routine',
  'scoring',
  'pronunciation',
])

const tutorKnowledgeDocumentSchema = z
  .object({
    id: z.string().min(1),
    part: z.union([z.literal('all'), z.literal(1), z.literal(2), z.literal(3)]),
    title: z.string().min(1),
    body: z.string().min(1),
    keywords: z.array(z.string().min(1)).max(40),
    tags: z.array(z.string().min(1)).max(20),
    functions: z.array(tutorKnowledgeFunctionSchema).min(1).max(8),
    topics: z.array(z.string().min(1)).max(20),
    questionTypes: z.array(z.string().min(1)).max(12),
    level: z.enum(['basic', 'developing', 'stretch']),
    source: z.enum(['official-guidance', 'product-authored']),
    sourceUrl: z.string().url().optional(),
    confidence: z.enum(['high', 'medium', 'low']),
    reusable: z.boolean(),
    sourceSection: z.string().min(1),
    reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()

const tutorKnowledgeCorpusSchema = z
  .object({
    format: z.literal('ielts-speaking-meow-tutor-knowledge'),
    formatVersion: z.literal(1),
    sourceFile: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceVersion: z.string().min(1),
    generatedAt: z.iso.datetime({ offset: true }),
    documents: z.array(tutorKnowledgeDocumentSchema).min(20),
  })
  .strict()

export interface TutorKnowledgeDoc {
  id: string
  /** all = 所有 Part;1/2/3 只适用于对应 Part。 */
  part: 'all' | 1 | 2 | 3
  title: string
  body: string
  /** 英文主题关键词,用于与题目 topic/prompt 匹配。 */
  keywords: string[]
  tags: string[]
  functions: TutorKnowledgeFunction[]
  topics: string[]
  questionTypes: string[]
  level: TutorKnowledgeLevel
  source: TutorKnowledgeSource
  sourceUrl?: string
  confidence: 'high' | 'medium' | 'low'
  reusable: boolean
  sourceSection: string
  reviewedAt: string
}

export interface RetrievedKnowledgeDoc {
  doc: TutorKnowledgeDoc
  score: number
  reason: string
}

export interface TutorKnowledgeRetrievalOptions {
  /** 当前没有独立水平设置时由产品默认 basic;调用方可显式传入。 */
  learnerLevel?: TutorKnowledgeLevel
  need?: TutorKnowledgeNeed
}

const tutorKnowledgeCorpus = tutorKnowledgeCorpusSchema.parse(generatedTutorKnowledge)
const DOCS: readonly TutorKnowledgeDoc[] = tutorKnowledgeCorpus.documents.map(
  ({ sourceUrl, ...doc }) => (sourceUrl ? { ...doc, sourceUrl } : doc),
)
export const TUTOR_KNOWLEDGE_SOURCE_FILE = tutorKnowledgeCorpus.sourceFile
export const TUTOR_KNOWLEDGE_SOURCE_SHA256 = tutorKnowledgeCorpus.sourceSha256

export function listTutorKnowledgeDocuments(): readonly TutorKnowledgeDoc[] {
  return DOCS
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'about', 'your', 'you', 'is', 'are', 'was', 'were', 'do', 'does',
  'did', 'have', 'has', 'had', 'it', 'this', 'that', 'what', 'when', 'where',
  'who', 'how', 'why', 'which', 'there', 'some', 'any', 'more', 'most',
])

const NEED_FUNCTIONS: Record<TutorKnowledgeNeed, readonly TutorKnowledgeFunction[]> = {
  feedback: [
    'exam-format', 'structure', 'fluency', 'grammar', 'vocabulary', 'topic',
    'feedback', 'coherence', 'memory', 'routine',
  ],
  'answer-planning': [
    'exam-format', 'structure', 'fluency', 'vocabulary', 'topic', 'memory',
    'coherence',
  ],
  vocabulary: ['vocabulary', 'topic', 'memory', 'coherence'],
  grammar: ['grammar', 'structure', 'coherence', 'feedback'],
  'personal-materials': ['memory', 'topic', 'structure', 'vocabulary'],
  routine: ['routine', 'feedback', 'fluency', 'structure', 'memory'],
}

/**
 * 小型本地 IELTS 教学 RAG。知识源由根目录 Markdown 生成版本化 chunks，
 * 运行时只加载被检索到的短文档；不使用 embedding API，离线也可用。
 *
 * scoring / pronunciation chunks 保留在知识库中供后续教学页使用，但默认
 * feedback 与 answer-planning 检索明确排除它们，避免把不属于当前产品范围的
 * 评分或语音评价内容注入 DeepSeek。
 */
export function retrieveTutorKnowledge(
  question: Question,
  maximum = 3,
  options: TutorKnowledgeRetrievalOptions = {},
): RetrievedKnowledgeDoc[] {
  const limit = Math.max(0, Math.min(8, Math.floor(maximum)))
  if (limit === 0) return []

  const need = options.need ?? 'feedback'
  const learnerLevel = options.learnerLevel ?? 'basic'
  const queryText = [
    question.topic,
    question.prompt,
    question.category ?? '',
    ...(question.part === 2 ? question.cuePoints : []),
  ].join(' ')
  const queryTokens = new Set(tokenize(queryText))
  const questionTypes = inferQuestionTypes(question)
  const allowedFunctions = new Set(NEED_FUNCTIONS[need])

  const scored = DOCS
    .filter((doc) => doc.part === 'all' || doc.part === question.part)
    .filter((doc) => doc.functions.some((fn) => allowedFunctions.has(fn)))
    .filter((doc) => isSafeForTextFeedback(doc))
    .map((doc) => {
      const keywordTokens = new Set(doc.keywords.flatMap(tokenize))
      const topicTokens = new Set(doc.topics.flatMap(tokenize))
      const tagTokens = new Set(doc.tags.flatMap(tokenize))
      const documentTokens = new Set(tokenize(`${doc.title} ${doc.body}`))
      const matchedTopics = [...queryTokens].filter((token) => topicTokens.has(token))
      const matchedKeywords = [...queryTokens].filter((token) => keywordTokens.has(token))
      const matchedFunctions = doc.functions.filter((fn) => allowedFunctions.has(fn))
      const matchedQuestionTypes = doc.questionTypes.filter((type) => questionTypes.has(type))

      let score = doc.part === question.part ? 7 : 2
      score += matchedKeywords.length * 5
      score += matchedTopics.length * 3
      score += [...queryTokens].filter((token) => tagTokens.has(token)).length * 2
      score += [...queryTokens].filter((token) => documentTokens.has(token)).length
      score += matchedFunctions.length >= 2 ? 2 : 0
      score += matchedQuestionTypes.length * 3
      score += levelScore(doc.level, learnerLevel)

      return {
        doc,
        score,
        reason: buildReason(doc, need, matchedTopics, matchedQuestionTypes),
      }
    })

  return scored
    .filter((item) => item.score > 2)
    .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
    .slice(0, limit)
}

/** 给 Backend 的紧凑教学上下文;不包含用户答案,只含被检索到的教学原则。 */
export function buildTutorContext(
  question: Question,
  maximum = 3,
  options: TutorKnowledgeRetrievalOptions = {},
): string {
  const docs = retrieveTutorKnowledge(question, maximum, options)
  if (docs.length === 0) return ''
  return docs
    .map((item) => `【${item.doc.title}】${item.doc.body}`)
    .join('\n')
    .slice(0, 2_600)
}

function inferQuestionTypes(question: Question): Set<string> {
  const text = `${question.topic} ${question.prompt}`.toLowerCase()
  const types = new Set<string>()
  if (question.part === 2) types.add('describe')
  if (/\b(dislike|don't like|do not like|hate|least)\b/.test(text)) types.add('dislike')
  if (/\b(prefer|favourite|favorite|like|enjoy)\b/.test(text)) types.add('preference')
  if (/\b(why|cause|reason)\b/.test(text)) types.add('why')
  if (/\b(compare|difference|better|more than|less than)\b/.test(text)) types.add('compare')
  if (/\b(should|important|agree|opinion|think)\b/.test(text)) types.add('opinion')
  if (/\b(how|improve|solve|solution|can .+ help)\b/.test(text)) types.add('impact')
  if (/\b(experience|event|occasion|trip|journey)\b/.test(text)) types.add('experience')
  if (/\b(person|someone|friend|teacher|family)\b/.test(text)) types.add('person')
  if (/\b(place|city|park|building|home)\b/.test(text)) types.add('place')
  if (/\b(object|thing|gift|phone|book)\b/.test(text)) types.add('object')
  if (/\b(change|used to|now|in the past)\b/.test(text)) types.add('change')
  return types
}

function levelScore(
  documentLevel: TutorKnowledgeLevel,
  learnerLevel: TutorKnowledgeLevel,
): number {
  const rank: Record<TutorKnowledgeLevel, number> = {
    basic: 0,
    developing: 1,
    stretch: 2,
  }
  if (documentLevel === learnerLevel) return 2
  return rank[documentLevel] <= rank[learnerLevel] ? 1 : -1
}

function buildReason(
  doc: TutorKnowledgeDoc,
  need: TutorKnowledgeNeed,
  matchedTopics: string[],
  matchedQuestionTypes: string[],
): string {
  const part = doc.part === 'all' ? '通用' : `Part ${doc.part}`
  const matches = [
    matchedTopics.length ? '主题匹配' : '',
    matchedQuestionTypes.length ? '题型匹配' : '',
  ].filter(Boolean)
  return `${part} · ${need}${matches.length ? ` · ${matches.join('、')}` : ''}`
}

function isSafeForTextFeedback(doc: TutorKnowledgeDoc): boolean {
  if (doc.functions.includes('scoring') || doc.functions.includes('pronunciation')) {
    return false
  }
  return !/\b(?:band|score|pronunciation|intonation|speech\s+rate|pauses?)\b|发音|语速|语调|停顿|口音/i.test(
    `${doc.title} ${doc.body}`,
  )
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}
