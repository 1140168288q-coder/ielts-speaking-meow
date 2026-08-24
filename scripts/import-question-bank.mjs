/**
 * 内置题库更新流水线(dev-time,非运行时):
 *
 *   npm run question-bank:update -- "<新季度题库.pdf 或 .json 路径>"
 *
 * 自动从新航道《雅思口语新题库》这类 PDF 中提取文本,解析成结构化题库
 * (Part 1/2/3、topic、new/old、Part 2 cue points、Part 2↔Part 3 关联),
 * 校验完整后覆盖 src/data/questionBank.generated.json。
 *
 * 换季度时无需手工改业务代码:题库模块只读取生成文件。若未来 PDF 排版
 * 变化,也只需在这个解析器里增加一个适配函数,不要改 UI 或练习服务。
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'src', 'data', 'questionBank.generated.json')
const PARSER_VERSION = '2.2.0'
const BUILT_IN_SOURCE = '雅思口语喵内置题库'

const ALLOWED_CATEGORIES = {
  1: new Set(['必考话题', '高频话题', 'PLACE', 'OBJECTS', 'EVENTS', 'ABSTRACT']),
  2: new Set(['PLACE', 'PEOPLE', 'OBJECTS', 'EVENTS']),
  3: new Set(['PLACE', 'PEOPLE', 'OBJECTS', 'EVENTS']),
}

const MINIMUM_COUNTS = { 1: 20, 2: 30, 3: 100 }

const HEADER_LINES = new Set([
  '新航道国际教育集团教学与考试研究院',
  'Institute of Teaching and Examinations, New Channel International Education Group',
  '打造具有新航道学术基因的教学团队！',
  '目',
  '录',
])

const CUE_STARTERS = /^(And|How|What|When|Which|Who|Where|Why|Whether)\b/i
const INTERNAL_CUE_BOUNDARY = /\s+(?=(?:And explain|How|What|When|Which|Who|Where|Why|Whether)\b)/g
const DANGLING_TOPIC_WORDS = new Set([
  'a', 'an', 'the',
  'and', 'or', 'but', 'nor', 'so', 'yet', 'than',
  'of', 'to', 'in', 'on', 'at', 'for', 'from', 'with', 'by', 'about',
  'into', 'over', 'under', 'between', 'among', 'during', 'before', 'after',
  'without', 'within', 'as', 'through', 'across', 'around', 'against',
  'toward', 'towards',
])

function main() {
  const input = process.argv[2]
  if (!input) {
    throw new Error('用法: npm run question-bank:update -- "<题库.pdf 或题库.json>"')
  }
  run(input).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  })
}

async function run(inputPath) {
  const absolute = path.resolve(ROOT, inputPath)
  const isJson = absolute.toLowerCase().endsWith('.json')
  const sourceBytes = await readFile(absolute)
  const questions = isJson
    ? parseJsonQuestions(JSON.parse(sourceBytes.toString('utf8')))
    : await parsePdfQuestions(sourceBytes)

  const report = validate(questions)
  const sourceName = path.basename(absolute)
  const document = {
    format: 'ielts-speaking-meow-question-bank',
    formatVersion: 2,
    parserVersion: PARSER_VERSION,
    seasonLabel: inferSeasonLabel(sourceName),
    sourceFile: sourceName,
    sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
    generatedAt: new Date().toISOString(),
    counts: report.counts,
    questions,
  }
  await writeFile(OUTPUT, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  console.log(`已生成 ${OUTPUT}`)
  console.log(
    `P1 ${report.counts[1]} 题(必考+高频)、P2 ${report.counts[2]} 题、` +
    `P3 ${report.counts[3]} 题;关联 Part 3 ${report.linkedPart3} 条。`,
  )
}

function inferSeasonLabel(fileName) {
  const match = fileName.match(/(20\d{2})[年\-_](\d{1,2})/)
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}`
  }
  const yearMonth = fileName.match(/(20\d{2})\D+(\d{1,2})月/)
  if (yearMonth) {
    return `${yearMonth[1]}-${yearMonth[2].padStart(2, '0')}`
  }
  return fileName.replace(/\.pdf$/i, '').trim()
}

function parseJsonQuestions(raw) {
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw?.questions)) return raw.questions
  throw new Error('JSON 题库文件必须是问题数组或 { questions: [...] }。')
}

async function parsePdfQuestions(buffer) {
  const lines = await extractPdfLines(buffer)
  const parser = createParser(lines)
  return parser.parse()
}

async function extractPdfLines(buffer) {
  const data = new Uint8Array(buffer)
  const document = await getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise
  const lines = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    let current = ''
    const flush = () => {
      const clean = current.trim()
      if (clean.length > 0) lines.push(clean)
      current = ''
    }
    for (const item of content.items) {
      if (!('str' in item)) continue
      current += item.str
      if (item.hasEOL) flush()
    }
    flush()
  }
  if (typeof document.destroy === 'function') {
    await document.destroy()
  }
  return lines
}

function createParser(rawLines) {
  const lines = rawLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isIgnorableLine(line))
  const bodyPart2Headings = findBodyPart2Headings(lines)

  const questions = []
  const usedIds = new Set()
  const allocateId = (part, prompt) => {
    const base = stableId(part, prompt)
    let candidate = base
    let counter = 2
    while (usedIds.has(candidate)) {
      candidate = `${base}-${String(counter).padStart(3, '0')}`
      counter += 1
    }
    usedIds.add(candidate)
    return candidate
  }
  let mode = 'preamble'
  let currentCategory = null
  let currentTopic = null
  let currentTopicIsNew = null
  let currentPart2 = null
  let pendingPart2Prompt = null
  let pendingPart2IsNew = null
  let currentPart3 = null
  let pendingText = null
  let skipPart2Index = false

  const flushPendingInto = (target) => {
    if (pendingText !== null) {
      if (target.prompt.length > 0 && !endsWithSpace(target.prompt)) {
        target.prompt += ' '
      }
      target.prompt += pendingText
      pendingText = null
    }
  }

  const startPart2 = (rawPrompt) => {
    endPart3Block()
    flushCurrentPart2()
    currentPart2 = null
    pendingPart2Prompt = rawPrompt
    pendingPart2IsNew = null
    currentPart3 = null
  }

  const finalizePart2 = () => {
    if (pendingPart2Prompt === null) return
    const prompt = cleanPrompt(pendingPart2Prompt)
    if (prompt.length === 0) {
      pendingPart2Prompt = null
      return
    }
    const id = allocateId(2, prompt)
    currentPart2 = {
      id,
      part: 2,
      topic: part2Topic(prompt),
      prompt,
      difficulty: 'developing',
      source: BUILT_IN_SOURCE,
      category: currentCategory ?? 'Part 2',
      isNew: pendingPart2IsNew ?? false,
      cuePoints: [],
      relatedPart3Ids: [],
    }
    questions.push(currentPart2)
    pendingPart2Prompt = null
    pendingPart2IsNew = null
  }

  const flushCurrentPart2 = () => {
    if (pendingPart2Prompt !== null) finalizePart2()
  }

  const flushPart3Question = () => {
    if (currentPart3 === null) return
    if (currentPart3.prompt.trim().length > 0) {
      currentPart3.id = allocateId(3, currentPart3.prompt)
      questions.push(currentPart3)
      if (currentPart2 !== null) {
        currentPart2.relatedPart3Ids.push(currentPart3.id)
      }
    }
    currentPart3 = null
  }

  const startPart3Question = (rawPrompt) => {
    flushPart3Question()
    if (currentPart2 === null) return
    const prompt = cleanPrompt(rawPrompt)
    if (prompt.length === 0) return
    currentPart3 = {
      id: null,
      part: 3,
      topic: currentPart2.topic,
      prompt,
      difficulty: 'stretch',
      source: BUILT_IN_SOURCE,
      category: currentPart2.category,
      isNew: currentPart2.isNew,
      part2QuestionId: currentPart2.id,
    }
  }

  const endPart3Block = () => {
    flushPart3Question()
    pendingText = null
  }

  for (const [lineIndex, line] of lines.entries()) {
    const category = readCategory(line)
    if (category !== null) {
      currentCategory = category
      continue
    }

    if (line === 'IELTS Speaking Part 1') {
      mode = 'part1'
      currentCategory = null
      currentTopic = null
      currentPart2 = null
      currentPart3 = null
      pendingText = null
      continue
    }

    if (line === 'IELTS Speaking Part 2&3') {
      mode = 'part2'
      currentCategory = null
      currentTopic = null
      currentPart2 = null
      currentPart3 = null
      pendingText = null
      continue
    }

    if (mode === 'preamble') continue

    if (mode === 'part1') {
      const topicHeading = readTopicHeading(line)
      if (topicHeading !== null) {
        pendingText = null
        currentTopic = topicHeading.name
        currentTopicIsNew = topicHeading.isNew
        continue
      }

      const questionNumber = readQuestionNumber(line)
      if (questionNumber !== null) {
        pendingText = questionNumber.text
        questions.push({
          id: null,
          part: 1,
          topic: currentTopic ?? 'Part 1',
          prompt: questionNumber.text,
          difficulty: 'foundation',
          source: BUILT_IN_SOURCE,
          category: currentCategory ?? '必考话题',
          isNew: currentTopicIsNew ?? false,
        })
        pendingText = questionNumber.text
        continue
      }

      // 非编号行:可能是题目的续行,也可能是 Work/Study 这类子标题。
      if (pendingText !== null && isQuestionContinuation(line)) {
        pendingText = `${pendingText} ${line}`.trim()
        const previous = questions[questions.length - 1]
        if (previous?.part === 1) {
          previous.prompt = pendingText
        }
      }
      continue
    }

    // ---- Part 2&3 ----
    const isBodyPart2Heading = bodyPart2Headings.has(lineIndex)
    if (readPart2Heading(line) !== null && !isBodyPart2Heading) {
      // 每个分类前的目录页:只列标题、后文没有 "You should say:"。
      skipPart2Index = true
      continue
    }
    if (skipPart2Index) {
      if (isBodyPart2Heading || line === 'You should say:') {
        skipPart2Index = false
      } else {
        continue
      }
    }

    const part2Heading = isBodyPart2Heading ? readPart2Heading(line) : null
    if (part2Heading !== null) {
      startPart2(part2Heading.prompt)
      pendingPart2IsNew = part2Heading.isNew
      pendingText = null
      if (part2Heading.isNew !== null) {
        finalizePart2()
      }
      continue
    }

    // 卡标题可能跨行,下一行以 [new]/[old] 结束。
    if (pendingPart2Prompt !== null && currentPart2 === null) {
      const marker = readNewOldMarker(line)
      if (marker !== null) {
        pendingPart2Prompt = `${pendingPart2Prompt} ${stripMarker(line)}`.trim()
        pendingPart2IsNew = marker === 'new'
        finalizePart2()
        pendingText = null
        continue
      }
      if (/^You should say:$/.test(line)) {
        finalizePart2()
        pendingText = null
        continue
      }
      // 续行(如 "nd to others[new]"/"garden[new]"):逐词拼接。
      pendingPart2Prompt = `${pendingPart2Prompt} ${line}`.trim()
      pendingText = null
      continue
    }

    if (currentPart2 !== null) {
      if (line === 'You should say:') {
        endPart3Block()
        pendingText = null
        continue
      }
      if (line === 'Part 3') {
        endPart3Block()
        pendingText = null
        continue
      }

      const part3Number = readQuestionNumber(line)
      if (part3Number !== null) {
        endPart3Block()
        startPart3Question(part3Number.text)
        pendingText = part3Number.text
        continue
      }

      // cue bullet(仅在“You should say:”与“Part 3”之间,且当前无 P3 题目)
      if (currentPart3 === null && CUE_STARTERS.test(line)) {
        if (!line.toLowerCase().startsWith('part')) {
          currentPart2.cuePoints.push(cleanPrompt(line))
          pendingText = line
          continue
        }
      }

      if (currentPart3 !== null && pendingText !== null) {
        pendingText = `${pendingText} ${line}`.trim()
        currentPart3.prompt = cleanPrompt(pendingText)
        continue
      }

      if (pendingText !== null && currentPart2 !== null) {
        const last = currentPart2.cuePoints[currentPart2.cuePoints.length - 1]
        if (last !== undefined && !last.toLowerCase().startsWith('part')) {
          currentPart2.cuePoints[currentPart2.cuePoints.length - 1] =
            `${last} ${line}`.trim()
        }
      }
      continue
    }

    // 在卡片间隙出现的说明/续行(例如 Part 3 问题跨页)尝试并入最后一条 P3。
    const previous = questions[questions.length - 1]
    if (previous?.part === 3 && isQuestionContinuation(line)) {
      previous.prompt = `${previous.prompt} ${line}`.trim()
    }
  }

  flushPart3Question()
  flushCurrentPart2()

  // Part 2 与 Part 3 在解析过程中已分配 id;Part 1 在这里补上。
  for (const question of questions) {
    if (question.id === null) {
      question.id = allocateId(question.part, question.prompt)
    }
  }

  // 只规范化来源中真实存在的 cue points。缺失时由 validate 直接失败，
  // 绝不能静默补写并不存在于原 PDF 的提示。
  for (const question of questions) {
    if (question.part === 2) {
      question.cuePoints = question.cuePoints
        .flatMap((point) => splitCuePoints(point))
        .filter(Boolean)
        .slice(0, 6)
    }
  }

  return { parse: () => questions }
}

function isIgnorableLine(line) {
  if (HEADER_LINES.has(line)) return true
  if (/^Warning:/.test(line)) return true
  if (/^@@PAGE/.test(line)) return true
  // 目录引导点线、页码与孤立的小节词
  if (/\.{5,}/.test(line)) return true
  if (/^\d{1,3}$/.test(line)) return true
  return false
}

function readCategory(line) {
  const normalized = line.trim().toUpperCase()
  if (['PLACE', 'OBJECT', 'OBJECTS', 'EVENT', 'EVENTS', 'PEOPLE', 'ABSTRACT'].includes(normalized)) {
    return normalized === 'OBJECT' ? 'OBJECTS' : normalized === 'EVENT' ? 'EVENTS' : normalized
  }
  if (normalized === '必考话题') return '必考话题'
  if (normalized === '高频话题') return '高频话题'
  return null
}

function readTopicHeading(line) {
  const match = line.match(/^(\d+)\.\s+(.+?)\s*\[(new|old)\]\s*$/i)
  if (!match) return null
  const name = cleanPrompt(match[2])
  // Work or Studies 内部还有 Work / Study 子标题,它们不是独立 topic。
  if (/^(work|study|studies)$/i.test(name)) return null
  return { name, isNew: match[3].toLowerCase() === 'new' }
}

function readPart2Heading(line) {
  const match = line.match(/^(\d+)\.\s+(Describe\b.*)$/i)
  if (!match) return null
  const marker = readNewOldMarker(line)
  const raw = marker === null ? match[2] : stripMarker(line)
  return {
    prompt: cleanPrompt(raw.replace(/^\d+\.\s+/, '')),
    isNew: marker === null ? null : marker === 'new',
  }
}

/**
 * Part 2&3 每个大分类前都有目录页,卡片标题会连续出现两次(目录一次、
 * 正文一次)。正文标题后面紧跟 "You should say:"(允许标题跨 1-2 行),
 * 目录标题后面跟的是下一个编号标题,因此只把“后文很快出现 cue 提示”的
 * 标题当作真实卡片。
 */
