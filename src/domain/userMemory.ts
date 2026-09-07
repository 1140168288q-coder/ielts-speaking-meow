import type {
  ConfirmedMemoryFact,
  IeltsPart,
  Question,
  SavedExpression,
  TrainingSession,
} from './models'
import type { PersonalMaterial } from './personalMaterials'

/**
 * 用户长期 Memory 由本地已持久化的真实记录推导,不另建一套容易不同步
 * 的存储:练习历史、AI 反馈、个人表达本来就是长期记忆。
 *
 * 这里只做三件事:
 * 1. 汇总用户练过哪些主题、老师反复指出过什么问题;
 * 2. 从个人语料里找可跨题复用的表达;
 * 3. 把上述内容压缩成很短的一段上下文送给 Text AI。
 */

export interface ReusableExpression {
  expression: SavedExpression
  score: number
  reason: string
}

export interface LearnerMemory {
  topicPracticeCount: number
  totalPracticeCount: number
  commonProblemThemes: string[]
  recentStrengths: string[]
  reusableExpressions: ReusableExpression[]
  relevantMaterials: ReusablePersonalMaterial[]
  reusableMemoryFacts: ReusableMemoryFact[]
}

export interface ReusableMemoryFact {
  fact: ConfirmedMemoryFact
  score: number
  reason: string
}

export interface ReusablePersonalMaterial {
  material: PersonalMaterial
  score: number
  reason: string
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'about', 'your', 'you', 'is', 'are', 'was', 'were', 'do', 'does',
  'did', 'have', 'has', 'had', 'it', 'this', 'that', 'what', 'when', 'where',
  'who', 'how', 'why', 'which', 'there', 'some', 'any', 'more', 'most',
])

export function buildLearnerMemory(
  question: Question,
  sessions: TrainingSession[],
  expressions: SavedExpression[],
  materials: PersonalMaterial[] = [],
  knownQuestions: Question[] = [],
): LearnerMemory {
  const questionsById = new Map(
    [question, ...knownQuestions].map((item) => [item.id, item]),
  )
  const topicPracticeCount = sessions.filter((session) =>
    questionsById.get(session.questionId)?.topic === question.topic,
  ).length
  const commonProblemThemes = collectProblemThemes(sessions)
  const recentStrengths = collectStrengths(sessions)
  const reusableExpressions = findReusableExpressions(
    question,
    expressions,
    3,
  )
  const relevantMaterials = findReusablePersonalMaterials(question, materials, 2)
  const reusableMemoryFacts = findReusableMemoryFacts(question, sessions, 4)

  return {
    topicPracticeCount,
    totalPracticeCount: sessions.length,
    commonProblemThemes,
    recentStrengths,
    reusableExpressions,
    relevantMaterials,
    reusableMemoryFacts,
  }
}

/**
 * 跨题复用匹配:同题 > 同 topic > 共享实义词 > 当前 Part 加权 > 其他 Part。
 * 分数只用于排序,不在 UI 上展示数字。
 */
export function findReusableExpressions(
  question: Question,
  expressions: SavedExpression[],
  maximum = 3,
): ReusableExpression[] {
  const questionTopic = question.topic.trim().toLowerCase()
  const questionTokens = new Set(tokenize(`${question.topic} ${question.prompt}`))
  const scored = expressions
    .map((expression) => {
      const expressionTopic = expression.topic.trim().toLowerCase()
      const expressionTokens = tokenize(`${expression.topic} ${expression.text}`)
      let score = 0
      let reason = ''
      if (expression.questionId === question.id) {
        score += 50
        reason = '你为这道题保存过'
      } else if (expressionTopic === questionTopic) {
        score += 30
        reason = '同主题素材'
      } else {
        const overlap = expressionTokens.filter((token) =>
          questionTokens.has(token),
        ).length
        if (overlap > 0) {
          score += 10 + overlap * 3
          reason = '关键词相近，可换题复用'
        } else if (expressionTopic.length > 0) {
          const topicOverlap = [...questionTopic.split(/\s+/)]
            .filter((word) => word.length > 2 && expressionTopic.includes(word))
          if (topicOverlap.length > 0) {
            score += 6 + topicOverlap.length * 2
            reason = '主题部分相近'
          }
        }
      }
      if (score > 0 && (expression.sourcePart === question.part || expression.questionId.startsWith(`p${question.part}-`))) {
        score += 3
      }
      if (score > 0) score += Math.min(10, expression.reuseCount ?? 0)
      return { expression, score, reason }
    })
    .filter((item) => item.score >= 6)
    .sort((a, b) => b.score - a.score)
    .slice(0, maximum)

  return scored.map((item) => ({
    ...item,
    reason: item.reason || '可复用的个人表达',
  }))
}

