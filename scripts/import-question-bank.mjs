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
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'src', 'data', 'questionBank.generated.json')

const HEADER_LINES = new Set([
  '新航道国际教育集团教学与考试研究院',
  'Institute of Teaching and Examinations, New Channel International Education Group',
  '打造具有新航道学术基因的教学团队！',
  '目',
  '录',
])

const CUE_STARTERS = /^(And|How|What|Who|Where|Why|Whether)\b/i

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
  const questions = isJson
    ? parseJsonQuestions(JSON.parse(await readFile(absolute, 'utf8')))
    : await parsePdfQuestions(await readFile(absolute))

  const report = validate(questions)
  const sourceName = path.basename(absolute)
  const document = {
    format: 'ielts-speaking-meow-question-bank',
    formatVersion: 1,
    seasonLabel: inferSeasonLabel(sourceName),
    sourceFile: sourceName,
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
  for (const warning of report.warnings) {
    console.warn(`⚠ ${warning}`)
  }
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
      source: '雅思口语喵内置题库',
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
      source: '雅思口语喵内置题库',
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
          source: '雅思口语喵内置题库',
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

  // 规范化 Part 2 cue points:删除空白,至少保留两条。
  for (const question of questions) {
    if (question.part === 2) {
      question.cuePoints = question.cuePoints
        .map((point) => cleanPrompt(point))
        .filter(Boolean)
        .slice(0, 6)
      if (question.cuePoints.length < 2) {
        question.cuePoints = [
          ...question.cuePoints,
          'Explain the main details.',
          'Say why this is meaningful to you.',
        ].slice(0, 6)
      }
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
    .trim()
}

function part2Topic(prompt) {
  const cleaned = prompt
    .replace(/^Describe (an?|a) /i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(/\s+/)
  const topic = words.slice(0, 7).join(' ')
  return (topic.length > 0 ? topic : cleaned).slice(0, 80)
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

function validate(questions) {
  const counts = { 1: 0, 2: 0, 3: 0 }
  const warnings = []
  const ids = new Set()
  const part2ById = new Map()
  for (const question of questions) {
    counts[question.part] += 1
    if (ids.has(question.id)) {
      throw new Error(`题库校验失败:重复 id ${question.id}`)
    }
    ids.add(question.id)
    if (question.prompt.length === 0) {
      throw new Error(`题库校验失败:${question.id} 题目为空`)
    }
    if (question.part === 2) {
      part2ById.set(question.id, question)
      if (question.cuePoints.length < 2) {
        throw new Error(`题库校验失败:${question.id} 的 cue points 少于 2 条`)
      }
    }
  }
  let linkedPart3 = 0
  for (const question of questions) {
    if (question.part !== 3) continue
    linkedPart3 += question.part2QuestionId !== undefined ? 1 : 0
    if (question.part2QuestionId && !part2ById.has(question.part2QuestionId)) {
      warnings.push(`${question.id} 指向不存在的 Part 2 ${question.part2QuestionId}`)
    }
  }
  for (const question of questions) {
    if (question.part !== 2) continue
    if (question.relatedPart3Ids?.length === 0) {
      warnings.push(`${question.id} 没有关联 Part 3 问题`)
    }
  }
  if (counts[1] < 20) warnings.push(`Part 1 题目偏少:${counts[1]}`)
  if (counts[2] < 30) warnings.push(`Part 2 题目偏少:${counts[2]}`)
  if (counts[3] < 100) warnings.push(`Part 3 题目偏少:${counts[3]}`)
  return { counts, warnings, linkedPart3 }
}

main()
