import type { Question } from './models'

/**
 * 小型本地 IELTS 教学 RAG。V1.8 刻意不用向量库/embedding API:
 * 知识库只有几十篇短文档,题库本身也是结构化文档,用“Part 匹配 +
 * 主题词重叠”的词汇检索已经足够稳定、零成本、离线可用。
 *
 * 内容为产品自己的教学原则与公开考试常识的转写,不包含任何分数
 * 评分标准表述,也不复制任何机构的版权材料。
 */

export interface TutorKnowledgeDoc {
  id: string
  /** all = 所有 Part;1/2/3 只适用于对应 Part。 */
  part: 'all' | 1 | 2 | 3
  title: string
  body: string
  /** 英文主题关键词,用于与题目 topic/prompt 匹配。 */
  keywords: string[]
  tags: string[]
}

export interface RetrievedKnowledgeDoc {
  doc: TutorKnowledgeDoc
  score: number
  reason: string
}

const DOCS: TutorKnowledgeDoc[] = [
  {
    id: 'part1-direct-answer',
    part: 1,
    title: 'Part 1 先直接回答，再补一句理由或例子',
    body: '先用一句话直接回答 yes/no 或给出明确选择，然后给一个简短理由或具体例子。2-4 句即可，不要背长答案。',
    keywords: ['hometown', 'study', 'work', 'weekend', 'music', 'weather', 'photo'],
    tags: ['part1', 'structure'],
  },
  {
    id: 'part1-everyday-vocabulary',
    part: 1,
    title: 'Part 1 用自己熟悉的日常词',
    body: '优先使用能脱口而出的日常表达；想换词时用具体动词或名词（如 unwind 替换 relax），不要为了高级而用不熟悉的难词。',
    keywords: ['food', 'clothes', 'shopping', 'reading', 'walking', 'hobby'],
    tags: ['part1', 'vocabulary'],
  },
  {
    id: 'part2-cue-points',
    part: 2,
    title: 'Part 2 按 cue points 顺序展开',
    body: '把每个提示点都覆盖到，按题目给的顺序说；每个点 2-4 句。准备时先想每个点的一个关键词，再自然扩展成短句。',
    keywords: ['describe', 'event', 'place', 'person', 'object'],
    tags: ['part2', 'structure'],
  },
  {
    id: 'part2-one-minute',
    part: 2,
    title: 'Part 2 一分钟准备只写关键词',
    body: '准备时间只写每个 cue point 的 1-2 个关键词和时态提示，不要写整句；回答时看关键词扩展，更像自然说话。',
    keywords: ['describe', 'event', 'place', 'person', 'object'],
    tags: ['part2', 'planning'],
  },
  {
    id: 'part3-opinion-reason-example',
    part: 3,
    title: 'Part 3 用“观点 + 原因 + 例子”推进',
    body: '先给出清楚立场，再说 1-2 个原因，最后给一个例子或比较。观点题不需要唯一正确答案，重要的是解释过程。',
    keywords: ['why', 'how', 'think', 'difference', 'should', 'important'],
    tags: ['part3', 'structure'],
  },
  {
    id: 'part3-general-language',
    part: 3,
    title: 'Part 3 尽量说一般人群，而不是只有“我”',
    body: '多使用 people / some people / in many cities 这类概括表达，并比较不同人群或过去与现在，展示抽象讨论能力。',
    keywords: ['people', 'young', 'old', 'country', 'city', 'government'],
    tags: ['part3', 'coherence'],
  },
  {
    id: 'tense-consistency',
    part: 'all',
    title: '讲过去经历时先定好时态',
    body: '讲故事前先决定整段主要用过去时；提到现在仍成立的事再切回一般现在时，切换要有理由。',
    keywords: ['time', 'childhood', 'before', 'event', 'movie', 'travel', 'experience'],
    tags: ['grammar', 'tenses'],
  },
  {
    id: 'articles-and-countables',
    part: 'all',
    title: '名词第一次出现注意冠词与单复数',
    body: '单数可数名词不要裸奔：第一次提到多用 a/an，特指或第二次提到用 the，复数记得加 s。',
    keywords: ['object', 'place', 'job', 'animal', 'technology', 'food', 'building'],
    tags: ['grammar', 'articles'],
  },
  {
    id: 'coherence-linking',
    part: 'all',
    title: '连接词少而自然',
    body: '用 because / so / but / also / for example 连接想法就足够；避免每句都加 first of all、moreover，那会像背模板。',
    keywords: ['why', 'explain', 'example', 'reason', 'because'],
    tags: ['coherence', 'linking'],
  },
  {
    id: 'natural-fillers',
    part: 'all',
    title: '停顿用自然小词，避免重复填充',
    body: '思考时可以用 well / you know / I mean / actually 承接，但同一句里不要连续用；宁可短暂停顿，也不要用 um、like 填满。',
    keywords: ['speaking', 'fluency', 'natural'],
    tags: ['fluency', 'fillers'],
  },
  {
    id: 'vocabulary-paraphrase',
    part: 'all',
    title: '不会的词就换一种说法',
    body: '口语中遇到不会的词，用“它能做什么/它属于哪类/什么感觉”来解释，比卡住或硬翻更自然。',
    keywords: ['describe', 'thing', 'object', 'place', 'experience'],
    tags: ['vocabulary', 'paraphrase'],
  },
  {
    id: 'personal-materials-reuse',
    part: 'all',
    title: '优先复用你自己说过的表达',
    body: '如果练习页展示了“可复用素材”，先读一遍，把适合当前题的句子直接放进回答里；自己的语言最容易再次说出口。',
    keywords: ['reuse', 'expression', 'memory', 'example'],
    tags: ['memory', 'reuse'],
  },
]

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'about', 'your', 'you', 'is', 'are', 'was', 'were', 'do', 'does',
  'did', 'have', 'has', 'had', 'it', 'this', 'that', 'what', 'when', 'where',
  'who', 'how', 'why', 'which', 'there', 'some', 'any', 'more', 'most',
])