function findBodyPart2Headings(lines) {
  const indices = new Set()
  for (let index = 0; index < lines.length; index += 1) {
    if (readPart2Heading(lines[index]) === null) continue
    for (let offset = 1; offset <= 4; offset += 1) {
      const next = lines[index + offset]
      if (next === undefined) break
      if (readPart2Heading(next) !== null) break
      if (next === 'You should say:') {
        indices.add(index)
        break
      }
    }
  }
  return indices
}

function readNewOldMarker(line) {
  const match = line.match(/\s*\[(new|old)\]\s*$/i)
  return match ? match[1].toLowerCase() : null
}

function stripMarker(line) {
  return line.replace(/\s*\[(new|old)\]\s*$/i, '').trim()
}

function readQuestionNumber(line) {
  const match = line.match(/^(\d+)\)\s*(.+)$/)
  if (!match) return null
  return { number: Number(match[1]), text: cleanPrompt(match[2]) }
}

function isQuestionContinuation(line) {
  if (readCategory(line) !== null) return false
  if (/^\d+\)\s*$/.test(line)) return false
  if (/^(Work|Study)\b/i.test(line)) return false
  if (/^(Part\s*1\s*)?(必考话题|高频话题)$/.test(line)) return false
  if (/^(PLACE|OBJECT|OBJECTS|EVENT|EVENTS|PEOPLE|ABSTRACT)$/i.test(line)) return false
  if (/^Part\s*3$/i.test(line)) return false
  if (/^\d+\.\s+Describe\b/i.test(line)) return false
  return true
}

