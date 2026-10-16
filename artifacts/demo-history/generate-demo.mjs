import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const root = new URL('../../', import.meta.url)
const questions = JSON.parse(readFileSync(new URL('src/data/questionBank.generated.json', root), 'utf8')).questions
const ownerId = '6f081750-553d-42d0-903c-246891187218'
const prefix = 'demo-20260918'
const exportedAt = '2026-09-18T02:00:00.000Z'
// All answers, feedback, facts and apparent past dates are fictional demonstration fixtures.
const rows = [
  ['p1-where-is-your-hometown-001', '家乡杭州',
    'My hometown is Hangzhou. It have a beautiful lake. I like walk there with my family.',
    'My hometown is Hangzhou. It has a beautiful lake. I like walking there with my family.',
    'I come from Hangzhou, a city in eastern China. I especially like West Lake because my family and I often walks there on weekends.',
    'my family and I often walks', 'my family and I often walk',
    '家乡是杭州，喜欢与家人在西湖散步。', 'I come from Hangzhou, a city in eastern China.', 'place',
    '先直接交代家乡；第三人称单数用 has，like 后用 walking。'],
  ['p1-do-you-like-reading-001', '睡前阅读',
    'Yes, I like read short stories. I read before bed because it help me relax.',
    'Yes, I like reading short stories. I read before bed because it helps me relax.',
    'Yes, I enjoy reading short stories before bed. I usually spend twenty minutes on a book because it help me switch off after studying.',
    'it help me', 'it helps me',
    '喜欢睡前读二十分钟短篇故事。', 'I enjoy reading short stories before bed.', 'experience',
    'like 后用 reading；it 作主语时用 helps。'],
  ['p1-do-you-still-like-going-to-parks-now-001', '公园散步',
    'Yes, I still likes parks. I go there on weekends. The trees makes me feel calm.',
    'Yes, I still like parks. I go there on weekends. The trees make me feel calm.',
    'Yes, I often visit a park near my university on weekends. Walking under the trees give me a break from my screen, especially after a busy week.',
    'Walking under the trees give', 'Walking under the trees gives',
    '周末会去大学附近的公园散步。', 'I often visit a park near my university on weekends.', 'experience',
    'I 后用 like，复数主语 trees 后用 make。'],
  ['p1-what-technology-do-you-use-when-you-study-001', '学习工具',
    'I use a laptop for take notes. It help me find information and keep my files together.',
    'I use a laptop for taking notes. It helps me find information and keep my files together.',
    'I mainly use a laptop to take notes and organise reading materials. Keeping my files in one place make it easier to review before exams.',
    'Keeping my files in one place make', 'Keeping my files in one place makes',
    '学习时用笔记本电脑记笔记和整理阅读资料。', 'I mainly use a laptop to take notes and organise reading materials.', 'experience',
    'for 后用 taking；it 作主语时用 helps。'],
  ['p1-do-you-have-any-hobbies-001', '周日羽毛球',
    'I like play badminton. I play it with my roommate on Sunday. It make me relaxed.',
    'I like playing badminton. I play it with my roommate on Sundays. It helps me relax.',
    'Yes, I enjoy playing badminton. My roommate and I play at the campus gym on Sundays. It helps me relax after studying, and we usually plays for an hour.',
    'we usually plays', 'we usually play',
    '周日与室友在校园体育馆打羽毛球。', 'My roommate and I play at the campus gym on Sundays.', 'experience',
    'like 后用 playing；用 helps me relax 表达放松。'],
  ['p1-do-you-have-the-same-hobbies-as-your-family--001', '家人的爱好',
    'Not really. My parents likes walking, but I prefer badminton. We sometimes walk together.',
    'Not really. My parents like walking, but I prefer badminton. We sometimes walk together.',
    'Not exactly. My parents prefer walking, while I enjoy badminton. We still takes a walk together when I visit home, so we have something to share.',
    'We still takes', 'We still take',
    '父母喜欢散步，回家时会与他们一起走走。', 'My parents prefer walking, while I enjoy badminton.', 'preference',
    'parents 是复数，后面用 like；用 while 连接不同喜好。'],
  ['p2-describe-a-friend-from-your-childhood-001', '童年朋友小宇',
    'I want to talk about Xiaoyu. We meet in primary school. He was kind and we played badminton. He help me when I was nervous about a class presentation. We still talk online.',
    'I want to talk about Xiaoyu. We met in primary school. He was kind and we played badminton. He helped me when I was nervous about a class presentation. We still talk online.',
    'I would like to talk about Xiaoyu, a friend I met in primary school. We sat next to each other and started chatting during breaks. He was patient and always willing to listen. One memory that stands out is preparing a class presentation together. I was worried about forgetting my ideas, so he helped me practise after school. We also played badminton in a small playground near our homes. We went to different universities later, but we still sends each other messages. What I value most is that I can talk honestly with him. Even a short conversation makes me feel supported.',
    'we still sends', 'we still send',
    '小学认识朋友小宇，对方曾帮助自己准备课堂展示。', 'I would like to talk about Xiaoyu, a friend I met in primary school.', 'person',
    '叙述童年经历用 met 和 helped；再补一个支持朋友特点的具体事件。'],
  ['p3-has-technology-changed-people-s-friendships--001', '科技与友谊',
    'Yes, technology make it easier to contact friends. People can send messages. But online talk cannot replace meet in person.',
    'Yes, technology makes it easier to contact friends. People can send messages. But talking online cannot replace meeting in person.',
    'Yes, technology makes it easier to stay in touch, especially when friends live in different cities. However, short messages sometimes causes misunderstandings. I think online contact works best when people also make time to meet in person.',
    'short messages sometimes causes', 'short messages sometimes cause',
    '认为线上联系有帮助，但仍需要面对面相处。', 'I think online contact works best when people also make time to meet in person.', 'opinion',
    'technology 作主语时用 makes；replace 后用 meeting。'],
]