export function retrieveTutorKnowledge(
  question: Question,
  maximum = 3,
): RetrievedKnowledgeDoc[] {
  const queryTokens = tokenize(
    `${question.topic} ${question.prompt} ${question.category ?? ''}`,
  )
  const scored = DOCS.map((doc) => {
    const partMatches = doc.part === 'all' || doc.part === question.part
    const keywordTokens = new Set(doc.keywords.flatMap((word) => tokenize(word)))
    const tagTokens = new Set(doc.tags.flatMap((word) => tokenize(word)))
    let score = partMatches ? 2 : -10
    for (const token of queryTokens) {
      if (keywordTokens.has(token)) score += 5
      if (tagTokens.has(token)) score += 2
    }
    const docTitleTokens = new Set(tokenize(`${doc.title} ${doc.body}`))
    for (const token of queryTokens) {
      if (docTitleTokens.has(token)) score += 1
    }
    return { doc, score, reason: partLabel(doc.part) }
  })

  return scored
    .filter((item) => item.score > 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, maximum)
    .map(({ doc, score, reason }) => ({
      doc,
      score,
      reason: reason === '通用'
        ? '通用表达建议'
        : `${reason} + 主题匹配`,
    }))
}

/** 给 Backend 的紧凑教学上下文;不包含用户答案,只含教学原则。 */
export function buildTutorContext(
  question: Question,
  maximum = 3,
): string {
  const docs = retrieveTutorKnowledge(question, maximum)
  if (docs.length === 0) return ''
  return docs
    .map((item) => `【${item.doc.title}】${item.doc.body}`)
    .join('\n')
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function partLabel(part: TutorKnowledgeDoc['part']): string {
  if (part === 'all') return '通用'
  return `Part ${part}`
}