/**
 * 个人素材回答“这次说什么”。只读取用户确认过、未删除的生活内容；候选素材
 * 在用户确认前绝不会进入 AI 上下文。
 */
export function findReusablePersonalMaterials(
  question: Question,
  materials: PersonalMaterial[],
  maximum = 2,
): ReusablePersonalMaterial[] {
  const questionTokens = new Set(tokenize(`${question.topic} ${question.prompt}`))
  return materials
    .filter((material) => material.status === 'confirmed' && material.deletedAt === null)
    .flatMap((material) => {
      let score = 0
      let reason = ''
      if (material.questionIds.includes(question.id)) {
        score += 50
        reason = '与这道题关联'
      }
      const tags = material.topicTags.flatMap(tokenize)
      const overlap = tags.filter((token) => questionTokens.has(token)).length
      if (overlap > 0) {
        score += 12 + overlap * 4
        if (!reason) reason = '主题相近'
      }
      if (material.sourcePart === question.part && score > 0) {
        score += 4
      }
      if (score === 0) return []
      return [{ material, score, reason }]
    })
    .sort((a, b) => b.score - a.score || b.material.updatedAt.localeCompare(a.material.updatedAt))
    .slice(0, maximum)
    .map((item) => ({ ...item, reason: item.reason || '可用于本题的个人素材' }))
}

/**
 * Memory 是跨 Part 的个性化大脑。当前 Part 和当前主题优先，但其他 Part
 * 的已确认事实只要与本题有明确关键词关联，也可以作为候选上下文。
 */
export function findReusableMemoryFacts(
  question: Question,
  sessions: TrainingSession[],
  maximum = 4,
): ReusableMemoryFact[] {
  const questionTokens = new Set(tokenize(`${question.topic} ${question.prompt}`))
  const candidates = sessions.flatMap((session) => session.confirmedMemoryFacts ?? [])
  const seen = new Set<string>()
  return candidates
    .map((fact) => {
      const identity = `${fact.content}:${fact.sourceSentence}`
      if (seen.has(identity)) return null
      seen.add(identity)
      const factTokens = tokenize(`${fact.content} ${fact.sourceSentence} ${fact.topicTags.join(' ')}`)
      const overlap = factTokens.filter((token) => questionTokens.has(token)).length
      let score = overlap * 10
      let reason = overlap > 0 ? '与你的个人信息相关' : ''
      if (fact.sourcePart === question.part) {
        score += 5
        reason = reason ? `${reason} · 同 Part 优先` : '同 Part 的个人信息'
      }
      return { fact, score, reason }
    })
    .filter((item): item is ReusableMemoryFact => item !== null && item.score >= 10)
    .sort((left, right) => right.score - left.score || right.fact.createdAt.localeCompare(left.fact.createdAt))
    .slice(0, maximum)
    .map((item) => ({ ...item, reason: item.reason || '可关联的个人信息' }))
}

/**
 * 给 Backend 的紧凑学习者上下文；只发送聚合结论，不发送整段历史。
 * 个人素材只有在调用方已经取得用户确认后，才可通过 consentedMaterials 传入。
 */
