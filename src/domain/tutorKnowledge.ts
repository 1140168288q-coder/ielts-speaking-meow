import type { Question } from './models'
export const TUTOR_KNOWLEDGE_VERSION = '2026.08-v2'
export type TutorKnowledgeSource = 'official-guidance' | 'product-authored'

/**
 * 小型本地 IELTS 教学 RAG。V2.0 刻意不用向量库/embedding API:
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
  source: TutorKnowledgeSource
  sourceUrl?: string
  reviewedAt: string
}

export interface RetrievedKnowledgeDoc {
  doc: TutorKnowledgeDoc
  score: number
  reason: string
}

type TutorKnowledgeSeed = Omit<
  TutorKnowledgeDoc,
  'source' | 'reviewedAt'
> & Partial<Pick<TutorKnowledgeDoc, 'source' | 'reviewedAt'>>

const RAW_DOCS: TutorKnowledgeSeed[] = [
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
    id: 'part1-frequency-example',
    part: 1,
    title: '谈习惯时加频率和真实场景',
    body: '不要只说 I like it。补充 how often、when 或 who with，例如每周末、下班后或和室友一起，让短回答也有个人信息。',
    keywords: ['often', 'usually', 'weekend', 'daily', 'habit', 'free time'],
    tags: ['part1', 'development'],
  },
  {
    id: 'part1-past-and-now',
    part: 1,
    title: '变化题用“过去—现在—原因”',
    body: '遇到 used to、when you were a child 或 changed 这类问题，先说过去，再说现在，最后用一句话解释变化原因。',
    keywords: ['childhood', 'change', 'used', 'before', 'now', 'young'],
    tags: ['part1', 'comparison'],
  },
  {
    id: 'part1-specific-example',
    part: 1,
    title: '理由后面放一个很小的例子',
    body: '例子不需要完整故事；一个地点、一次最近经历或一个具体物品，就能让回答更可信、更容易继续说。',
    keywords: ['why', 'favorite', 'prefer', 'like', 'enjoy', 'example'],
    tags: ['part1', 'example'],
  },
  {
    id: 'part2-timeline',
    part: 2,
    title: '经历题用清楚的时间线',
    body: '按 before、during、after 三段组织经历。每段只保留一个关键动作和感受，避免想到哪里说到哪里。',
    keywords: ['experience', 'event', 'trip', 'time', 'occasion', 'happened'],
    tags: ['part2', 'story'],
  },
  {
    id: 'part2-person-details',
    part: 2,
    title: '人物题选择能证明特点的细节',
    body: '先说明关系和认识方式，再讲一个具体行为来证明这个人的特点；不要连续罗列 kind、friendly、helpful 等形容词。',
    keywords: ['person', 'friend', 'family', 'teacher', 'someone', 'people'],
    tags: ['part2', 'person'],
  },
  {
    id: 'part2-place-details',
    part: 2,
    title: '地点题把空间和活动连起来',
    body: '说清位置、最显眼的区域以及你在那里做什么。用光线、声音、距离等一两个细节即可，不必堆很多形容词。',
    keywords: ['place', 'city', 'building', 'park', 'home', 'shop'],
    tags: ['part2', 'place'],
  },
  {
    id: 'part2-object-details',
    part: 2,
    title: '物品题围绕用途和个人意义',
    body: '介绍来源、外观或使用方式后，重点解释它为什么对你有用或有意义。个人联系比产品说明更适合口语。',
    keywords: ['object', 'thing', 'gift', 'technology', 'clothes', 'book'],
    tags: ['part2', 'object'],
  },
  {
    id: 'part2-avoid-memorised-script',
    part: 2,
    title: '准备结构，不背整篇固定答案',
    body: '固定稿很难自然适配不同 cue points。只复用自己的经历、短语和故事模块，并在当前题目下重新组织。',
    keywords: ['describe', 'cue', 'answer', 'prepare', 'topic'],
    tags: ['part2', 'planning', 'memory'],
    source: 'official-guidance',
    sourceUrl: 'https://ielts.org/news-and-insights/dont-overdo-it-how-to-ace-your-ielts-speaking-test',
  },
  {
    id: 'part3-cause-effect',
    part: 3,
    title: '原因题补上结果链条',
    body: '给出原因后继续说 therefore 或 this means，说明它会影响谁、造成什么结果；不要只列两个没有解释的原因。',
    keywords: ['why', 'cause', 'effect', 'result', 'influence', 'impact'],
    tags: ['part3', 'reasoning'],
  },
  {
    id: 'part3-compare-groups',
    part: 3,
    title: '比较题先确定同一个比较维度',
    body: '比较年轻人与老年人、城市与乡村时，选择便利、成本或习惯等同一维度，再解释差异，避免两个段落各说各的。',
    keywords: ['difference', 'compare', 'young', 'old', 'city', 'country'],
    tags: ['part3', 'comparison'],
  },
  {
    id: 'part3-balanced-position',
    part: 3,
    title: '可以承认例外，但立场仍要清楚',
    body: '先说主要判断，再用 although 或 it depends 补充条件，最后回到你的总体观点。平衡不等于模糊。',
    keywords: ['agree', 'should', 'better', 'important', 'depends', 'opinion'],
    tags: ['part3', 'position'],
  },
  {
    id: 'part3-solutions-tradeoff',
    part: 3,
    title: '解决方案要说明执行者和代价',
    body: '提出方案时说明谁来做、怎样做、可能有什么限制。一个解释完整的方案比三个口号更有说服力。',
    keywords: ['solution', 'solve', 'government', 'problem', 'improve', 'should'],
    tags: ['part3', 'solution'],
  },
  {
    id: 'part3-careful-generalisation',
    part: 3,
    title: '不确定时使用有分寸的概括',
    body: '用 many、some、tend to、in my experience 限定范围，避免把个人例子说成所有人的事实。',
    keywords: ['people', 'society', 'always', 'everyone', 'generally', 'country'],
    tags: ['part3', 'accuracy'],
  },
  {
    id: 'subject-verb-agreement',
    part: 'all',
    title: '长句先守住主语和谓语',
    body: '说长句前先确定真正主语是单数还是复数，再选择 is/are、has/have 或动词形式；其余细节可以拆成下一句。',
    keywords: ['people', 'technology', 'government', 'family', 'activity'],
    tags: ['grammar', 'agreement'],
  },
  {
    id: 'natural-self-repair',
    part: 'all',
    title: '说错时短修正，然后继续',
    body: '可以用 I mean 或 rather 立刻替换一个词，不必从整句开头重来。一次简短修正比反复重启更自然。',
    keywords: ['answer', 'explain', 'experience', 'speaking'],
    tags: ['coherence', 'repair'],
  },
  {
    id: 'collocation-first',
    part: 'all',
    title: '记短语搭配，不孤立记难词',
    body: '优先保存 make a decision、heavy traffic、keep in touch 这类可直接复用的搭配，并用自己的经历造句。',
    keywords: ['work', 'traffic', 'friend', 'decision', 'communication'],
    tags: ['vocabulary', 'collocation', 'memory'],
  },
  {
    id: 'specific-verbs',
    part: 'all',
    title: '用具体动词替换空泛的 do 和 make',
    body: '复盘时只挑一两个高频空泛动词，换成适合场景的 commute、organise、recommend、repair 等具体动词。',
    keywords: ['work', 'travel', 'activity', 'technology', 'service'],
    tags: ['vocabulary', 'precision'],
  },
  {
    id: 'topic-technology',
    part: 'all',
    title: '科技题从使用场景谈影响',
    body: '先说谁在什么场景使用，再讨论它节省的时间、带来的便利或代价；避免只说 technology is important。',
    keywords: ['technology', 'internet', 'phone', 'computer', 'online', 'app'],
    tags: ['topic', 'technology'],
  },
  {
    id: 'topic-environment',
    part: 'all',
    title: '环境题连接个人选择和公共措施',
    body: '个人习惯适合举小例子，基础设施和法规适合解释更大影响；说明两者如何配合。',
    keywords: ['environment', 'pollution', 'waste', 'recycle', 'nature', 'energy'],
    tags: ['topic', 'environment'],
  },
  {
    id: 'topic-work-study',
    part: 'all',
    title: '工作学习题用真实任务来展开',
    body: '与其罗列 useful、busy，不如说一次课程、项目、截止日期或团队合作，并说明它带来的具体感受或变化。',
    keywords: ['work', 'study', 'school', 'job', 'teacher', 'student'],
    tags: ['topic', 'work', 'study'],
  },
  {
    id: 'topic-transport',
    part: 'all',
    title: '交通题比较时间、成本和可达性',
    body: '选一到两个维度比较公共交通和私家车，再结合所在城市的真实距离或拥堵情况。',
    keywords: ['transport', 'traffic', 'bus', 'train', 'car', 'travel'],
    tags: ['topic', 'transport'],
  },
  {
    id: 'topic-culture-media',
    part: 'all',
    title: '文化媒体题给出具体内容和受众',
    body: '说清是哪种节目、传统、书或音乐，以及哪些人为什么会接触它，避免把 culture 或 media 当成空泛整体。',
    keywords: ['culture', 'tradition', 'media', 'movie', 'music', 'book'],
    tags: ['topic', 'culture', 'media'],
  },
  {
    id: 'topic-health-lifestyle',
    part: 'all',
    title: '健康题聚焦可持续的小习惯',
    body: '用睡眠、步行、饮食或运动的真实频率说明习惯，再谈现实限制，不提供医疗结论。',
    keywords: ['health', 'exercise', 'sport', 'food', 'sleep', 'walking'],
    tags: ['topic', 'health', 'lifestyle'],
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
const DOCS: readonly TutorKnowledgeDoc[] = RAW_DOCS.map((seed) => {
  const {
    source = 'product-authored',
    reviewedAt = '2026-08-24',
    ...doc
  } = seed
  return { ...doc, source, reviewedAt }
})

export function listTutorKnowledgeDocuments(): readonly TutorKnowledgeDoc[] {
  return DOCS
}

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