function endsWithSpace(text) {
  return /\s$/.test(text)
}

function cleanPrompt(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([?!.])(?=[A-Za-z])/g, '$1 ')
    .replace(/\be\.\s*g\./gi, 'e.g.')
    .replace(/,([A-Za-z])/g, ', $1')
    .replace(/\bpf\b/g, 'of')
    .replace(/\brecomme\s+nd\b/gi, 'recommend')
    .replace(/\bAl\b/g, 'AI')
    .trim()
}

function splitCuePoints(text) {
  const cleaned = cleanPrompt(text)
  return cleaned
    .split(INTERNAL_CUE_BOUNDARY)
    .map((point) => point.trim())
    .filter(Boolean)
}

function hasDanglingTopicEnd(topic) {
  const finalWord = topic.match(/[A-Za-z]+$/)?.[0].toLowerCase()
  return (
    (finalWord !== undefined && DANGLING_TOPIC_WORDS.has(finalWord)) ||
    /\b[A-Za-z]\.$/.test(topic)
  )
}

function trimDanglingTopicEnd(topic) {
  let result = topic.replace(/[,:;(\-]+$/g, '').trim()
  while (hasDanglingTopicEnd(result)) {
    result = result.replace(/\s+\S+$/, '').trim()
  }
  return result
}

function part2Topic(prompt) {
  let topic = cleanPrompt(prompt)
    .replace(/^Describe\b\s*/i, '')
    .replace(/^(?:an?|the)\s+/i, '')
    .replace(/\s*\((?:e\.g\.|for example|such as)\s+[^)]*\)/gi, ' ')
  topic = cleanPrompt(topic)

  if (topic.length > 80) {
    const wordBoundary = topic.lastIndexOf(' ', 80)
    if (wordBoundary > 0) {
      topic = topic.slice(0, wordBoundary)
    }
  }

  return trimDanglingTopicEnd(topic)
}

