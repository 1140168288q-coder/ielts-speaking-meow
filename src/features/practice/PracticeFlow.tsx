import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { InitialTranscript, PracticeService } from '../../application/practiceService'
import type {
  AnswerVersionOption,
  FeedbackSummary,
  PracticeAttempt,
  Question,
  ReadAloudRecord,
  TrainingSession,
} from '../../domain'
import { createLocalSummary } from '../../domain'
import type { LLMProvider } from '../../ports/ai'
import type {
  AudioFocus,
  AudioFocusState,
  RecordedAudioSTTProvider,
  STTProvider,
  STTSession,
} from '../../ports/speech'
import { formatMicrophoneStartError } from '../../app/practiceExit'
import {
  audioExtension,
  formatDuration,
  partLabel,
} from './format'
import { createInterruptedTranscriptInput } from './lifecycle'

function useAudioFocus(audioFocus: AudioFocus) {
  const [state, setState] = useState<AudioFocusState>(audioFocus.state)

  useEffect(() => audioFocus.subscribe(setState), [audioFocus])
  return state
}

type RecordingTarget = 'attempt-1' | 'attempt-2' | 'read-aloud'

type Stage =
  | 'first-record'
  | 'review-first'
  | 'read-aloud'
  | 'review-aloud'
  | 'second-record'
  | 'second-submit'
  | 'completed'

function deriveStage(session: TrainingSession): Stage {
  const hasAttempt = (number: 1 | 2) =>
    session.attempts.some((attempt) => attempt.attemptNumber === number)

  if (session.status === 'completed') return 'completed'
  if (hasAttempt(2)) return 'second-submit'
  if (session.status === 'second-ready') return 'second-record'
  if (hasAttempt(1)) {
    if (session.readAloud) return 'review-aloud'
    if (
      session.selectedVersionIndex !== null &&
      session.selectedVersionIndex !== undefined
    ) {
      return 'read-aloud'
    }
    return 'review-first'
  }
  return 'first-record'
}

const STAGE_STEP: Record<Stage, number> = {
  'first-record': 1,
  'review-first': 2,
  'read-aloud': 3,
  'review-aloud': 3,
  'second-record': 4,
  'second-submit': 5,
  completed: 5,
}

