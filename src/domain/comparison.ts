import {
  actionableFeedbackListSchema,
  attemptComparisonSchema,
  type ActionableFeedback,
  type AttemptComparison,
  type FeedbackSummary,
  type MetricDelta,
  type SpeechMetrics,
} from './models'

const metricDelta = (first: number, second: number): MetricDelta => ({
  first,
  second,
  delta: second - first,
})

const evidenceForRepeatedWords = (metrics: SpeechMetrics) =>
  metrics.repeatedWords
    .map(({ word, count }) => `${word} ×${count + 1}`)
    .join(', ')

/**
 * 一行问题 + 一行建议的中文本地摘要。AI 不可用或未返回结果时的降级反馈,
 * 只挑当前最值得改的一件高置信度的事。
 */
export const createLocalSummary = (metrics: SpeechMetrics): FeedbackSummary => {
  if (metrics.wordCount === 0) {
    return {
      problem: '暂时没有可分析的转写文本。',
      suggestion: '请先补充转写或重试转写，再查看反馈。',
    }
  }

  if (metrics.fillerCount > 0) {
    const sample = metrics.fillerWords
      .slice(0, 2)
      .map(({ phrase }) => `“${phrase}”`)
      .join('、')
    return {
      problem: `回答中出现了 ${metrics.fillerCount} 次${sample}等口头填充词。`,
      suggestion: '试着用短暂的停顿代替填充词，想好再开口。',
    }
  }

  if (metrics.repeatedWordCount > 0) {
    const sample = metrics.repeatedWords
      .slice(0, 2)
      .map(({ word }) => `“${word}”`)
      .join('、')
    return {
      problem: `${sample}等单词出现了卡顿式重复。`,
      suggestion: '说错时先停一下，再把当前短语完整说一遍。',
    }
  }

  if ((metrics.acoustic?.longPauseCount ?? 0) > 0) {
    return {
      problem: `出现了约 ${metrics.acoustic?.longPauseCount ?? 0} 次 0.8 秒以上的长停顿。`,
      suggestion: '每句话开口前先想好一个关键词，让停顿更短更自然。',
    }
  }

  if (metrics.wordsPerMinute !== null && metrics.wordsPerMinute > 200) {
    return {
      problem: `语速约为 ${metrics.wordsPerMinute} 词/分钟，偏快。`,
      suggestion: '回听录音，把语速放慢到容易听清的程度。',
    }
  }

  if (metrics.wordsPerMinute !== null && metrics.wordsPerMinute < 80) {
    return {
      problem: `语速约为 ${metrics.wordsPerMinute} 词/分钟，偏慢。`,
      suggestion: '回听录音，试着把语速提起来一些，让表达更连贯。',
    }
  }

  return {
    problem: '这次回答的语音指标比较平稳。',
    suggestion: '选一个最想改进的点，带到第二次回答里。',
  }
}

