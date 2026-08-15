import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { InitialTranscript, PracticeService } from '../../application/practiceService'
import type {
  ActionableFeedback,
  AiFeedback,
  PracticeAttempt,
  Question,
  TrainingSession,
} from '../../domain'
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
  const [expression, setExpression] = useState('')
  const sttSessionRef = useRef<STTSession | null>(null)
  const recordingActiveRef = useRef(false)
  const transcriptRef = useRef('')
  const finalSegmentsRef = useRef<string[]>([])
  const lifecycleGenerationRef = useRef(0)
  const lifecycleSaveInFlightRef = useRef<Promise<void> | null>(null)
  const recordingSaveOwnerRef = useRef<'idle' | 'manual' | 'lifecycle'>('idle')
  const mountedRef = useRef(true)
  const sessionRef = useRef(session)
  const recordingAttemptRef = useRef<1 | 2>(1)
  const onChangeRef = useRef(onChange)
  const aiRequestGenerationRef = useRef(0)
  const aiRequestInFlightRef = useRef(false)

  const firstAttempt = session.attempts.find(
    (attempt) => attempt.attemptNumber === 1,
  )
  const secondAttempt = session.attempts.find(
    (attempt) => attempt.attemptNumber === 2,
  )
  const recordingAttempt: 1 | 2 = firstAttempt ? 2 : 1
  const isRecording = focusState === 'recording'

  useEffect(() => {
    sessionRef.current = session
    recordingAttemptRef.current = recordingAttempt
    onChangeRef.current = onChange
  }, [onChange, recordingAttempt, session])

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

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
    const targetAttempt = recordingAttemptRef.current

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
        const updated = await service.saveAttempt(
          targetSessionId,
          targetAttempt,
          recording,
          createInterruptedTranscriptInput(transcriptRef.current),
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

  const startRecording = async () => {
    const lifecycleGeneration = ++lifecycleGenerationRef.current
    onExitGuardChange(true)
    setBusy(true)
    setMessage(null)
    setSttNote(null)
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

  const stopAndSave = async () => {
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
      let updated = await service.saveAttempt(
        session.id,
        recordingAttempt,
        recording,
        transcriptInput,
      )
      onChange(updated)

      if (useRemoteStt) {
        setMessage('原录音已保存在本机，正在请求云端 STT 转写…')
        try {
          const remoteTranscript = await remoteStt.transcribe({
            audio: recording.blob,
            mimeType: recording.mimeType,
            fileName: `attempt-${recordingAttempt}.${audioExtension(recording.mimeType)}`,
            language: 'en',
          })
          updated = await service.applySttTranscript(
            session.id,
            recordingAttempt,
            remoteTranscript,
          )
          onChange(updated)
          setMessage('录音和云端 STT 转写均已保存在本机。')
        } catch (error) {
          if (transcript.length > 0) {
            updated = await service.applySttTranscript(
              session.id,
              recordingAttempt,
              transcript,
            )
            onChange(updated)
            setMessage('云端 STT 失败，已保留原录音并采用设备转写。')
          } else {
            updated = await service.markTranscriptionFailed(
              session.id,
              recordingAttempt,
              'remote-stt-failed',
            )
            onChange(updated)
            setMessage(
              error instanceof Error
                ? `${error.message} 原录音已保留，可重试或手工输入。`
                : '云端 STT 失败；原录音已保留，可重试或手工输入。',
            )
          }
        }
      } else {
        setMessage(
          transcript
            ? '录音和转写已保存在本机。'
            : '录音已保存在本机；请手动补充转写。',
        )
      }

      if (recordingAttempt === 1) {
        await requestAiFeedback(updated)
      } else {
        await requestAiComparison(updated)
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
    setAiNote('正在获取少量 Text AI 反馈…')
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
        setAiNote('转写已发生变化，本次旧 Text AI 结果未保存；可按新转写重试。')
        return
      }
      onChange(updated)
      setAiNote('Text AI 反馈已保存；本地反馈和原录音未被覆盖。')
    } catch (error) {
      if (generation !== aiRequestGenerationRef.current) return
      setAiNote(
        error instanceof Error
          ? `${error.message} 你仍可使用本地反馈继续。`
          : 'Text AI 暂不可用；你仍可使用本地反馈继续。',
      )
    } finally {
      if (generation === aiRequestGenerationRef.current) {
        aiRequestInFlightRef.current = false
        setAiBusy(false)
      }
    }
  }

  const requestAiComparison = async (targetSession: TrainingSession) => {
    const first = targetSession.attempts.find(
      (item) => item.attemptNumber === 1,
    )
    const second = targetSession.attempts.find(
      (item) => item.attemptNumber === 2,
    )
    if (
      !textAi.isConfigured() ||
      targetSession.comparison === null ||
      first?.transcript.status !== 'ready' ||
      second?.transcript.status !== 'ready' ||
      first.transcript.text.trim().length === 0 ||
      second.transcript.text.trim().length === 0
    ) {
      return
    }

    if (aiRequestInFlightRef.current) {
      setAiNote('Text AI 仍在处理，请等待本次请求完成。')
      return
    }

    const generation = ++aiRequestGenerationRef.current
    aiRequestInFlightRef.current = true
    setAiBusy(true)
    setAiNote('正在比较两次真实回答，只提取最重要的变化…')
    try {
      const feedback = await textAi.compareAttempts({
        question,
        firstTranscript: first.transcript.text,
        secondTranscript: second.transcript.text,
        localComparison: targetSession.comparison,
      })
      if (generation !== aiRequestGenerationRef.current) return

      const updated = await service.applyAiComparisonIfTranscriptsCurrent(
        targetSession.id,
        {
          first: {
            attemptId: first.id,
            text: first.transcript.text,
            updatedAt: first.transcript.updatedAt,
          },
          second: {
            attemptId: second.id,
            text: second.transcript.text,
            updatedAt: second.transcript.updatedAt,
          },
        },
        feedback,
      )
      if (generation !== aiRequestGenerationRef.current) return
      if (updated === null) {
        setAiNote('两次转写已经变化，旧的 AI 对比未保存；可按新转写重试。')
        return
      }
      onChange(updated)
      setAiNote('AI 对比已保存；本地指标和两段原录音均未被覆盖。')
    } catch (error) {
      if (generation !== aiRequestGenerationRef.current) return
      setAiNote(
        error instanceof Error
          ? `${error.message} 本地两次对比仍可正常使用。`
          : 'Text AI 对比暂不可用；本地两次对比仍可正常使用。',
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
      if (updated.attempts.some((item) => item.attemptNumber === 2)) {
        await requestAiComparison(updated)
      } else if (attempt.attemptNumber === 1) {
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

  const playAttempt = async (attempt: PracticeAttempt) => {
    setMessage(null)
    try {
      const blob = await service.getAudio(attempt.audio.id)
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
      if (updated.attempts.some((item) => item.attemptNumber === 2)) {
        await requestAiComparison(updated)
      } else if (attempt.attemptNumber === 1) {
        await requestAiFeedback(updated)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '转写保存失败。')
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
      setMessage(error instanceof Error ? error.message : '暂时无法进入第二次回答。')
    } finally {
      setBusy(false)
    }
  }

  const saveExpression = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await service.saveExpression(
        session.id,
        expression,
        question.topic,
        2,
      )
      onChange(result.session)
      setExpression('')
      setMessage('已保存到“我的表达”，重新打开 App 后仍会保留。')
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '表达保存失败，请重试。',
      )
    } finally {
      setBusy(false)
    }
  }

  const step = secondAttempt ? 4 : session.status === 'second-ready' ? 3 : firstAttempt ? 2 : 1

  return (
    <section className="practice-page">
      <div className="practice-topbar">
        <button type="button" className="icon-button" onClick={onBack} aria-label="返回题库">
          ←
        </button>
        <div className="step-track" aria-label={`当前第 ${step} 步，共 4 步`}>
          {[1, 2, 3, 4].map((value) => (
            <span key={value} className={value <= step ? 'active' : ''} />
          ))}
        </div>
        <span className="step-count">{step}/4</span>
      </div>

      <QuestionCard
        question={question}
        speaking={focusState === 'tts'}
        recording={isRecording}
        onSpeak={() => void speak(question.prompt)}
        onStop={() => void audioFocus.stopTTS()}
      />

      {message ? <div className="notice" role="status">{message}</div> : null}

      {!firstAttempt ? (
        <RecordingStage
          attemptNumber={1}
          isRecording={isRecording}
          busy={busy}
          elapsedMs={elapsedMs}
          transcript={liveTranscript}
          sttNote={sttNote}
          onStart={() => void startRecording()}
          onStop={() => void stopAndSave()}
        />
      ) : session.status !== 'second-ready' && !secondAttempt ? (
        <>
          <AttemptReview
            attempt={firstAttempt}
            label="第一次回答"
            busy={busy || aiBusy}
            onPlay={() => void playAttempt(firstAttempt)}
            onSaveTranscript={(text) => void updateTranscript(firstAttempt, text)}
            onRetryTranscription={() => void retryTranscription(firstAttempt)}
          />
          <FeedbackPanel
            feedback={session.localFeedback}
            aiFeedback={session.aiFeedback}
            aiNote={aiNote}
            aiConfigured={textAi.isConfigured()}
            busy={aiBusy}
            onRetryAi={() => void requestAiFeedback(session)}
            onSpeak={(text) => void speak(text)}
          />
          <section className="next-attempt-card">
            <p className="eyebrow">第二次是核心</p>
            <h2>这次只带着上面的重点，再说一次。</h2>
            <p>不用背完整答案；保留你的想法，只让表达更稳、更清楚。</p>
            <button
              type="button"
              className="primary-button"
              disabled={busy || aiBusy}
              onClick={() => void prepareSecond()}
            >
              准备第二次回答
            </button>
          </section>
        </>
      ) : session.status === 'second-ready' && !secondAttempt ? (
        <>
          <FocusReminder
            feedback={session.localFeedback}
            aiFeedback={session.aiFeedback}
          />
          <RecordingStage
            attemptNumber={2}
            isRecording={isRecording}
            busy={busy}
            elapsedMs={elapsedMs}
            transcript={liveTranscript}
            sttNote={sttNote}
            onStart={() => void startRecording()}
            onStop={() => void stopAndSave()}
          />
        </>
      ) : firstAttempt && secondAttempt ? (
        <ComparisonView
          session={session}
          first={firstAttempt}
          second={secondAttempt}
          busy={busy}
          aiBusy={aiBusy}
          aiNote={aiNote}
          aiConfigured={textAi.isConfigured()}
          expression={expression}
          onExpressionChange={setExpression}
          onPlay={(attempt) => void playAttempt(attempt)}
          onSaveTranscript={(attempt, text) => void updateTranscript(attempt, text)}
          onRetryTranscription={(attempt) => void retryTranscription(attempt)}
          onSaveExpression={() => void saveExpression()}
          onSpeakExpression={(text) => void speak(text)}
          onRetryAi={() => void requestAiComparison(session)}
        />
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
  attemptNumber,
  isRecording,
  busy,
  elapsedMs,
  transcript,
  sttNote,
  onStart,
  onStop,
}: {
  attemptNumber: 1 | 2
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
      <p className="eyebrow">第 {attemptNumber} 次回答</p>
      <h2>
        {attemptNumber === 1
          ? '先自然回答，不用追求完美。'
          : '带着上面的重点，再完整说一次。'}
      </h2>
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
        {isRecording ? '停止并保存' : `开始第 ${attemptNumber} 次录音`}
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
      <Metrics metrics={attempt.metrics} />
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

function Metrics({ metrics }: { metrics: PracticeAttempt['metrics'] }) {
  return (
    <div className="metrics-grid">
      <div><small>时长</small><strong>{formatDuration(metrics.durationMs)}</strong></div>
      <div><small>约 WPM</small><strong>{metrics.wordsPerMinute ?? '—'}</strong></div>
      <div><small>Filler</small><strong>{metrics.fillerCount}</strong></div>
      <div><small>重复词</small><strong>{metrics.repeatedWordCount}</strong></div>
      {metrics.acoustic ? (
        <>
          <div>
            <small>静音占比</small>
            <strong>{Math.round(metrics.acoustic.silenceRatio * 100)}%</strong>
          </div>
          <div>
            <small>长停顿</small>
            <strong>{metrics.acoustic.longPauseCount}</strong>
          </div>
        </>
      ) : null}
    </div>
  )
}

function FeedbackPanel({
  feedback,
  aiFeedback,
  aiNote,
  aiConfigured,
  busy,
  onRetryAi,
  onSpeak,
}: {
  feedback: ActionableFeedback[]
  aiFeedback: AiFeedback | null
  aiNote: string | null
  aiConfigured: boolean
  busy: boolean
  onRetryAi: () => void
  onSpeak: (text: string) => void
}) {
  return (
    <section className="feedback-section">
      <p className="eyebrow">本地反馈 · 最多 3 条</p>
      <h2>这次只改最重要的几件事</h2>
      {feedback.length > 0 ? (
        <div className="feedback-list">
          {feedback.map((item, index) => (
            <article key={`${item.title}-${index}`} className={`feedback-card ${item.kind}`}>
              <span className="feedback-index">{index + 1}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.observation}</p>
                <strong>{item.action}</strong>
                {item.evidence ? <small>依据：{item.evidence}</small> : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-feedback">
          当前没有足够的高置信度文本信号。可以先补充转写，再重新分析。
        </div>
      )}
      {aiFeedback ? (
        <div className="ai-feedback-block">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Text AI · 已校验结构</p>
              <h3>补充语言反馈</h3>
            </div>
          </div>
          <div className="feedback-list">
            {aiFeedback.keyIssues.map((item, index) => (
              <article
                key={`${item.title}-${index}`}
                className={`feedback-card ${item.kind}`}
              >
                <span className="feedback-index">AI</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.observation}</p>
                  <strong>{item.action}</strong>
                  {item.evidence ? <small>依据：{item.evidence}</small> : null}
                </div>
              </article>
            ))}
          </div>
          {aiFeedback.revisions.naturalVersion ? (
            <div className="natural-version-card">
              <small>Natural Version（只作可说出口的参考）</small>
              <p>{aiFeedback.revisions.naturalVersion}</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => onSpeak(aiFeedback.revisions.naturalVersion ?? '')}
              >
                ▶ 听推荐表达
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="ai-offline-row">
          <span aria-hidden="true">✓</span>
          {aiConfigured
            ? 'Text AI 暂无有效结果；本地反馈仍可继续使用。'
            : 'Text AI 未配置也能继续；当前显示可解释的本地分析。'}
        </div>
      )}
      {aiNote ? <div className="inline-note">{aiNote}</div> : null}
      {aiConfigured && !aiFeedback ? (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onRetryAi}
        >
          {busy ? '正在获取 Text AI 反馈…' : '获取 / 重试 Text AI 反馈'}
        </button>
      ) : null}
    </section>
  )
}

function FocusReminder({
  feedback,
  aiFeedback,
}: {
  feedback: ActionableFeedback[]
  aiFeedback: AiFeedback | null
}) {
  const aiTips = aiFeedback?.secondAttemptTips ?? []
  const reminders = aiTips.length > 0
    ? aiTips.map((action, index) => ({
        title: `AI 重点 ${index + 1}`,
        action,
      }))
    : feedback
  return (
    <section className="focus-reminder">
      <p className="eyebrow">第二次回答目标</p>
      <h2>不要背范文，只带走这些动作。</h2>
      <ol>
        {(reminders.length ? reminders : [
          {
            title: '保留你的想法',
            action: '用更清楚的一到两个句子重新组织刚才的内容。',
          },
        ]).map((item, index) => (
          <li key={`${item.title}-${index}`}>
            <span>{index + 1}</span>
            <p><strong>{item.title}</strong>{item.action}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ComparisonView({
  session,
  first,
  second,
  busy,
  aiBusy,
  aiNote,
  aiConfigured,
  expression,
  onExpressionChange,
  onPlay,
  onSaveTranscript,
  onRetryTranscription,
  onSaveExpression,
  onSpeakExpression,
  onRetryAi,
}: {
  session: TrainingSession
  first: PracticeAttempt
  second: PracticeAttempt
  busy: boolean
  aiBusy: boolean
  aiNote: string | null
  aiConfigured: boolean
  expression: string
  onExpressionChange: (value: string) => void
  onPlay: (attempt: PracticeAttempt) => void
  onSaveTranscript: (attempt: PracticeAttempt, text: string) => void
  onRetryTranscription: (attempt: PracticeAttempt) => void
  onSaveExpression: () => void
  onSpeakExpression: (text: string) => void
  onRetryAi: () => void
}) {
  const comparison = session.comparison

  return (
    <div className="comparison-stack">
      <section className="comparison-intro">
        <span className="celebration" aria-hidden="true">✦</span>
        <p className="eyebrow">两次回答已完成</p>
        <h2>看见具体变化，不给一个虚假的总分。</h2>
        <p>两段原始录音都已保留，你可以随时回听和修正转写。</p>
      </section>

      <div className="attempt-columns">
        <AttemptReview
          attempt={first}
          label="第一次回答"
          busy={busy}
          onPlay={() => onPlay(first)}
          onSaveTranscript={(text) => onSaveTranscript(first, text)}
          onRetryTranscription={() => onRetryTranscription(first)}
        />
        <AttemptReview
          attempt={second}
          label="第二次回答"
          busy={busy}
          onPlay={() => onPlay(second)}
          onSaveTranscript={(text) => onSaveTranscript(second, text)}
          onRetryTranscription={() => onRetryTranscription(second)}
        />
      </div>

      {comparison ? (
        <section className="delta-card">
          <p className="eyebrow">变化对比</p>
          <h2>第二次发生了什么？</h2>
          <div className="delta-grid">
            <Delta
              label="Filler"
              value={comparison.fillerCount?.delta ?? null}
              unit="次"
              inverse
            />
            <Delta
              label="重复词"
              value={comparison.repeatedWordCount?.delta ?? null}
              unit="次"
              inverse
            />
            <Delta
              label="约 WPM"
              value={comparison.wordsPerMinute?.delta ?? null}
              unit=""
            />
            <Delta
              label="长停顿"
              value={comparison.longPauseCount?.delta ?? null}
              unit="次"
              inverse
            />
          </div>
          <div className="comparison-feedback">
            {comparison.feedback.map((item) => (
              <div key={item.title}>
                <span aria-hidden="true">{item.kind === 'improvement' ? '↑' : '→'}</span>
                <p><strong>{item.title}</strong>{item.observation}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="ai-comparison-card">
        <p className="eyebrow">Text AI · 两次回答对比</p>
        <h2>只看最值得保留和继续改的一两件事</h2>
        {session.aiComparison ? (
          <>
            <div className="comparison-feedback">
              {session.aiComparison.keyIssues.map((item, index) => (
                <div key={`${item.title}-${index}`}>
                  <span aria-hidden="true">AI</span>
                  <p><strong>{item.title}</strong>{item.observation}<em>{item.action}</em></p>
                </div>
              ))}
            </div>
            {session.aiComparison.revisions.minimalFix ? (
              <div className="natural-version-card">
                <small>Minimal Fix（保留你的原意）</small>
                <p>{session.aiComparison.revisions.minimalFix}</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onSpeakExpression(
                    session.aiComparison?.revisions.minimalFix ?? '',
                  )}
                >
                  ▶ 听最小修正版
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="settings-note">
            {aiConfigured
              ? '尚无有效 AI 对比；本地指标不受影响。'
              : '云端未配置时仍可完整查看本地两次对比。'}
          </p>
        )}
        {aiNote ? <div className="inline-note">{aiNote}</div> : null}
        {aiConfigured && !session.aiComparison ? (
          <button
            type="button"
            className="secondary-button"
            disabled={busy || aiBusy}
            onClick={onRetryAi}
          >
            {aiBusy ? '正在比较…' : '获取 / 重试 AI 对比'}
          </button>
        ) : null}
      </section>

      <section className="save-expression-card">
        <p className="eyebrow">个人语料</p>
        <h2>保存一句你以后真的会说的话</h2>
        <p>从第二次回答中挑一句自然、准确、容易再次说出口的表达。</p>
        <label>
          <span>可复用表达</span>
          <textarea
            rows={3}
            value={expression}
            placeholder="例如：What I like most is that everything I need is within walking distance."
            onChange={(event) => onExpressionChange(event.target.value)}
          />
        </label>
        <div className="expression-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!expression.trim()}
            onClick={() => onSpeakExpression(expression)}
          >
            ▶ 听示范
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !expression.trim()}
            onClick={onSaveExpression}
          >
            保存表达
          </button>
        </div>
      </section>
    </div>
  )
}

function Delta({
  label,
  value,
  unit,
  inverse = false,
}: {
  label: string
  value: number | null
  unit: string
  inverse?: boolean
}) {
  const favorable = value !== null && (inverse ? value < 0 : value > 0)
  return (
    <div className={favorable ? 'favorable' : ''}>
      <small>{label}</small>
      <strong>
        {value === null ? '—' : `${value > 0 ? '+' : ''}${value}${unit}`}
      </strong>
    </div>
  )
}
