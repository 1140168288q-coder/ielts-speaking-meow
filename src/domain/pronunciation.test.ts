import { describe, expect, it } from 'vitest'
import { diffPronunciation } from './pronunciation'

describe('diffPronunciation', () => {
  it('finds no issues when the transcript matches the target', () => {
    const issues = diffPronunciation(
      'I like reading at home because it helps me relax.',
      'I like reading at home because it helps me relax.',
    )
    expect(issues).toEqual([])
  })

  it('flags a word that was heard differently', () => {
    const issues = diffPronunciation(
      'I like reading at home because it helps me relax.',
      'I like read at home because it helps me relax.',
    )
    expect(issues).toContainEqual({ word: 'reading', heardAs: 'read' })
  })

  it('flags words that were never heard', () => {
    const issues = diffPronunciation(
      'I like reading at home.',
      'I like reading.',
    )
    expect(issues).toContainEqual({ word: 'home', heardAs: null })
  })

  it('ignores very short function words', () => {
    const issues = diffPronunciation(
      'I like reading at home.',
      'I like reading at house.',
    )
    expect(issues).toEqual([{ word: 'home', heardAs: 'house' }])
    expect(issues.some((issue) => issue.word === 'at')).toBe(false)
  })

  it('caps the reported issues at 30', () => {
    const longTarget = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ')
    const issues = diffPronunciation(longTarget, 'completely different content')
    expect(issues.length).toBeLessThanOrEqual(30)
  })
})
