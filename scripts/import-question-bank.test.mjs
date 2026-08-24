import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cleanPrompt,
  part2Topic,
  validateQuestionBank,
  splitCuePoints,
} from './import-question-bank.mjs'

const generatedBank = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'src/data/questionBank.generated.json'),
    'utf8',
  ),
)

const cloneQuestions = () => structuredClone(generatedBank.questions)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

describe('question bank importer validation', () => {
  it('normalizes only high-confidence source text anomalies', () => {
    expect(
      cleanPrompt(
        'Examples include e. g. vegetables,flowers. Which do you prefer more,or the moment pf carrying it out?',
      ),
    ).toBe(
      'Examples include e.g. vegetables, flowers. Which do you prefer more, or the moment of carrying it out?',
    )
    expect(cleanPrompt('A helpful person and a PF file')).toBe(
      'A helpful person and a PF file',
    )
    expect(cleanPrompt('Would you like to recomme nd it?')).toBe(
      'Would you like to recommend it?',
    )
    expect(cleanPrompt('How can Al help in our lives?')).toBe(
      'How can AI help in our lives?',
    )
  })

  it('separates cue points merged onto one PDF text line', () => {
    expect(splitCuePoints('What it was When and where you watched it')).toEqual([
      'What it was',
      'When and where you watched it',
    ])
    expect(splitCuePoints('Where you would like to go When you would like to go')).toEqual([
      'Where you would like to go',
      'When you would like to go',
    ])
  })

  it('builds complete semantic Part 2 topics at word boundaries', () => {
    expect(
      part2Topic(
        'Describe a person who loves to grow plants (e. g. vegetables, flowers) at home or in the garden',
      ),
    ).toBe('person who loves to grow plants at home or in the garden')
    expect(
      part2Topic('Describe a person who makes plans a lot and is good at planning'),
    ).toBe('person who makes plans a lot and is good at planning')
    expect(
      part2Topic(
        'Describe a time when you sent a message or an email to someone but received no reply for a long time',
      ),
    ).toBe(
      'time when you sent a message or an email to someone but received no reply',
    )
  })

  it('accepts the reviewed source while preserving every id and relationship', () => {
    const questions = cloneQuestions()
    const promptOccurrences = new Map()
    for (const question of questions) {
      const key = `${question.part}:${question.prompt}`
      promptOccurrences.set(key, (promptOccurrences.get(key) ?? 0) + 1)
    }
    const repeatedPrompts = [...promptOccurrences.values()].filter(
      (count) => count > 1,
    )
    const partTwoQuestions = questions.filter((question) => question.part === 2)
    const part3Counts = new Set(
      partTwoQuestions.map((question) => question.relatedPart3Ids.length),
    )
    const idFingerprint = sha256(
      questions.map((question) => question.id).join('\n'),
    )
    const relationFingerprint = sha256(
      partTwoQuestions
        .map(
          (question) =>
            `${question.id}:${question.relatedPart3Ids.join(',')}`,
        )
        .join('\n'),
    )

    expect(repeatedPrompts.length).toBeGreaterThan(0)
    expect(part3Counts.size).toBeGreaterThan(1)
    expect(idFingerprint).toBe(
      '0b66430cd9ef487b31a1a244c117c39ab18673a860112b99fc8ec8e65a8e7205',
    )
    expect(relationFingerprint).toBe(
      'e06ea49dc78ea8e2e9b72ef0d617dbcc04aa5929b70cac7dba7dccdfbacdd9c6',
    )
    expect(sha256(JSON.stringify(questions))).toBe(
      'b6a63eb96398542af61cf93dd2e94dcc4a3dc13e8ddb2dbaa2f728f2cc073b38',
    )
    expect(validateQuestionBank(questions)).toEqual({
      counts: { 1: 256, 2: 60, 3: 337 },
      linkedPart3: 337,
    })
  })

  it('rejects missing source cue points instead of synthesizing replacements', () => {
    const questions = cloneQuestions()
    const cueCard = questions.find((question) => question.part === 2)
    cueCard.cuePoints = cueCard.cuePoints.slice(0, 1)

    expect(() => validateQuestionBank(questions)).toThrow(/cue points 少于 2 条/)
  })

  it('rejects dangling topics, comma joins, and isolated OCR tokens', () => {
    const questionsWithDanglingTopic = cloneQuestions()
    const cueCard = questionsWithDanglingTopic.find(
      (question) => question.part === 2,
    )
    cueCard.topic = 'person who makes plans and'
    expect(() => validateQuestionBank(questionsWithDanglingTopic)).toThrow(
      /topic 以连接词、介词或残缺缩写结尾/,
    )

    const questionsWithCommaJoin = cloneQuestions()
    const commaPrompt = questionsWithCommaJoin.find(
      (question) => question.part === 3,
    )
    commaPrompt.prompt = 'Which do people prefer more,or less?'
    expect(() => validateQuestionBank(questionsWithCommaJoin)).toThrow(
      /包含逗号粘连/,
    )

    const questionsWithOcrToken = cloneQuestions()
    const ocrPrompt = questionsWithOcrToken.find(
      (question) => question.part === 3,
    )
    ocrPrompt.prompt = 'What is the moment pf carrying out a plan?'
    expect(() => validateQuestionBank(questionsWithOcrToken)).toThrow(
      /包含孤立 OCR token pf/,
    )
  })

  it('rejects PDF structure residue and broken Part 2 to Part 3 links', () => {
    const questionsWithResidue = cloneQuestions()
    const partOne = questionsWithResidue.find((question) => question.part === 1)
    partOne.prompt = `${partOne.prompt} You should say:`

    expect(() => validateQuestionBank(questionsWithResidue)).toThrow(
      /疑似 PDF 结构残留/,
    )

    const questionsWithBrokenLink = cloneQuestions()
    const partThree = questionsWithBrokenLink.find(
      (question) => question.part === 3,
    )
    partThree.part2QuestionId = 'p2-does-not-exist-001'

    expect(() => validateQuestionBank(questionsWithBrokenLink)).toThrow(
      /指向不存在的 Part 2/,
    )
  })
})
