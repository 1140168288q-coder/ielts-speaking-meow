import type { Question, SavedExpression, TrainingSession } from './models'
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

  return {
    topicPracticeCount,
    totalPracticeCount: sessions.length,
    commonProblemThemes,
    recentStrengths,
    reusableExpressions,
    relevantMaterials,
  }
}

/**
 * 跨题复用匹配:同题 > 同 topic > 共享实义词 > 同 Part。
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
      if (expression.questionId.startsWith(`p${question.part}-`)) {
        score += 3
      }
      score += Math.min(10, expression.reuseCount ?? 0)
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
    .map((material) => {
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
      return { material, score, reason }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.material.updatedAt.localeCompare(a.material.updatedAt))
    .slice(0, maximum)
    .map((item) => ({ ...item, reason: item.reason || '可用于本题的个人素材' }))
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
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

export interface MaterialSuggestionContext {
  /** 发送给 Text AI 的紧凑摘要;只含本机已持久化数据,≤1200 字符。 */
  digest: string
  /** 按练习次数排序的常练话题,供本地启发式降级使用。 */
  topics: Array<{ topic: string; count: number }>
}

/**
 * 为"一键提炼个人素材"聚合本地记忆:常练话题、老师反复指出的问题与亮点、
 * 个人语料按话题分组的代表句。隐私级别与 buildLearnerContext 一致。
 */
export function buildMaterialSuggestionContext(
  sessions: TrainingSession[],
  expressions: SavedExpression[],
  knownQuestions: Question[] = [],
): MaterialSuggestionContext {
  const questionsById = new Map(knownQuestions.map((item) => [item.id, item]))
  const topicCounts = new Map<string, number>()
  for (const session of sessions) {
    const topic = questionsById.get(session.questionId)?.topic?.trim()
    if (topic) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1)
    }
  }
  const topics = [...topicCounts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))

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
  for (const expression of expressions.slice(0, 60)) {
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

  return { digest: lines.join('\n').slice(0, 1_200), topics }
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
}> {
  const normalizedExisting = new Set(
    existingTitles.map((title) => title.trim().toLowerCase()),
  )
  const suggestions: Array<{
    title: string
    content: string
    kind: 'experience'
    topicTags: string[]
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
    })
  }
  return suggestions
}
