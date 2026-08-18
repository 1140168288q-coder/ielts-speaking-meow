import type { PronunciationIssue } from './models'

/**
 * 跟读复盘中的疑似发音问题检测。把 STT 转写与范本文本逐词做宽松比对:
 * 范本中未被转写听到的词(或听到的词不一致)列为疑似问题。
 *
 * 这只是语音识别层面的比对结果,不是发音评分,更不能当作发音事实。
 */
const MAX_ISSUES = 30

function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
}

function sameWord(target: string, heard: string): boolean {
  return target === heard
}

/** 太短的词(冠词、介词等)识别容易粘连,不做发音比对。 */
function comparable(word: string): boolean {
  return word.length > 2
}

export function diffPronunciation(
  targetText: string,
  heardText: string,
): PronunciationIssue[] {
  const target = tokenize(targetText)
  const heard = tokenize(heardText)
  const issues: PronunciationIssue[] = []

  let heardIndex = 0
  let targetIndex = 0

  while (targetIndex < target.length && heardIndex < heard.length) {
    const targetWord = target[targetIndex] ?? ''
    const heardWord = heard[heardIndex] ?? ''

    if (sameWord(targetWord, heardWord)) {
      targetIndex += 1
      heardIndex += 1
      continue
    }

    // 当前词不一致:看转写里下一个词是否就是范本词(可能是多读/漏读一个词)。
    const nextHeard = heard[heardIndex + 1]
    if (nextHeard !== undefined && sameWord(targetWord, nextHeard)) {
      if (comparable(targetWord)) {
        issues.push({ word: targetWord, heardAs: heardWord || null })
      }
      targetIndex += 1
      heardIndex += 2
      continue
    }

    if (comparable(targetWord)) {
      issues.push({ word: targetWord, heardAs: heardWord || null })
    }
    targetIndex += 1
    heardIndex += 1
  }

  // 范本剩下的词完全没被听到。
  for (; targetIndex < target.length; targetIndex += 1) {
    const word = target[targetIndex] ?? ''
    if (comparable(word)) {
      issues.push({ word, heardAs: null })
    }
  }

  return issues.slice(0, MAX_ISSUES)
}