function stableId(part, prompt) {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44)
  const index = part === 1 ? '001' : part === 2 ? '001' : '001'
  return `p${part}-${slug}-${index}`
}

const COMMON_QUESTION_FIELDS = [
  'id',
  'part',
  'topic',
  'prompt',
  'difficulty',
  'source',
  'category',
  'isNew',
]

const ALLOWED_QUESTION_FIELDS = {
  1: new Set(COMMON_QUESTION_FIELDS),
  2: new Set([...COMMON_QUESTION_FIELDS, 'cuePoints', 'relatedPart3Ids']),
  3: new Set([...COMMON_QUESTION_FIELDS, 'part2QuestionId']),
}

function validateText(value, label, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`题库校验失败:${label} 为空`)
  }
  if (value.length > maximumLength) {
    throw new Error(`题库校验失败:${label} 超过 ${maximumLength} 个字符`)
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`题库校验失败:${label} 包含控制字符或换行`)
  }
  if (/@@PAGE|^Warning:|You should say:|\.{5,}|\[(?:new|old)\]/i.test(value)) {
    throw new Error(`题库校验失败:${label} 包含疑似 PDF 结构残留: ${value}`)
  }
  if (/,[A-Za-z]/.test(value)) {
    throw new Error(`题库校验失败:${label} 包含逗号粘连: ${value}`)
  }
  if (/\bpf\b/.test(value)) {
    throw new Error(`题库校验失败:${label} 包含孤立 OCR token pf: ${value}`)
  }
  if (/\be\.\s+g\./i.test(value)) {
    throw new Error(`题库校验失败:${label} 包含未规范化缩写 e. g.: ${value}`)
  }
  if (/\brecomme\s+nd\b/i.test(value)) {
    throw new Error(`题库校验失败:${label} 包含未修复的 PDF 单词断裂: ${value}`)
  }
  if (/\bAl\b/.test(value)) {
    throw new Error(`题库校验失败:${label} 包含疑似 AI OCR 错字 Al: ${value}`)
  }
}