export function PracticeFlow({
  question,
  session,
  service,
  audioFocus,
  stt,
  remoteStt,
  textAi,
  onExitGuardChange,
  onChange,
  onBack,
}: {
  question: Question
  session: TrainingSession
  service: PracticeService
  audioFocus: AudioFocus
  stt: STTProvider
  remoteStt: RecordedAudioSTTProvider
  textAi: LLMProvider
  onExitGuardChange: (active: boolean) => void
  onChange: (session: TrainingSession) => void
  onBack: () => void
}) {
  const focusState = useAudioFocus(audioFocus)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [sttNote, setSttNote] = useState<string | null>(null)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const sttSessionRef = useRef<STTSession | null>(null)
  const recordingActiveRef = useRef(false)
  const transcriptRef = useRef('')
  const finalSegmentsRef = useRef<string[]>([])
  const lifecycleGenerationRef = useRef(0)
  const lifecycleSaveInFlightRef = useRef<Promise<void> | null>(null)
  const recordingSaveOwnerRef = useRef<'idle' | 'manual' | 'lifecycle'>('idle')
  const mountedRef = useRef(true)
  const sessionRef = useRef(session)
  const recordingTargetRef = useRef<RecordingTarget>('attempt-1')
  const onChangeRef = useRef(onChange)
  const aiRequestGenerationRef = useRef(0)
  const aiRequestInFlightRef = useRef(false)
  const autoSpeakRequestedRef = useRef(false)

  const stage = deriveStage(session)
  const step = STAGE_STEP[stage]
  const isRecording = focusState === 'recording'

  const aiConfigured = textAi.isConfigured()
  const versions = session.aiFeedback?.versions ?? []
  const selectedVersionIndex = session.selectedVersionIndex
  const chosenVersion =
    selectedVersionIndex !== null && selectedVersionIndex !== undefined
      ? versions[selectedVersionIndex] ?? null
      : null

  useEffect(() => {
    sessionRef.current = session
    onChangeRef.current = onChange
  }, [onChange, session])

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  // 录音时不允许查看第二次回答提示:开始录音时立即收起。
  useEffect(() => {
    if (!isRecording) {
      return
    }

    const started = Date.now()
    const update = () => setElapsedMs(Date.now() - started)
    update()
    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [isRecording])

  const persistInterruptedRecording = useCallback((): Promise<void> => {
    if (lifecycleSaveInFlightRef.current !== null) {
      return lifecycleSaveInFlightRef.current
    }
    if (recordingSaveOwnerRef.current === 'manual') {
      return Promise.resolve()
    }

    lifecycleGenerationRef.current += 1
    const shouldPersist =
      recordingActiveRef.current || audioFocus.state === 'recording'
    recordingActiveRef.current = false
    const currentSttSession = sttSessionRef.current
    sttSessionRef.current = null
    const targetSessionId = sessionRef.current.id
    const target = recordingTargetRef.current

    if (shouldPersist) {
      recordingSaveOwnerRef.current = 'lifecycle'
      onExitGuardChange(true)
    }

    const operation = (async () => {
      try {
        await currentSttSession?.stop().catch(() => undefined)
        await audioFocus.stopAllPlayback().catch(() => undefined)
        if (!shouldPersist) return

        const recording = await audioFocus.stopRecording()
        const transcriptInput = createInterruptedTranscriptInput(
          transcriptRef.current,
        )
        const updated =
          target === 'read-aloud'
            ? await service.saveReadAloud(
                targetSessionId,
                recording,
                transcriptInput,
              )
            : await service.saveAttempt(
                targetSessionId,
                target === 'attempt-1' ? 1 : 2,
                recording,
                transcriptInput,
              )
        onChangeRef.current(updated)
        if (mountedRef.current) {
          setMessage(
            '检测到应用切换或锁屏：已自动停止并保存本次录音，可继续补充转写。',
          )
        }
      } catch (error) {
        await audioFocus.cancelRecording().catch(() => undefined)
        if (mountedRef.current) {
          setMessage(
            error instanceof Error
              ? `中断录音保存失败：${error.message}`
              : '中断录音保存失败，请返回后重新录制。',
          )
        }
      } finally {
        if (shouldPersist) {
          recordingSaveOwnerRef.current = 'idle'
          onExitGuardChange(false)
        }
        lifecycleSaveInFlightRef.current = null
      }
    })()
    lifecycleSaveInFlightRef.current = operation
    return operation
  }, [audioFocus, onExitGuardChange, service])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void persistInterruptedRecording()
      }
    }
    const handlePageHide = () => void persistInterruptedRecording()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      void persistInterruptedRecording()
    }
  }, [persistInterruptedRecording])

  useEffect(() => () => {
    aiRequestGenerationRef.current += 1
    aiRequestInFlightRef.current = false
  }, [])

  const speak = async (text: string) => {
    setMessage(null)
    try {
      if (focusState === 'tts') {
        await audioFocus.stopTTS()
      } else {
        await audioFocus.speak({
          text,
          language: 'en-US',
          rate: 0.92,
          pitch: 1,
        })
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : '语音播放暂不可用，你仍可以继续练习。',
      )
    }
  }

  // 进入答题界面后自动播放一次题目;用户可随时用按钮重播或停止。
  useEffect(() => {
    if (autoSpeakRequestedRef.current) return
    autoSpeakRequestedRef.current = true
    if (audioFocus.state === 'idle') {
      void audioFocus
        .speak({
          text: question.prompt,
          language: 'en-US',
          rate: 0.92,
          pitch: 1,
        })
        .catch(() => undefined)
    }
    // 只在进入练习页时自动播放一次,失败静默(可手动重播)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startLiveStt = () => {
    if (!stt.isAvailable()) {
      setSttNote('当前设备不支持自动转写；录音保存后可以手动输入。')
      return
    }

    const startPromise = stt.start(
      { language: 'en-US', continuous: true, interimResults: true },
      {
        onResult: (result) => {
          if (result.isFinal) {
            finalSegmentsRef.current.push(result.transcript.trim())
          }
          const finalText = finalSegmentsRef.current.filter(Boolean).join(' ')
          const nextText = result.isFinal
            ? finalText
            : [finalText, result.transcript.trim()].filter(Boolean).join(' ')
          transcriptRef.current = nextText
          setLiveTranscript(nextText)
        },
        onError: (error) => {
          setSttNote(`自动转写未完成（${error.code}），原录音会保留。`)
        },
      },
    )

    void startPromise
      .then((nextSession) => {
        if (!recordingActiveRef.current) {
          return nextSession.stop()
        }
        sttSessionRef.current = nextSession
        return undefined
      })
      .catch((error: unknown) => {
        setSttNote(
          error instanceof Error
            ? `${error.message}；原录音仍会保存。`
            : '自动转写不可用；原录音仍会保存。',
        )
      })
  }

  const startRecording = async (target: RecordingTarget) => {
    const lifecycleGeneration = ++lifecycleGenerationRef.current
    recordingTargetRef.current = target
    onExitGuardChange(true)
    setBusy(true)
    setMessage(null)
    setSttNote(null)
    setAiNote(null)
    setHintVisible(false)
    setElapsedMs(0)
    setLiveTranscript('')
    transcriptRef.current = ''
    finalSegmentsRef.current = []

    try {
      await audioFocus.startRecording()
      if (
        lifecycleGeneration !== lifecycleGenerationRef.current ||
        document.visibilityState === 'hidden'
      ) {
        await persistInterruptedRecording()
        return
      }
      recordingActiveRef.current = true
      if (remoteStt.isDefinitelyConfigured()) {
        setSttNote('停止后会先保存原录音，再使用云端 STT 转写。')
      } else if (stt.isAvailable()) {
        startLiveStt()
        if (remoteStt.isConfigured()) {
          setSttNote('设备实时转写已开启；停止后仍会尝试云端转写。')
        }
      } else if (remoteStt.isConfigured()) {
        setSttNote('停止后会先保存原录音，再尝试云端转写。')
      } else {
        startLiveStt()
      }
    } catch (error) {
      onExitGuardChange(false)
      setMessage(formatMicrophoneStartError(error))
    } finally {
      setBusy(false)
    }
  }

  const transcribeSavedAudio = async (
    currentSession: TrainingSession,
    target: RecordingTarget,
    recording: { blob: Blob; mimeType: string },
    liveTranscript: string,
  ): Promise<TrainingSession> => {
    const useRemoteStt = remoteStt.isConfigured()
    if (!useRemoteStt) return currentSession

    const sessionId = currentSession.id
    if (target === 'read-aloud') {
      setMessage('跟读录音已保存在本机，正在请求云端 STT 转写…')
    } else {
      setMessage('原录音已保存在本机，正在请求云端 STT 转写…')
    }
    try {
      const remoteTranscript = await remoteStt.transcribe({
        audio: recording.blob,
        mimeType: recording.mimeType,
        fileName:
          target === 'read-aloud'
            ? `read-aloud.${audioExtension(recording.mimeType)}`
            : `attempt-${target === 'attempt-1' ? 1 : 2}.${audioExtension(recording.mimeType)}`,
        language: 'en',
      })
      if (target === 'read-aloud') {
        const updated = await service.applyReadAloudTranscript(
          sessionId,
          remoteTranscript,
        )
        onChange(updated)
        setMessage('跟读转写完成，发音比对已更新。')
        return updated
      }
      const updated = await service.applySttTranscript(
        sessionId,
        target === 'attempt-1' ? 1 : 2,
        remoteTranscript,
      )
      onChange(updated)
      setMessage('录音和云端 STT 转写均已保存在本机。')
      return updated
    } catch (error) {
      if (target === 'read-aloud') {
        if (liveTranscript.length > 0) {
          const updated = await service.applyReadAloudTranscript(
            sessionId,
            liveTranscript,
          )
          onChange(updated)
          setMessage('云端 STT 失败，已采用设备转写完成发音比对。')
          return updated
        }
        const updated = await service.markReadAloudTranscriptionFailed(
          sessionId,
          'remote-stt-failed',
        )
        onChange(updated)
        setMessage(
          error instanceof Error
            ? `${error.message} 跟读录音已保留，仍可进入第二次回答。`
            : '云端 STT 失败；跟读录音已保留，仍可进入第二次回答。',
        )
        return updated
      }
      if (liveTranscript.length > 0) {
        const updated = await service.applySttTranscript(
          sessionId,
          target === 'attempt-1' ? 1 : 2,
          liveTranscript,
        )
        onChange(updated)
        setMessage('云端 STT 失败，已保留原录音并采用设备转写。')
        return updated
      }
      const updated = await service.markTranscriptionFailed(
        sessionId,
        target === 'attempt-1' ? 1 : 2,
        'remote-stt-failed',
      )
      onChange(updated)
      setMessage(
        error instanceof Error
          ? `${error.message} 原录音已保留，可重试或手工输入。`
          : '云端 STT 失败；原录音已保留，可重试或手工输入。',
      )
      return updated
    }
  }

  const stopAndSave = async () => {
    const target = recordingTargetRef.current
    recordingSaveOwnerRef.current = 'manual'
    onExitGuardChange(true)
    setBusy(true)
    setMessage('正在先保存原始录音…')
    recordingActiveRef.current = false
    void sttSessionRef.current?.stop()
    sttSessionRef.current = null

    try {
      const recording = await audioFocus.stopRecording()
      const transcript = transcriptRef.current.trim()
      const useRemoteStt = remoteStt.isConfigured()
      const transcriptInput: InitialTranscript = useRemoteStt
        ? { text: '', status: 'pending', source: null }
        : transcript
          ? { text: transcript, status: 'ready', source: 'stt' }
          : {
              text: '',
              status: 'failed',
              source: null,
              errorCode: stt.isAvailable() ? 'no-transcript' : 'unavailable',
            }

      let updated: TrainingSession
      if (target === 'read-aloud') {
        updated = await service.saveReadAloud(
          session.id,
          recording,
          transcriptInput,
        )
        onChange(updated)
      } else {
        updated = await service.saveAttempt(
          session.id,
          target === 'attempt-1' ? 1 : 2,
          recording,
          transcriptInput,
        )
        onChange(updated)
      }

      updated = await transcribeSavedAudio(
        updated,
        target,
        recording,
        transcript,
      )

      if (target === 'attempt-1') {
        await requestAiFeedback(updated)
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '录音保存失败，请重试。',
      )
    } finally {
      recordingSaveOwnerRef.current = 'idle'
      onExitGuardChange(false)
      setBusy(false)
    }
  }

  const requestAiFeedback = async (targetSession: TrainingSession) => {
    const attempt = targetSession.attempts.find(
      (item) => item.attemptNumber === 1,
    )
    if (
      !textAi.isConfigured() ||
      attempt?.transcript.status !== 'ready' ||
      attempt.transcript.text.trim().length === 0
    ) {
      return
    }

    if (aiRequestInFlightRef.current) {
      setAiNote('Text AI 反馈仍在处理中，请等待本次请求完成。')
      return
    }

    const generation = ++aiRequestGenerationRef.current
    aiRequestInFlightRef.current = true
    setAiBusy(true)
    setAiNote('正在获取 AI 分析和 3 个建议版本…')
    try {
      const feedback = await textAi.getFeedback({
        question,
        transcript: attempt.transcript.text,
        metrics: attempt.metrics,
      })

      if (generation !== aiRequestGenerationRef.current) return
      const updated = await service.applyAiFeedbackIfTranscriptCurrent(
        targetSession.id,
        {
          attemptId: attempt.id,
          text: attempt.transcript.text,
          updatedAt: attempt.transcript.updatedAt,
        },
        feedback,
      )
      if (generation !== aiRequestGenerationRef.current) return
      if (updated === null) {
        setAiNote('转写已发生变化，本次旧 AI 结果未保存；可按新转写重试。')
        return
      }
      onChange(updated)
      setAiNote(null)
    } catch (error) {
      if (generation !== aiRequestGenerationRef.current) return
      setAiNote(
        error instanceof Error
          ? `${error.message} 已转用本地反馈。`
          : 'Text AI 暂不可用；已转用本地反馈。',
      )
    } finally {
      if (generation === aiRequestGenerationRef.current) {
        aiRequestInFlightRef.current = false
        setAiBusy(false)
      }
    }
  }

  const retryTranscription = async (attempt: PracticeAttempt) => {
    if (aiRequestInFlightRef.current) {
      setMessage('Text AI 正在处理当前转写，请等待完成后再重试转写。')
      return
    }
    if (!remoteStt.isConfigured()) {
      setMessage('云端转写暂不可用，请直接手工输入转写。')
      return
    }
    setBusy(true)
    setMessage('原录音仍在本机，正在重试转写…')
    try {
      const audio = await service.getAudio(attempt.audio.id)
      if (audio === null) throw new Error('找不到这段本地录音。')
      const transcript = await remoteStt.transcribe({
        audio,
        mimeType: attempt.audio.mimeType,
        fileName: `attempt-${attempt.attemptNumber}.${audioExtension(attempt.audio.mimeType)}`,
        language: 'en',
      })
      const updated = await service.applySttTranscript(
        session.id,
        attempt.attemptNumber,
        transcript,
      )
      onChange(updated)
      setMessage('转写重试成功，原录音仍保留。')
      if (attempt.attemptNumber === 1) {
        await requestAiFeedback(updated)
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} 原录音仍保留。`
          : '转写重试失败；原录音仍保留。',
      )
    } finally {
      setBusy(false)
    }
  }

  const playRecording = async (audioId: string) => {
    setMessage(null)
    try {
      const blob = await service.getAudio(audioId)
      if (!blob) {
        throw new Error('找不到这段本地录音。')
      }
      const url = URL.createObjectURL(blob)
      try {
        await audioFocus.playRecording(url)
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '录音播放失败。')
    }
  }

  const playAttempt = (attempt: PracticeAttempt) =>
    playRecording(attempt.audio.id)

  const updateTranscript = async (attempt: PracticeAttempt, text: string) => {
    if (aiRequestInFlightRef.current) {
      setMessage('Text AI 正在处理当前转写，请等待完成后再保存修改。')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const updated = await service.updateTranscript(
        session.id,
        attempt.attemptNumber,
        text,
      )
      onChange(updated)
      setMessage('转写和本地分析已更新。')
      if (attempt.attemptNumber === 1) {
        await requestAiFeedback(updated)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '转写保存失败。')
    } finally {
      setBusy(false)
    }
  }

  const chooseVersion = async (index: number) => {
    setBusy(true)
    setMessage(null)
    try {
      const updated = await service.selectVersion(session.id, index)
      onChange(updated)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '暂时无法选择这个版本。',
      )
    } finally {
      setBusy(false)
    }
  }

  const prepareSecond = async () => {
    setBusy(true)
    try {
      const updated = await service.prepareSecondAttempt(session.id)
      setElapsedMs(0)
      onChange(updated)
      setMessage(null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '暂时无法进入第二次回答。',
      )
    } finally {
      setBusy(false)
    }
  }

  const submitCorpus = async (text: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await service.submitSecondAnswerToCorpus(
        session.id,
        text,
        question.topic,
      )
      onChange(result.session)
      setMessage('第二次回答已收录到个人语料。')
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '收录失败，请重试。',
      )
    } finally {
      setBusy(false)
    }
  }

  const summary: FeedbackSummary =
    session.aiFeedback?.summary ??
    createLocalSummary(session.attempts[0]?.metrics ?? {
      durationMs: 0,
      wordCount: 0,
      wordsPerMinute: null,
      fillerWords: [],
      fillerCount: 0,
      repeatedWords: [],
      repeatedWordCount: 0,
      caveats: [],
    })
  const summarySource = session.aiFeedback?.summary ? 'AI 分析' : '本地分析'

  return (
    <section className="practice-page">
      <div className="practice-topbar">
        <button type="button" className="icon-button" onClick={onBack} aria-label="返回题库">
          ←
        </button>
        <div className="step-track" aria-label={`当前第 ${step} 步，共 5 步`}>
          {[1, 2, 3, 4, 5].map((value) => (
            <span key={value} className={value <= step ? 'active' : ''} />
          ))}
        </div>
        <span className="step-count">{step}/5</span>
      </div>

      <QuestionCard
        question={question}
        speaking={focusState === 'tts'}
        recording={isRecording}
        onSpeak={() => void speak(question.prompt)}
        onStop={() => void audioFocus.stopTTS()}
      />

      {message ? <div className="notice" role="status">{message}</div> : null}

      {stage === 'first-record' ? (
        <RecordingStage
          eyebrow="第一次回答"
          heading="先自然回答，不用追求完美。"
          buttonLabel="开始第 1 次录音"
          isRecording={isRecording}
          busy={busy}
          elapsedMs={elapsedMs}
          transcript={liveTranscript}
          sttNote={sttNote}
          onStart={() => void startRecording('attempt-1')}
          onStop={() => void stopAndSave()}
        />
      ) : null}

      {stage === 'review-first' ? (
        <>
          <AttemptReview
            attempt={session.attempts[0]!}
            label="第一次回答"
            busy={busy || aiBusy}
            onPlay={() => void playAttempt(session.attempts[0]!)}
            onSaveTranscript={(text) => void updateTranscript(session.attempts[0]!, text)}
            onRetryTranscription={() => void retryTranscription(session.attempts[0]!)}
          />
          <SummaryFeedbackCard
            summary={summary}
            source={summarySource}
            busy={aiBusy}
          />
          {aiNote ? <div className="inline-note">{aiNote}</div> : null}
          {versions.length > 0 ? (
            <VersionOptionsStage
              versions={versions}
              busy={busy || aiBusy}
              onPreview={(text) => void speak(text)}
              onSelect={(index) => void chooseVersion(index)}
            />
          ) : aiConfigured && aiBusy ? (
            <div className="inline-note" role="status">
              正在生成 3 个建议版本，请稍候…
            </div>
          ) : (
            <section className="next-attempt-card">
              <p className="eyebrow">第二次是核心</p>
              <h2>这次只带着上面的重点，再说一次。</h2>
              <button
                type="button"
                className="primary-button"
                disabled={busy || aiBusy}
                onClick={() => void prepareSecond()}
              >
                进入第二次回答
              </button>
            </section>
          )}
          {aiConfigured && !session.aiFeedback ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busy || aiBusy}
              onClick={() => void requestAiFeedback(session)}
            >
              {aiBusy ? '正在获取 AI 分析…' : '重试 AI 分析'}
            </button>
          ) : null}
        </>
      ) : null}

      {stage === 'read-aloud' && chosenVersion ? (
        <>
          <ChosenVersionCard
            version={chosenVersion}
            onPreview={() => void speak(chosenVersion.text)}
          />
          <RecordingStage
            eyebrow="跟读"
            heading="跟着示范朗读一遍，尽量模仿发音。"
            buttonLabel="开始跟读录音"
            isRecording={isRecording}
            busy={busy}
            elapsedMs={elapsedMs}
            transcript={liveTranscript}
            sttNote={sttNote}
            onStart={() => void startRecording('read-aloud')}
            onStop={() => void stopAndSave()}
          />
        </>
      ) : null}

      {stage === 'review-aloud' && session.readAloud && chosenVersion ? (
        <ReviewStage
          readAloud={session.readAloud}
          versionText={chosenVersion.text}
          busy={busy}
          onReplaySample={() => void speak(chosenVersion.text)}
          onReplayMine={() => void playRecording(session.readAloud!.audio.id)}
          onContinue={() => void prepareSecond()}
        />
      ) : null}

      {stage === 'second-record' ? (
        <>
          {chosenVersion ? (
            <HintSection
              hint={chosenVersion.hint}
              visible={hintVisible}
              disabled={busy || isRecording}
              onHoldStart={() => setHintVisible(true)}
              onHoldEnd={() => setHintVisible(false)}
            />
          ) : null}
          <RecordingStage
            eyebrow="第二次回答"
            heading="结合刚才的重点，再完整说一次。"
            buttonLabel="开始第 2 次录音"
            isRecording={isRecording}
            busy={busy}
            elapsedMs={elapsedMs}
            transcript={liveTranscript}
            sttNote={sttNote}
            onStart={() => void startRecording('attempt-2')}
            onStop={() => void stopAndSave()}
          />
        </>
      ) : null}

      {stage === 'second-submit' ? (
        <SubmitCorpusStage
          attempt={session.attempts.find((item) => item.attemptNumber === 2)!}
          busy={busy}
          onPlay={() =>
            void playAttempt(
              session.attempts.find((item) => item.attemptNumber === 2)!,
            )
          }
          onSubmit={(text) => void submitCorpus(text)}
        />
      ) : null}

      {stage === 'completed' ? (
        <section className="completed-card">
          <span className="celebration" aria-hidden="true">✦</span>
          <p className="eyebrow">本次练习完成</p>
          <h2>第二次回答已收录到个人语料</h2>
          <p>你可以在“表达”页面试听和复习这段回答。</p>
          <button type="button" className="primary-button" onClick={onBack}>
            返回题库
          </button>
        </section>
      ) : null}
    </section>
  )
}

function QuestionCard({
  question,
  speaking,
  recording,
  onSpeak,
  onStop,
}: {
  question: Question
  speaking: boolean
  recording: boolean
  onSpeak: () => void
  onStop: () => void
}) {
  return (
    <article className="prompt-card">
      <div className="prompt-meta">
        <span>{partLabel(question.part)}</span>
        <span>{question.topic}</span>
      </div>
      <h1>{question.prompt}</h1>
      {'cuePoints' in question ? (
        <ul className="cue-list">
          {question.cuePoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
      <div className="prompt-actions">
        <button
          type="button"
          className={speaking ? 'sound-button playing' : 'sound-button'}
          disabled={recording}
          onClick={speaking ? onStop : onSpeak}
        >
          <span aria-hidden="true">{speaking ? '■' : '▶'}</span>
          {speaking ? '停止播报' : '播放题目'}
        </button>
        <span className="audio-state">
          {recording ? '录音中，播报已锁定' : speaking ? '正在播报' : '可随时重播'}
        </span>
      </div>
    </article>
  )
}

function RecordingStage({
  eyebrow,
  heading,
  buttonLabel,
  isRecording,
  busy,
  elapsedMs,
  transcript,
  sttNote,
  onStart,
  onStop,
}: {
  eyebrow: string
  heading: string
  buttonLabel: string
  isRecording: boolean
  busy: boolean
  elapsedMs: number
  transcript: string
  sttNote: string | null
  onStart: () => void
  onStop: () => void
}) {
  return (
    <section className={isRecording ? 'recording-card active' : 'recording-card'}>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{heading}</h2>
      <div className="record-visual" aria-hidden="true">
        <span /><span /><span /><span /><span /><span /><span />
      </div>
      <strong className="record-time">{formatDuration(elapsedMs)}</strong>
      <button
        type="button"
        className={isRecording ? 'record-button stop' : 'record-button'}
        disabled={busy}
        onClick={isRecording ? onStop : onStart}
      >
        <span aria-hidden="true" />
        {isRecording ? '停止并保存' : buttonLabel}
      </button>
      <p className="privacy-note">录音只保存在本机；转写失败也不会删除。</p>
      {transcript ? (
        <div className="live-transcript">
          <small>实时转写（录音后可修改）</small>
          <p>{transcript}</p>
        </div>
      ) : null}
      {sttNote ? <div className="inline-note">{sttNote}</div> : null}
    </section>
  )
}

export function AttemptReview({
  attempt,
  label,
  busy,
  onPlay,
  onSaveTranscript,
  onRetryTranscription,
}: {
  attempt: PracticeAttempt
  label: string
  busy: boolean
  onPlay: () => void
  onSaveTranscript: (text: string) => void
  onRetryTranscription?: () => void
}) {
  const [draft, setDraft] = useState(attempt.transcript.text)
  const lastIncomingTranscript = useRef({
    attemptId: attempt.id,
    text: attempt.transcript.text,
  })

  useEffect(() => {
    const previous = lastIncomingTranscript.current
    const incomingText = attempt.transcript.text
    lastIncomingTranscript.current = {
      attemptId: attempt.id,
      text: incomingText,
    }
    setDraft((current) =>
      previous.attemptId !== attempt.id || current === previous.text
        ? incomingText
        : current,
    )
  }, [attempt.id, attempt.transcript.text, attempt.transcript.updatedAt])

  return (
    <section className="review-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">已保存在本机</p>
          <h2>{label}</h2>
        </div>
        <button type="button" className="playback-button" onClick={onPlay}>
          <span aria-hidden="true">▶</span>
          回放 {formatDuration(attempt.audio.durationMs)}
        </button>
      </div>
      <label className="transcript-field">
        <span>
          转写文本
          <small>
            {attempt.transcript.status === 'pending'
              ? '原录音已保存，正在等待转写'
              : attempt.transcript.status === 'failed'
                ? '自动转写不可用，请按录音手动输入'
                : '请修正明显的识别错误'}
          </small>
        </span>
        <textarea
          value={draft}
          placeholder="在这里输入你实际说出的英文。保留 filler、重复和自我修正，分析会更真实。"
          onChange={(event) => setDraft(event.target.value)}
          rows={5}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || draft.trim() === attempt.transcript.text}
        onClick={() => onSaveTranscript(draft)}
      >
        保存转写并重新分析
      </button>
      {(attempt.transcript.status === 'failed' ||
        attempt.transcript.status === 'pending') &&
      onRetryTranscription ? (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onRetryTranscription}
        >
          {attempt.transcript.status === 'pending'
            ? '重新发起云端 STT 转写'
            : '用云端 STT 重试转写'}
        </button>
      ) : null}
      <p className="analysis-caveat">这里不做发音分；文本也不会被当作发音事实。</p>
    </section>
  )
}

function SummaryFeedbackCard({
  summary,
  source,
  busy,
}: {
  summary: FeedbackSummary
  source: string
  busy: boolean
}) {
  return (
    <section className="summary-feedback-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{busy ? '正在分析' : source}</p>
          <h2>这次只改最重要的一件事</h2>
        </div>
      </div>
      {busy ? (
        <div className="inline-note" role="status">
          正在基于你的回答生成反馈和 3 个建议版本…
        </div>
      ) : (
        <>
          <div className="summary-line problem">
            <small>问题</small>
            <p>{summary.problem}</p>
          </div>
          <div className="summary-line suggestion">
            <small>建议</small>
            <p>{summary.suggestion}</p>
          </div>
        </>
      )}
    </section>
  )
}

function VersionOptionsStage({
  versions,
  busy,
  onPreview,
  onSelect,
}: {
  versions: AnswerVersionOption[]
  busy: boolean
  onPreview: (text: string) => void
  onSelect: (index: number) => void
}) {
  return (
    <section className="versions-card">
      <p className="eyebrow">AI 建议版本</p>
      <h2>选一个最适合你的版本，然后跟读它。</h2>
      <p className="settings-note">
        三个版本风格和难度略有差异，都贴近你的水平；正常语速朗读约 15–20 秒。
      </p>
      <div className="version-list">
        {versions.map((version, index) => (
          <article key={`${version.style}-${index}`} className="version-card">
            <div className="version-head">
              <strong>{version.style}</strong>
              <span>版本 {index + 1}</span>
            </div>
            <p>{version.text}</p>
            <div className="version-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => onPreview(version.text)}
              >
                ▶ 试听
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => onSelect(index)}
              >
                选择这个版本
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ChosenVersionCard({
  version,
  onPreview,
}: {
  version: AnswerVersionOption
  onPreview: () => void
}) {
  return (
    <section className="chosen-version-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">已选版本 · {version.style}</p>
          <h2>先听示范，再开口跟读。</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onPreview}>
          ▶ 试听示范
        </button>
      </div>
      <p className="version-quote">{version.text}</p>
    </section>
  )
}

function ReviewStage({
  readAloud,
  versionText,
  busy,
  onReplaySample,
  onReplayMine,
  onContinue,
}: {
  readAloud: ReadAloudRecord
  versionText: string
  busy: boolean
  onReplaySample: () => void
  onReplayMine: () => void
  onContinue: () => void
}) {
  const issues = readAloud.issues
  return (
    <div className="comparison-stack">
      <section className="review-aloud-card">
        <p className="eyebrow">跟读复盘</p>
        <h2>检查这次跟读的单词发音</h2>
        {readAloud.transcript.status !== 'ready' ? (
          <div className="inline-note">
            {readAloud.transcript.status === 'pending'
              ? '跟读转写仍在进行中；可先重新试听，或直接进入第二次回答。'
              : '未能获取跟读转写，无法做发音比对；你可以直接进入第二次回答。'}
          </div>
        ) : issues.length === 0 ? (
          <div className="inline-note">
            转写与范本基本一致，没有发现明显的疑似发音问题。
          </div>
        ) : (
          <>
            <ul className="issue-list">
              {issues.map((issue, index) => (
                <li key={`${issue.word}-${index}`}>
                  <span aria-hidden="true">◌</span>
                  <p>
                    单词 <strong>{issue.word}</strong>
                    {issue.heardAs
                      ? ` 可能发音不准（识别成了 “${issue.heardAs}”）`
                      : ' 可能被漏读了'}
                  </p>
                </li>
              ))}
            </ul>
            <p className="analysis-caveat">
              以上基于语音识别逐词比对，仅供发音参考，不是发音评分。
            </p>
          </>
        )}
        <div className="review-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onReplaySample}
          >
            ▶ 重新试听示范
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onReplayMine}
          >
            ▶ 回放我的跟读 {formatDuration(readAloud.audio.durationMs)}
          </button>
        </div>
        <p className="privacy-note">
          跟读内容：{versionText.slice(0, 80)}{versionText.length > 80 ? '…' : ''}
        </p>
      </section>

      <section className="next-attempt-card">
        <p className="eyebrow">第二步：第二次回答</p>
        <h2>准备好后，用这个版本的重点再完整说一次。</h2>
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={onContinue}
        >
          进入第二次回答
        </button>
      </section>
    </div>
  )
}

function HintSection({
  hint,
  visible,
  disabled,
  onHoldStart,
  onHoldEnd,
}: {
  hint: string
  visible: boolean
  disabled: boolean
  onHoldStart: () => void
  onHoldEnd: () => void
}) {
  return (
    <section className="hint-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">第二次回答提示</p>
          <h2>按住按钮查看提示，录音时不能查看。</h2>
        </div>
      </div>
      <button
        type="button"
        className={visible ? 'hint-hold-button holding' : 'hint-hold-button'}
        disabled={disabled}
        onPointerDown={(event) => {
          event.preventDefault()
          onHoldStart()
        }}
        onPointerUp={onHoldEnd}
        onPointerLeave={onHoldEnd}
        onPointerCancel={onHoldEnd}
        onContextMenu={(event) => event.preventDefault()}
      >
        {visible ? '松开即隐藏提示' : '按住查看提示'}
      </button>
      {visible && !disabled ? (
        <div className="hint-overlay">
          <small>来自所选版本的关键内容与句式</small>
          <p>{hint}</p>
        </div>
      ) : null}
    </section>
  )
}

function SubmitCorpusStage({
  attempt,
  busy,
  onPlay,
  onSubmit,
}: {
  attempt: PracticeAttempt
  busy: boolean
  onPlay: () => void
  onSubmit: (text: string) => void
}) {
  const [draft, setDraft] = useState(attempt.transcript.text)
  const lastIncomingTranscript = useRef({
    attemptId: attempt.id,
    text: attempt.transcript.text,
  })

  useEffect(() => {
    const previous = lastIncomingTranscript.current
    const incomingText = attempt.transcript.text
    lastIncomingTranscript.current = {
      attemptId: attempt.id,
      text: incomingText,
    }
    setDraft((current) =>
      previous.attemptId !== attempt.id || current === previous.text
        ? incomingText
        : current,
    )
  }, [attempt.id, attempt.transcript.text, attempt.transcript.updatedAt])

  return (
    <section className="submit-corpus-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">第二次回答</p>
          <h2>转写小改后，收录进个人语料。</h2>
        </div>
        <button type="button" className="playback-button" onClick={onPlay}>
          <span aria-hidden="true">▶</span>
          回放 {formatDuration(attempt.audio.durationMs)}
        </button>
      </div>
      <label className="transcript-field">
        <span>
          第二次回答文本
          <small>
            {attempt.transcript.status === 'pending'
              ? '原录音已保存，正在等待转写'
              : attempt.transcript.status === 'failed'
                ? '自动转写不可用，请按录音手动输入'
                : '请做少量修改，确认后提交收录'}
          </small>
        </span>
        <textarea
          value={draft}
          placeholder="在这里输入你第二次回答的英文文本。"
          onChange={(event) => setDraft(event.target.value)}
          rows={6}
        />
      </label>
      <button
        type="button"
        className="primary-button"
        disabled={busy || draft.trim().length === 0}
        onClick={() => onSubmit(draft)}
      >
        提交并收录到个人语料
      </button>
    </section>
  )
}
