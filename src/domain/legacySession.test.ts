import { describe, expect, it } from 'vitest'
import { normalizeStoredTrainingSession } from './legacySession'

const timestamp = '2026-08-01T08:00:00.000Z'

const legacyAttempt = {
  id: 'attempt-1',
  attemptNumber: 1,
  audio: {
    id: 'audio-1',
    relativePath: 'indexeddb://audio/audio-1',
    mimeType: 'audio/webm',
    durationMs: 12_000,
    createdAt: timestamp,
  },
  transcript: {
    status: 'ready',
    text: 'I like reading books in my free time.',
    originalText: 'I like reading books in my free time.',
    source: 'stt',
    errorCode: null,
    updatedAt: timestamp,
  },
  metrics: {
    durationMs: 12_000,
    wordCount: 8,
    wordsPerMinute: 40,
    fillerWords: [],
    fillerCount: 0,
    repeatedWords: [],
    repeatedWordCount: 0,
    caveats: [],
  },
  createdAt: timestamp,
  updatedAt: timestamp,
}

const legacySession = {
  id: 'session-1',
  questionId: 'p1-hobbies',
  status: 'feedback-ready',
  attempts: [legacyAttempt],
  localFeedback: [],
  aiFeedback: {
    keyIssues: [
      {
        category: 'grammar',
        kind: 'focus',
        title: 'Past tense',
        observation: 'Mixed present and past forms.',
        action: 'Use the past tense consistently.',
        evidence: null,
      },
    ],
    secondAttemptTips: ['Keep the same tense.'],
    revisions: {
      minimalFix: 'I like reading books.',
      naturalVersion: 'I like reading books because they help me relax.',
      stretchVersion: null,
    },
    summary: {
      problem: '回答中时态混用。',
      suggestion: '先想好动作发生的时间。',
    },
    versions: [
      {
        style: '基础稳妥',
        text: 'I like reading books in my free time.',
        hint: 'I like ...',
      },
      {
        style: '自然均衡',
        text: 'In my free time, I enjoy reading books.',
        hint: 'In my free time ...',
      },
      {
        style: '略加挑战',
        text: 'Reading is my favourite way to relax.',
        hint: '... is my favourite way to ...',
      },
    ],
  },
  aiComparison: null,
  comparison: null,
  selectedVersionIndex: 1,
  readAloud: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}

describe('normalizeStoredTrainingSession', () => {
  it('migrates V1.6 AI feedback into the V1.7 text-analysis shape', () => {
    const session = normalizeStoredTrainingSession(legacySession)

    expect(session).not.toBeNull()
    expect(session?.attempts[0]?.audio?.id).toBe('audio-1')
    expect(session?.aiFeedback?.summary).toContain('时态混用')
    expect(session?.aiFeedback?.problems).toEqual([
      'Past tense: Mixed present and past forms.',
    ])
    expect(session?.aiFeedback?.grammarSuggestions).toEqual([
      'Use the past tense consistently.',
    ])
    expect(session?.part).toBe(1)
    expect(session?.aiFeedback?.referenceAnswers).toHaveLength(2)
    expect(session?.aiFeedback?.referenceAnswers[0]?.label).toBe('简单优化版')
    expect(session?.aiFeedback?.referenceAnswers[1]?.label).toBe('自然提升版')
  })

  it('passes current V1.7 sessions through unchanged', () => {
    const current = {
      ...legacySession,
      attempts: [
        {
          ...legacyAttempt,
          audio: null,
          transcript: { ...legacyAttempt.transcript, source: 'manual' },
        },
      ],
      aiFeedback: {
        summary: '新的文本分析。',
        strengths: [],
        problems: ['一个问题。', '另一个问题。'],
        grammarSuggestions: [],
        vocabularySuggestions: [],
        referenceAnswers: [
          { label: '简单优化版', text: 'A simple answer.' },
          { label: '自然提升版', text: 'A better answer.' },
        ],
        naturalUpgradeSuggestions: { addableContent: [], advancedChanges: [] },
        answerFramework: [],
      },
      readAloud: null,
    }

    const session = normalizeStoredTrainingSession(current)
    expect(session?.aiFeedback?.summary).toBe('新的文本分析。')
    expect(session?.attempts[0]?.audio).toBeNull()
  })

  it('limits migrated legacy priorities to the current two-item contract', () => {
    const manyIssues = normalizeStoredTrainingSession({
      ...legacySession,
      aiFeedback: {
        ...legacySession.aiFeedback,
        keyIssues: [
          ...legacySession.aiFeedback.keyIssues,
          {
            category: 'vocabulary',
            title: 'Word choice',
            observation: 'One word is not a good fit.',
            action: 'Use a simpler word.',
            evidence: null,
          },
          {
            category: 'grammar',
            title: 'Articles',
            observation: 'An article is missing.',
            action: 'Add the article.',
            evidence: null,
          },
        ],
      },
    })
    expect(manyIssues?.aiFeedback?.problems).toHaveLength(2)
  })

  it('returns null for unrecognizable records', () => {
    expect(normalizeStoredTrainingSession(null)).toBeNull()
    expect(normalizeStoredTrainingSession({ id: 'broken' })).toBeNull()
  })
})
