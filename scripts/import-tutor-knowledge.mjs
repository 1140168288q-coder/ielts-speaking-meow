/**
 * 将根目录的流利优先知识库转换为可版本化的本地 RAG chunks。
 * Markdown 是唯一知识源；运行时只加载生成 JSON 中被检索到的短文档。
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DEFAULT_SOURCE = path.join(ROOT, '雅思口语备考知识库_流利优先.md')
const OUTPUT = path.join(ROOT, 'src', 'data', 'tutorKnowledge.generated.json')
const FORMAT = 'ielts-speaking-meow-tutor-knowledge'
const FORMAT_VERSION = 1
const REVIEWED_AT = '2026-08-27'

const COMMON = {
  source: 'product-authored',
  sourceUrl: undefined,
  confidence: 'high',
  level: 'basic',
  reusable: true,
}

const CHUNK_SPECS = [
  spec('answer-engine', '## 0.', 'all', ['structure', 'fluency', 'feedback'], ['answer', 'reason', 'detail', 'clear', 'continue']),
  spec('exam-map-p1', '## 1.', 'part1', ['exam-format', 'structure'], ['part 1', 'personal', 'daily life', 'short answer'], { source: 'official-guidance', sourceUrl: 'https://ielts.org/organisations/ielts-for-organisations/test-types/ielts-academic-test/academic-test-format-in-detail' }),
  spec('exam-map-p2', '## 1.', 'part2', ['exam-format', 'structure'], ['part 2', 'cue card', 'story', 'one to two minutes'], { source: 'official-guidance', sourceUrl: 'https://ielts.org/organisations/ielts-for-organisations/test-types/ielts-academic-test/academic-test-format-in-detail' }),
  spec('exam-map-p3', '## 1.', 'part3', ['exam-format', 'structure'], ['part 3', 'abstract', 'discussion', 'reason'], { source: 'official-guidance', sourceUrl: 'https://ielts.org/organisations/ielts-for-organisations/test-types/ielts-academic-test/academic-test-format-in-detail' }),
  spec('part1-answer-why-detail', '### 3.1', 'part1', ['structure', 'fluency', 'feedback'], ['part 1', 'answer', 'why', 'detail', 'preference', 'dislike'], { questionTypes: ['preference', 'dislike', 'personal'] }),
  spec('part2-four-box-story', '### 3.2', 'part2', ['structure', 'fluency', 'feedback'], ['part 2', 'who', 'what', 'when', 'where', 'happened', 'feeling'], { questionTypes: ['describe', 'person', 'place', 'experience', 'object'] }),
  spec('part3-pre-result', '### 3.3', 'part3', ['structure', 'feedback'], ['part 3', 'point', 'reason', 'example', 'result', 'contrast'], { questionTypes: ['why', 'compare', 'opinion', 'impact'] }),
  spec('linking-words', '### 4.1', 'all', ['coherence', 'structure'], ['because', 'so', 'but', 'for example', 'although', 'contrast']),
  spec('safe-fillers', '### 4.2', 'all', ['fluency', 'feedback'], ['well', 'let me think', 'I mean', 'paraphrase', 'filler']),
  spec('topic-study', '### 5.1', 'all', ['topic', 'vocabulary'], ['study', 'school', 'university', 'campus', 'course']),
  spec('topic-hometown', '### 5.2', 'all', ['topic', 'vocabulary'], ['hometown', 'city', 'residents', 'landmark', 'history']),
  spec('topic-city-life', '### 5.3', 'all', ['topic', 'vocabulary', 'feedback'], ['city', 'transport', 'jobs', 'cost', 'convenient', 'crowded']),
  spec('topic-accommodation', '### 5.4', 'all', ['topic', 'vocabulary'], ['home', 'flat', 'house', 'suburbs', 'room', 'neighbourhood']),
  spec('topic-weather', '### 5.5', 'all', ['topic', 'vocabulary'], ['weather', 'climate', 'summer', 'autumn', 'walk']),
  spec('topic-travel', '### 5.6', 'all', ['topic', 'vocabulary'], ['travel', 'trip', 'budget', 'views', 'culture', 'city']),
  spec('topic-people', '### 5.7', 'all', ['topic', 'vocabulary'], ['person', 'friend', 'family', 'teacher', 'kind', 'hard-working']),
  spec('topic-books-music', '### 5.8', 'all', ['topic', 'vocabulary'], ['book', 'music', 'feelings', 'relaxed', 'movie']),
  spec('topic-food', '### 5.9', 'all', ['topic', 'vocabulary'], ['food', 'cooking', 'roast', 'steam', 'taste']),
  spec('topic-media-technology', '### 5.10', 'all', ['topic', 'vocabulary', 'feedback'], ['media', 'technology', 'Bilibili', 'video', 'app', 'screen time']),
  spec('part2-person-template', '### 6.1', 'part2', ['structure', 'topic', 'memory'], ['person', 'admire', 'qualities', 'example'], { questionTypes: ['person', 'someone'] }),
  spec('part2-experience-template', '### 6.2', 'part2', ['structure', 'topic', 'memory'], ['experience', 'trip', 'event', 'unexpected', 'memorable'], { questionTypes: ['experience', 'trip', 'event'] }),
  spec('part2-media-template', '### 6.3', 'part2', ['structure', 'topic', 'memory'], ['app', 'video', 'livestream', 'useful', 'problem'], { questionTypes: ['media', 'technology', 'object'] }),
  spec('part2-object-template', '### 6.4', 'part2', ['structure', 'topic', 'memory'], ['object', 'phone', 'book', 'use', 'meaning']),
  spec('grammar-high-return', '### 7.1', 'all', ['grammar', 'feedback'], ['because', 'although', 'despite', 'comparison', 'grammar']),
  spec('grammar-sentence-repair', '### 7.3', 'all', ['grammar', 'vocabulary'], ['made of', 'main character', 'manage time', 'make progress', 'practical']),
  spec('practice-routine', '### 9.', 'all', ['routine', 'fluency', 'structure'], ['25 minutes', 'warm-up', 'practice', 'review', 'second attempt']),
  spec('personal-materials-reuse', '### 10.4', 'all', ['memory', 'topic'], ['personal facts', 'reuse', 'expression', 'story bank']),
  spec('feedback-priority', '### 10.3', 'all', ['feedback', 'fluency', 'structure'], ['feedback', 'fluency', 'accuracy', 'short sentences', 'reusable']),
  spec('final-checklist', '## 12.', 'all', ['feedback', 'routine'], ['start quickly', 'because', 'example', 'second attempt', 'review']),
  spec('scoring-reference', '### 2.2', 'all', ['scoring'], ['band', 'fluency', 'lexical', 'grammar', 'pronunciation'], { reusable: false, confidence: 'high' }),
  spec('pronunciation-training', '### 8.1', 'all', ['pronunciation'], ['pronunciation', 'intonation', 'stress', 'accent'], { reusable: false, confidence: 'high' }),
]

function spec(id, heading, part, functions, keywords, extra = {}) {
  return { id, heading, part, functions, keywords, ...COMMON, ...extra }
}

export function buildTutorKnowledge(sourceText, sourceFile = path.basename(DEFAULT_SOURCE)) {
  const sections = parseSections(sourceText)
  const documents = CHUNK_SPECS.flatMap((chunkSpec) => {
    const section = sections.find((item) => item.heading.startsWith(chunkSpec.heading))
    if (!section) return []
    const body = section.body
    if (chunkSpec.id.startsWith('exam-map-')) {
      const partNumber = chunkSpec.part.replace('part', '')
      const row = body.split('\n').find((line) => line.startsWith(`| Part ${partNumber} |`))
      if (!row) return []
      return [createDocument(chunkSpec, row.replace(/^\| | \|$/g, '').replace(/\|/g, '；'), section.heading)]
    }
    return [createDocument(chunkSpec, body, section.heading)]
  })

  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    sourceFile,
    sourceSha256: createHash('sha256').update(sourceText, 'utf8').digest('hex'),
    sourceVersion: '2026-08-27',
    generatedAt: new Date().toISOString(),
    documents,
  }
}

function createDocument(chunkSpec, rawBody, sourceSection) {
  const cleanBody = compactBody(rawBody)
  return {
    id: `kb-${chunkSpec.id}`,
    part: chunkSpec.part === 'all' ? 'all' : Number(chunkSpec.part.replace('part', '')),
    title: titleFromSection(sourceSection),
    body: cleanBody.slice(0, 760),
    keywords: unique([...chunkSpec.keywords, ...tokensFromText(`${sourceSection} ${cleanBody}`)]).slice(0, 36),
    tags: unique([...chunkSpec.functions, chunkSpec.part]),
    functions: chunkSpec.functions,
    topics: unique(chunkSpec.keywords.filter((keyword) => keyword.length > 2)).slice(0, 12),
    questionTypes: chunkSpec.questionTypes ?? [],
    level: chunkSpec.level,
    source: chunkSpec.source,
    ...(chunkSpec.sourceUrl ? { sourceUrl: chunkSpec.sourceUrl } : {}),
    confidence: chunkSpec.confidence,
    reusable: chunkSpec.reusable,
    sourceSection,
    reviewedAt: REVIEWED_AT,
  }
}

function parseSections(sourceText) {
  const lines = sourceText.replaceAll('\r\n', '\n').split('\n')
  const headings = []
  lines.forEach((line, index) => {
    const match = /^(#{2,4})\s+(.+?)\s*$/.exec(line)
    if (match) headings.push({ level: match[1].length, heading: `${match[1]} ${match[2]}`, start: index })
  })
  return headings.map((heading, index) => {
    const next = headings[index + 1]
    const end = next?.start ?? lines.length
    const body = lines.slice(heading.start + 1, end).join('\n').trim()
    return { ...heading, body }
  })
}

function compactBody(body) {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function titleFromSection(section) {
  return section.replace(/^#{2,4}\s+/, '').replace(/^\d+(?:\.\d+)*\.\s*/, '').trim()
}

function tokensFromText(text) {
  return text
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 2)
}

function unique(items) {
  return [...new Set(items)]
}

async function run(inputPath = DEFAULT_SOURCE) {
  const absolute = path.resolve(ROOT, inputPath)
  const sourceText = await readFile(absolute, 'utf8')
  const document = buildTutorKnowledge(sourceText, path.basename(absolute))
  if (document.documents.length < 20) {
    throw new Error(`知识库 chunks 数量过少：${document.documents.length}`)
  }
  await writeFile(OUTPUT, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  console.log(`已生成 ${OUTPUT}`)
  console.log(`共 ${document.documents.length} 个 chunks，源文件 SHA-256 ${document.sourceSha256}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv[2]).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  })
}