function validateQuestionShape(question, index) {
  if (question === null || typeof question !== 'object' || Array.isArray(question)) {
    throw new Error(`题库校验失败:第 ${index + 1} 项不是题目对象`)
  }

  const label = typeof question.id === 'string' ? question.id : `第 ${index + 1} 项`
  if (![1, 2, 3].includes(question.part)) {
    throw new Error(`题库校验失败:${label} 的 Part 无效`)
  }
  if (!new RegExp(`^p${question.part}-[a-z0-9-]+$`).test(question.id)) {
    throw new Error(`题库校验失败:${label} 的 id 与 Part 不匹配`)
  }

  const unexpectedFields = Object.keys(question).filter(
    (field) => !ALLOWED_QUESTION_FIELDS[question.part].has(field),
  )
  if (unexpectedFields.length > 0) {
    throw new Error(`题库校验失败:${label} 包含未知字段 ${unexpectedFields.join(', ')}`)
  }

  validateText(question.topic, `${label} topic`, 80)
  if (question.part !== 1 && hasDanglingTopicEnd(question.topic)) {
    throw new Error(`题库校验失败:${label} topic 以连接词、介词或残缺缩写结尾`)
  }
  validateText(question.prompt, `${label} 题目`, 500)
  if (question.source !== BUILT_IN_SOURCE) {
    throw new Error(`题库校验失败:${label} 缺少内置题库来源标记`)
  }
  if (typeof question.isNew !== 'boolean') {
    throw new Error(`题库校验失败:${label} 缺少 [new]/[old] 标记`)
  }
  if (!ALLOWED_CATEGORIES[question.part].has(question.category)) {
    throw new Error(`题库校验失败:${label} 的分类异常: ${question.category ?? '空'}`)
  }

  const expectedDifficulty = {
    1: 'foundation',
    2: 'developing',
    3: 'stretch',
  }[question.part]
  if (question.difficulty !== expectedDifficulty) {
    throw new Error(`题库校验失败:${label} 的难度标记与 Part 不匹配`)
  }
}