export function buildLearnerContext(
  question: Question,
  sessions: TrainingSession[],
  expressions: SavedExpression[],
  consentedMaterials: PersonalMaterial[] = [],
  knownQuestions: Question[] = [],
): string {
  const memory = buildLearnerMemory(
    question,
    sessions,
    expressions,
    consentedMaterials,
    knownQuestions,
  )
  const lines: string[] = []
  lines.push(
    `本机历史:该学习者共完成 ${memory.totalPracticeCount} 次单题练习;` +
    `当前题${memory.topicPracticeCount > 0 ? `练过 ${memory.topicPracticeCount} 次` : '是第一次练'}。`,
  )
  if (memory.commonProblemThemes.length > 0) {
    lines.push(`近期老师反复指出的重点:${memory.commonProblemThemes.join('、')}。`)
  }
  if (memory.recentStrengths.length > 0) {
    lines.push(`近期被肯定的地方:${memory.recentStrengths.join('、')}。`)
  }
  if (memory.reusableExpressions.length > 0) {
    lines.push(
      '学习者确认的个人语料（英语表达方式，同题/同主题优先）:' +
      memory.reusableExpressions
        .map(
          (item) =>
            `[${item.expression.topic}] ${item.expression.text}`,
        )
        .join(' | '),
    )
  }
  if (memory.reusableMemoryFacts.length > 0) {
    lines.push(
      '学习者确认的统一 Memory（当前 Part 优先,其他 Part 仅在相关时使用）:' +
        memory.reusableMemoryFacts
          .map(
            (item) =>
              `[来源 Part ${item.fact.sourcePart ?? '未分类'}] ${item.fact.content}（${item.reason}）`,
          )
          .join(' | '),
    )
  }
  if (memory.relevantMaterials.length > 0) {
    lines.push(
      '学习者确认的个人素材（生活内容，仅在适合本题时自然使用）:' +
      memory.relevantMaterials
        .map((item) => `[${item.material.kind}:${item.material.title}] ${item.material.content.slice(0, 220)}`)
        .join(' | '),
    )
  }
  const context = lines.join('\n').slice(0, 1_900)
  return context
}