const backup = {
  format: 'ielts-speaking-meow-backup', formatVersion: 3, exportedAt,
  accounts: [{ id: prefix + '-account', userId: ownerId, displayName: '录屏演示（虚构数据）',
    pinHash: null, cloudAccountId: null, createdAt: '2026-09-10T09:00:00.000Z', lastLoginAt: exportedAt }],
  currentAccountId: null, sessions: [], expressions: [], audio: [],
  personalMaterials: [], importSources: [], importedQuestions: [], importedFiles: [],
  knowledgeSources: [], knowledgeEntries: [], knowledgeFiles: [],
}
rows.forEach((r, i) => {
  const [qid, title, first, minimal, second, bad, good, fact, sourceSentence, kind, advice] = r
  const q = questions.find(q => q.id === qid)
  if (!q) throw new Error('Missing question ' + qid)
  const day = String(10 + i).padStart(2, '0')
  const start = '2026-09-' + day + 'T09:00:00.000Z'
  const end = '2026-09-' + day + 'T09:08:00.000Z'
  const id = prefix + '-session-' + (i + 1)
  const corrected = second.replace(bad, good)
  if (corrected === second || !second.includes(sourceSentence)) throw new Error('Invalid fixture ' + qid)
  const candidate = { content: fact, kind, topicTags: [q.topic, title], sourceSentence, sourcePart: q.part }
  const attempt = (text, n, at) => ({
    id: id + '-attempt-' + n, attemptNumber: n, audio: null,
    transcript: { status: 'ready', text, originalText: null, source: 'manual', errorCode: null, updatedAt: at },
    metrics: { durationMs: 0, wordCount: text.trim().split(/\s+/).length, wordsPerMinute: null,
      fillerWords: [], fillerCount: 0, repeatedWords: [], repeatedWordCount: 0,
      caveats: ['虚构演示样例；未采集录音或真实作答时间。'] },
    createdAt: at, updatedAt: at,
  })
  const correction = { original: second.split(/(?<=[.!?])\s+/).find(s => s.includes(bad)),
    corrected: corrected.split(/(?<=[.!?])\s+/).find(s => s.includes(good)),
    reason: '核对主语与动词形式，保留原句事实。' }
  backup.sessions.push({
    id, ownerId, questionId: q.id, questionSnapshot: q, part: q.part, status: 'completed',
    attempts: [attempt(first, 1, start), attempt(second, 2, end)], localFeedback: [],
    aiFeedback: {
      summary: '【虚构演示反馈，非真实模型调用】先修正动词形式，再用一个具体细节展开回答。',
      strengths: ['已经直接回应题目。', '内容有清楚的个人视角。'],
      problems: ['部分动词形式需要调整。', '可以用一个具体细节说明原因。'],
      grammarSuggestions: [advice], vocabularySuggestions: ['选用自己容易复用的短表达，不必堆叠复杂词汇。'],
      referenceAnswers: [{ label: '简单优化版', text: minimal }, { label: '自然提升版', text: corrected }],
      naturalUpgradeSuggestions: { addableContent: [{ content: '可补充一个时间、场景或具体原因；以下拓展属于虚构演示角色，请替换为自己的经历。',
        source: 'ai_example', sourcePart: null, replaceable: true }],
        advancedChanges: ['把观点与原因连接起来，让内容更完整。'] },
      answerFramework: [{ label: '直接回应', template: '先用一句话回答当前题目。' },
        { label: '具体展开', template: '补充一个真实细节，再说明原因或感受。' }], contextReferences: [],
    },
    feedbackGenerationProfile: { level: 'medium', style: 'british', profileVersion: 1 },
    secondAttemptAnalysis: { correctedSentences: [correction], memoryCandidates: [candidate] },
    confirmedMemoryFacts: [{ ...candidate, id: prefix + '-fact-' + i, sourceAttempt: 2, createdAt: end }],
    comparison: null, createdAt: start, updatedAt: end,
  })
  for (const [j, text] of [sourceSentence, correction.corrected].entries()) {
    backup.expressions.push({ id: prefix + '-expression-' + i + '-' + j, ownerId, text, topic: q.topic,
      sourcePart: q.part, questionId: q.id, sessionId: id, sourceAttempt: 2,
      createdAt: end, updatedAt: end, reviewCount: 0, reuseCount: 0 })
  }
  backup.personalMaterials.push({ id: prefix + '-material-' + i, ownerId, title: title + '（演示）',
    content: '【虚构演示角色素材】' + fact + '\n' + corrected,
    kind: kind === 'preference' ? 'opinion' : kind, sourcePart: q.part, topicTags: [q.topic, title],
    questionIds: [q.id], sourceSessionId: id, status: 'confirmed', createdAt: end, updatedAt: end, version: 1, deletedAt: null })
})