function validate(questions) {
  if (!Array.isArray(questions)) {
    throw new Error('题库校验失败:questions 必须是数组')
  }

  const counts = { 1: 0, 2: 0, 3: 0 }
  const ids = new Set()
  const part2ById = new Map()
  const part3ById = new Map()

  for (const [index, question] of questions.entries()) {
    validateQuestionShape(question, index)
    counts[question.part] += 1
    if (ids.has(question.id)) {
      throw new Error(`题库校验失败:重复 id ${question.id}`)
    }
    ids.add(question.id)

    if (question.part === 2) {
      part2ById.set(question.id, question)
      if (!/^Describe\b/i.test(question.prompt)) {
        throw new Error(`题库校验失败:${question.id} 不是 Describe cue card`)
      }
      if (!Array.isArray(question.cuePoints) || question.cuePoints.length < 2) {
        throw new Error(`题库校验失败:${question.id} 的 cue points 少于 2 条`)
      }
      if (question.cuePoints.length > 6) {
        throw new Error(`题库校验失败:${question.id} 的 cue points 超过 6 条`)
      }
      for (const [cueIndex, cuePoint] of question.cuePoints.entries()) {
        validateText(cuePoint, `${question.id} cue point ${cueIndex + 1}`, 160)
        if (!CUE_STARTERS.test(cuePoint)) {
          throw new Error(
            `题库校验失败:${question.id} 的 cue point 起始词异常: ${cuePoint}`,
          )
        }
      }
      if (!Array.isArray(question.relatedPart3Ids) || question.relatedPart3Ids.length === 0) {
        throw new Error(`题库校验失败:${question.id} 没有关联 Part 3 问题`)
      }
      if (question.relatedPart3Ids.length > 12) {
        throw new Error(`题库校验失败:${question.id} 关联的 Part 3 超过 12 条`)
      }
      if (new Set(question.relatedPart3Ids).size !== question.relatedPart3Ids.length) {
        throw new Error(`题库校验失败:${question.id} 包含重复的 Part 3 关联`)
      }
    }

    if (question.part === 3) {
      if (typeof question.part2QuestionId !== 'string') {
        throw new Error(`题库校验失败:${question.id} 没有关联 Part 2`)
      }
      part3ById.set(question.id, question)
    }
  }

  for (const part of [1, 2, 3]) {
    if (counts[part] < MINIMUM_COUNTS[part]) {
      throw new Error(
        `题库校验失败:Part ${part} 仅解析出 ${counts[part]} 题，低于安全下限 ${MINIMUM_COUNTS[part]}`,
      )
    }
  }

  let linkedPart3 = 0
  for (const question of part3ById.values()) {
    const part2 = part2ById.get(question.part2QuestionId)
    if (part2 === undefined) {
      throw new Error(
        `题库校验失败:${question.id} 指向不存在的 Part 2 ${question.part2QuestionId}`,
      )
    }
    if (!part2.relatedPart3Ids.includes(question.id)) {
      throw new Error(`题库校验失败:${question.id} 未出现在 ${part2.id} 的反向关联中`)
    }
    linkedPart3 += 1
  }

  for (const question of part2ById.values()) {
    for (const part3Id of question.relatedPart3Ids) {
      const part3 = part3ById.get(part3Id)
      if (part3 === undefined) {
        throw new Error(`题库校验失败:${question.id} 指向不存在的 Part 3 ${part3Id}`)
      }
      if (part3.part2QuestionId !== question.id) {
        throw new Error(`题库校验失败:${question.id} 与 ${part3Id} 的双向关联不一致`)
      }
    }
  }

  return { counts, linkedPart3 }
}

export { cleanPrompt, part2Topic, splitCuePoints, validate as validateQuestionBank }

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  main()
}