/** Returns no more than three concrete prompts for the next attempt. */
export const createLocalFeedback = (
  metrics: SpeechMetrics,
): ActionableFeedback[] => {
  const candidates: ActionableFeedback[] = []

  if (metrics.fillerCount > 0) {
    candidates.push({
      category: 'fluency',
      kind: 'focus',
      title: 'Replace filler words with a short pause',
      observation: `The transcript contains ${metrics.fillerCount} clear filler ${metrics.fillerCount === 1 ? 'instance' : 'instances'}.`,
      action:
        'Before the second attempt, mark one breathing point and pause briefly instead of filling the gap.',
      evidence: metrics.fillerWords
        .map(({ phrase, count }) => `${phrase} ×${count}`)
        .join(', '),
    })
  }

  if (metrics.repeatedWordCount > 0) {
    candidates.push({
      category: 'fluency',
      kind: 'focus',
      title: 'Reset after an accidental repetition',
      observation: `There are ${metrics.repeatedWordCount} immediately repeated ${metrics.repeatedWordCount === 1 ? 'word' : 'words'}.`,
      action:
        'If a word gets stuck, pause once and restart the short phrase rather than repeating the same word again.',
      evidence: evidenceForRepeatedWords(metrics),
    })
  }

  if ((metrics.acoustic?.longPauseCount ?? 0) > 0) {
    const longPauseCount = metrics.acoustic?.longPauseCount ?? 0
    candidates.push({
      category: 'fluency',
      kind: 'focus',
      title: 'Plan one idea before each long pause',
      observation: `The local audio check found about ${longPauseCount} ${longPauseCount === 1 ? 'pause' : 'pauses'} lasting at least 0.8 seconds.`,
      action:
        'Before trying again, choose the next key word while finishing the current sentence and use shorter silent pauses.',
      evidence: `${longPauseCount} approximate long ${longPauseCount === 1 ? 'pause' : 'pauses'}`,
    })
  }

  if (metrics.wordCount === 0) {
    candidates.push({
      category: 'coherence',
      kind: 'notice',
      title: 'Add or correct the transcript',
      observation:
        'There are no transcript words available, so transcript-based fluency checks cannot run yet.',
      action:
        'Retry transcription or type what you said, then review the local analysis again.',
      evidence: null,
    })
  } else if (
    metrics.wordsPerMinute !== null &&
    (metrics.wordsPerMinute < 80 || metrics.wordsPerMinute > 200)
  ) {
    candidates.push({
      category: 'fluency',
      kind: 'notice',
      title: 'Review the pace by listening back',
      observation: `The transcript-based estimate is ${metrics.wordsPerMinute} words per minute, which is an unusually ${metrics.wordsPerMinute < 80 ? 'slow' : 'fast'} pace estimate.`,
      action:
        'Listen to the recording and adjust the second attempt only if the pace makes the answer hard to follow.',
      evidence: `${metrics.wordCount} words in ${Math.round(metrics.durationMs / 1_000)} seconds`,
    })
  }

  return actionableFeedbackListSchema.parse(candidates.slice(0, 3))
}