const notes = [
  ['爱好题：回答与原因', 'Hobby', '先直接说出爱好，再说明与谁、何时或为什么。只使用自己真实的经历。', ['hobbies', 'badminton', 'hobby'], 1],
  ['家乡题：一个具体细节', 'Hometown', '介绍家乡后选择一个地点或生活细节展开，避免罗列太多景点。', ['hometown', 'city', 'lake'], 1],
  ['人物题：用事件说明特点', 'friend from your childhood', '先交代如何认识，再通过一件具体小事说明朋友的特点，最后说明现在的关系。', ['friend', 'childhood', 'person'], 2],
  ['观点题：观点与限制', 'Technology', '先提出观点，给出一个原因或例子，再用一句话说明限制条件。', ['technology', 'friendships', 'contact'], 3],
]
const text = '# 录屏演示教学笔记\n\n自写演示资料，不代表用户经历。\n\n' + notes.map(n => '## ' + n[0] + '\n' + n[2]).join('\n\n')
const bytes = Buffer.from(text, 'utf8')
const sid = prefix + '-knowledge-source'
backup.knowledgeSources.push({ id: sid, ownerId, fileName: '演示教学笔记.md', mimeType: 'text/markdown',
  fileSize: bytes.length, format: 'md', extractionMode: 'plain-text', originalFileId: prefix + '-knowledge-file',
  sourceSha256: createHash('sha256').update(bytes).digest('hex'), title: '录屏演示教学笔记（自写样例）',
  status: 'ready', entryCount: notes.length, importedAt: exportedAt, updatedAt: exportedAt, deletedAt: null })
backup.knowledgeFiles.push({ id: prefix + '-knowledge-file', mimeType: 'text/markdown', dataBase64: bytes.toString('base64') })
notes.forEach((n, i) => backup.knowledgeEntries.push({
  id: prefix + '-knowledge-' + i, sourceId: sid, ownerId, title: n[0], body: n[2], originalExcerpt: n[2],
  sourcePage: null, sourceSection: n[0], part: n[4], topics: [n[1]], keywords: n[3], tags: ['演示资料'],
  functions: ['structure', 'topic'], level: 'developing', confidence: 'high', enabled: true,
  createdAt: exportedAt, updatedAt: exportedAt, deletedAt: null,
}))
writeFileSync(new URL('ielts-meow-demo-history-v2.2.2.json', import.meta.url), JSON.stringify(backup, null, 2) + '\n')
writeFileSync(new URL('演示教学笔记.md', import.meta.url), text)
console.log(JSON.stringify({ sessions: backup.sessions.length, expressions: backup.expressions.length,
  materials: backup.personalMaterials.length, facts: rows.length, knowledge: notes.length }))