function collectProblemThemes(sessions: TrainingSession[]): string[] {
  const recent = sessions
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
  const counts = new Map<string, number>()
  for (const session of recent) {
    for (const problem of session.aiFeedback?.problems ?? []) {
      const theme = normalizeTheme(problem)
      if (theme.length > 0) {
        counts.set(theme, (counts.get(theme) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([theme]) => theme)
}

function collectStrengths(sessions: TrainingSession[]): string[] {
  const recent = sessions
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10)
  const strengths = recent.flatMap((session) => session.aiFeedback?.strengths ?? [])
  return [...new Set(strengths)].slice(0, 2)
}

function normalizeTheme(problem: string): string {
  return problem
    .replace(/[。.！!]+$/, '')
    .trim()
    .slice(0, 80)
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase()
  const english = normalized
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  const chinese = [...normalized.matchAll(/[\u4e00-\u9fff]{2,}/gu)]
    .flatMap((match) => {
      const value = match[0]
      return Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2))
    })
  return [...english, ...chinese]
}

export interface MaterialSuggestionContext {
  /** 发送给 Text AI 的紧凑摘要;只含本机已持久化数据,≤1200 字符。 */
  digest: string
  /** 按练习次数排序的常练话题,供本地启发式降级使用。 */
  topics: Array<{ topic: string; count: number }>
  targetPart: IeltsPart | null
}

/**
 * 为"一键提炼个人素材"聚合本地记忆:常练话题、老师反复指出的问题与亮点、
 * 个人语料按话题分组的代表句。隐私级别与 buildLearnerContext 一致。
 */
export function buildMaterialSuggestionContext(
  sessions: TrainingSession[],
  expressions: SavedExpression[],
  knownQuestions: Question[] = [],
  materials: PersonalMaterial[] = [],
  targetPart: IeltsPart | null = null,
): MaterialSuggestionContext {
  const questionsById = new Map(knownQuestions.map((item) => [item.id, item]))
  const topicCounts = new Map<string, { count: number; currentPartCount: number }>()
  const orderedSessions = [...sessions].sort((left, right) => {
    if (targetPart === null) return 0
    const leftPart = left.part ?? partFromQuestionId(left.questionId)
    const rightPart = right.part ?? partFromQuestionId(right.questionId)
    return Number(rightPart === targetPart) - Number(leftPart === targetPart)
  })
  for (const session of orderedSessions) {
    const topic = questionsById.get(session.questionId)?.topic?.trim()
    if (topic) {
      const current = topicCounts.get(topic) ?? { count: 0, currentPartCount: 0 }
      current.count += 1
      if (targetPart !== null && (session.part ?? partFromQuestionId(session.questionId)) === targetPart) {
        current.currentPartCount += 1
      }
      topicCounts.set(topic, current)
    }
  }
  const topics = [...topicCounts.entries()]
    .map(([topic, counts]) => ({ topic, count: counts.count, currentPartCount: counts.currentPartCount }))
    .sort((a, b) => b.currentPartCount - a.currentPartCount || b.count - a.count || a.topic.localeCompare(b.topic))
    .map(({ topic, count }) => ({ topic, count }))

  const lines: string[] = []
  lines.push(
    `本机历史:共完成 ${sessions.length} 次单题练习。` +
    (topics.length
      ? `常练话题:${topics.slice(0, 6).map((item) => `${item.topic}(${item.count}次)`).join('、')}。`
      : '尚无练习记录。'),
  )
  const problemThemes = collectProblemThemes(sessions)
  if (problemThemes.length > 0) {
    lines.push(`近期老师反复指出的重点:${problemThemes.join('、')}。`)
  }
  const strengths = collectStrengths(sessions)
  if (strengths.length > 0) {
    lines.push(`近期被肯定的地方:${strengths.join('、')}。`)
  }

  const expressionsByTopic = new Map<string, string[]>()
  const orderedExpressions = [...expressions].sort((left, right) => {
    if (targetPart === null) return 0
    return Number(right.sourcePart === targetPart) - Number(left.sourcePart === targetPart)
  })
  for (const expression of orderedExpressions.slice(0, 60)) {
    const key = expression.topic.trim() || '未分类'
    const bucket = expressionsByTopic.get(key) ?? []
    if (bucket.length < 2) {
      bucket.push(expression.text)
      expressionsByTopic.set(key, bucket)
    }
  }
  if (expressionsByTopic.size > 0) {
    const parts = [...expressionsByTopic.entries()]
      .slice(0, 8)
      .map(([topic, texts]) => `[${topic}] ${texts.join(' | ')}`)
    lines.push(`学习者确认的个人语料(英语表达):${parts.join(' ; ')}`)
  }

  const facts = orderedSessions
    .flatMap((session) => session.confirmedMemoryFacts ?? [])
    .filter((fact, index, all) => all.findIndex((item) => item.content === fact.content) === index)
    .slice(0, 12)
  if (facts.length > 0) {
    lines.push(
      `学习者确认的统一 Memory${targetPart === null ? '' : `（Part ${targetPart} 优先）`}:` +
        facts.map((fact) => `[来源 Part ${fact.sourcePart}] ${fact.content}`).join('；'),
    )
  }

  const confirmedMaterials = materials
    .filter((material) => material.status === 'confirmed' && material.deletedAt === null)
    .sort((left, right) => Number(right.sourcePart === targetPart) - Number(left.sourcePart === targetPart))
    .slice(0, 10)
  if (confirmedMaterials.length > 0) {
    lines.push(
      `学习者确认的个人素材${targetPart === null ? '' : `（Part ${targetPart} 优先）`}:` +
        confirmedMaterials
          .map((material) => `[来源 Part ${material.sourcePart ?? '未分类'}] ${material.title}:${material.content.slice(0, 180)}`)
          .join('；'),
    )
  }

  return { digest: lines.join('\n').slice(0, 1_900), topics, targetPart }
}

/**
 * 无云端时的降级路径:根据常练话题生成本地素材草稿。
 * 只提示可写的角度,绝不虚构用户经历的具体事实。
 */
export function buildLocalMaterialSuggestions(
  context: MaterialSuggestionContext,
  existingTitles: string[],
  maxCount = 4,
): Array<{
  title: string
  content: string
  kind: 'experience'
  topicTags: string[]
  sourcePart: IeltsPart | null
}> {
  const normalizedExisting = new Set(
    existingTitles.map((title) => title.trim().toLowerCase()),
  )
  const suggestions: Array<{
    title: string
    content: string
    kind: 'experience'
    topicTags: string[]
    sourcePart: IeltsPart | null
  }> = []
  for (const { topic, count } of context.topics) {
    if (suggestions.length >= maxCount) break
    const tagKey = topic.toLowerCase()
    if (
      normalizedExisting.has(tagKey) ||
      [...normalizedExisting].some((title) => title.includes(tagKey))
    ) {
      continue
    }
    normalizedExisting.add(tagKey)
    suggestions.push({
      title: `关于 ${topic} 的素材草稿`,
      content:
        `这个话题你练过 ${count} 次，但还没有留下自己的故事。想一想：` +
        `与「${topic}」有关的一个人、一个地方或一次经历——它发生在什么时候？` +
        '你看到了什么、听到了什么？为什么它让你印象深刻？把真实细节写下来，考场上就能直接用。',
      kind: 'experience',
      topicTags: [topic],
      sourcePart: context.targetPart,
    })
  }
  return suggestions
}

function partFromQuestionId(questionId: string): IeltsPart | null {
  const match = /^p([123])-/u.exec(questionId)
  return match === null ? null : Number(match[1]) as IeltsPart
}