const createComparisonFeedback = (
  first: SpeechMetrics,
  second: SpeechMetrics,
): ActionableFeedback[] => {
  const candidates: ActionableFeedback[] = []
  const firstAcoustic = first.acoustic
  const secondAcoustic = second.acoustic

  if (firstAcoustic && secondAcoustic) {
    const longPauseDelta =
      secondAcoustic.longPauseCount - firstAcoustic.longPauseCount
    if (longPauseDelta < 0) {
      candidates.push({
        category: 'fluency',
        kind: 'improvement',
        title: 'Fewer long pauses in the second attempt',
        observation: `Approximate long pauses fell from ${firstAcoustic.longPauseCount} to ${secondAcoustic.longPauseCount}.`,
        action: 'Keep planning the next key word before the current phrase ends.',
        evidence: `${longPauseDelta} long pauses`,
      })
    } else if (longPauseDelta > 0) {
      candidates.push({
        category: 'fluency',
        kind: 'focus',
        title: 'Long pauses increased in the second attempt',
        observation: `Approximate long pauses rose from ${firstAcoustic.longPauseCount} to ${secondAcoustic.longPauseCount}.`,
        action: 'Use one idea per breath and keep the planning pauses shorter.',
        evidence: `+${longPauseDelta} long pauses`,
      })
    }
  }

  if (first.wordCount === 0 || second.wordCount === 0) {
    candidates.push({
      category: 'coherence',
      kind: 'notice',
      title: 'Complete both transcripts before comparing',
      observation:
        'Filler and repetition changes are unavailable while either transcript is empty; audio pause evidence remains usable when available.',
      action:
        'Retry transcription or manually complete both attempt transcripts, then compare the answers again.',
      evidence: null,
    })
    return actionableFeedbackListSchema.parse(candidates.slice(0, 3))
  }

  const fillerDelta = second.fillerCount - first.fillerCount
  const repetitionDelta = second.repeatedWordCount - first.repeatedWordCount

  if (fillerDelta < 0) {
    candidates.push({
      category: 'fluency',
      kind: 'improvement',
      title: 'Fewer filler words in the second attempt',
      observation: `Clear filler instances fell from ${first.fillerCount} to ${second.fillerCount}.`,
      action:
        'Keep using short silent pauses when planning the next phrase.',
      evidence: `${fillerDelta} filler instances`,
    })
  } else if (fillerDelta > 0) {
    candidates.push({
      category: 'fluency',
      kind: 'focus',
      title: 'Filler words increased in the second attempt',
      observation: `Clear filler instances rose from ${first.fillerCount} to ${second.fillerCount}.`,
      action:
        'Try the second answer again with one idea per breath and allow a silent planning pause.',
      evidence: `+${fillerDelta} filler instances`,
    })
  }

  if (repetitionDelta < 0) {
    candidates.push({
      category: 'fluency',
      kind: 'improvement',
      title: 'Fewer immediate word repetitions',
      observation: `Immediate repetitions fell from ${first.repeatedWordCount} to ${second.repeatedWordCount}.`,
      action:
        'Keep the same reset-and-pause technique in future answers.',
      evidence: `${repetitionDelta} repeated words`,
    })
  } else if (repetitionDelta > 0) {
    candidates.push({
      category: 'fluency',
      kind: 'focus',
      title: 'Immediate repetitions increased',
      observation: `Immediate repetitions rose from ${first.repeatedWordCount} to ${second.repeatedWordCount}.`,
      action:
        'When you repeat a word, stop once and restart only the current phrase.',
      evidence: `+${repetitionDelta} repeated words`,
    })
  }

  if (
    first.wordsPerMinute !== null &&
    second.wordsPerMinute !== null &&
    Math.abs(second.wordsPerMinute - first.wordsPerMinute) >= 25
  ) {
    candidates.push({
      category: 'fluency',
      kind: 'notice',
      title: 'The speaking pace changed noticeably',
      observation: `The estimate changed from ${first.wordsPerMinute} to ${second.wordsPerMinute} words per minute.`,
      action:
        'Listen to both recordings and keep the pace that sounds clearer and easier to sustain.',
      evidence: `${second.wordsPerMinute - first.wordsPerMinute > 0 ? '+' : ''}${second.wordsPerMinute - first.wordsPerMinute} WPM`,
    })
  }

  if (candidates.length === 0) {
    candidates.push({
      category: 'fluency',
      kind: 'notice',
      title: 'The measured fluency indicators stayed stable',
      observation:
        'Clear fillers and immediate repetitions did not change between attempts.',
      action:
        'Listen for clarity and choose one useful phrase from the second answer to save.',
      evidence: null,
    })
  }

  return actionableFeedbackListSchema.parse(candidates.slice(0, 3))
}

export const compareAttempts = (
  first: SpeechMetrics,
  second: SpeechMetrics,
): AttemptComparison => {
  const hasComparableTranscripts =
    first.wordCount > 0 && second.wordCount > 0
  const wordsPerMinute =
    first.wordsPerMinute === null || second.wordsPerMinute === null
      ? null
      : metricDelta(first.wordsPerMinute, second.wordsPerMinute)
  const silenceRatio = first.acoustic && second.acoustic
    ? metricDelta(first.acoustic.silenceRatio, second.acoustic.silenceRatio)
    : null
  const longPauseCount = first.acoustic && second.acoustic
    ? metricDelta(first.acoustic.longPauseCount, second.acoustic.longPauseCount)
    : null

  return attemptComparisonSchema.parse({
    durationMs: metricDelta(first.durationMs, second.durationMs),
    wordsPerMinute,
    fillerCount: hasComparableTranscripts
      ? metricDelta(first.fillerCount, second.fillerCount)
      : null,
    repeatedWordCount: hasComparableTranscripts
      ? metricDelta(first.repeatedWordCount, second.repeatedWordCount)
      : null,
    silenceRatio,
    longPauseCount,
    feedback: createComparisonFeedback(first, second),
  })
}
