import { describe, expect, it } from 'vitest'
import { filterVisibleQuestions, questionBankFingerprint, type QuestionBankExclusion, type QuestionExclusion } from './questionManagement'
import type { Question } from './models'

const question = (id: string, part: 1 | 2 | 3, prompt: string): Question => part === 2
  ? { id, part, topic: 'Home', prompt, cuePoints: ['one', 'two'] }
  : { id, part, topic: 'Home', prompt }

describe('question management visibility', () => {
  it('hides only the owner exclusions and a matching built-in bank fingerprint', () => {
    const builtIn = question('p1-home-1', 1, 'Do you like your home?')
    const imported = question('p1-import-notes-1', 1, 'What is your favourite room?')
    const bank = [builtIn]
    const fingerprint = questionBankFingerprint(bank)
    const exclusions: QuestionExclusion[] = [{
      id: 'question-exclusion:alice:p1-import-notes-1', ownerId: 'alice',
      questionId: imported.id, questionSource: 'imported', reason: 'single',
      createdAt: '2026-09-09T00:00:00.000Z', deletedAt: null,
    }]
    const bankExclusions: QuestionBankExclusion[] = [{
      id: 'question-bank-exclusion:alice:' + fingerprint, ownerId: 'alice',
      bankFingerprint: fingerprint, seasonLabel: '2026-09',
      createdAt: '2026-09-09T00:00:00.000Z', deletedAt: null,
    }]
    expect(filterVisibleQuestions([builtIn, imported], exclusions, bankExclusions, fingerprint)).toEqual([])
    expect(filterVisibleQuestions([builtIn, imported], exclusions, bankExclusions, 'new-bank')).toEqual([builtIn])
  })
})
