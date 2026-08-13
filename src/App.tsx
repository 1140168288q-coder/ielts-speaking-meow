import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import type { InitialTranscript, PracticeService } from './application/practiceService'
import { createBrowserRuntime } from './app/runtime'
import { ImportController } from './app/ImportController'
import { SettingsController } from './app/SettingsController'
import { questionBank } from './data/questions'
import type {
  ActionableFeedback,
  AiFeedback,
  PracticeAttempt,
  Question,
  SavedExpression,
  TrainingSession,
} from './domain/models'
import type { ImportedQuestionRecord } from './domain/imports'
import type { LLMProvider } from './ports/ai'
import type {
  AudioFocus,
  AudioFocusState,
  RecordedAudioSTTProvider,
  STTProvider,
  STTSession,
} from './ports/speech'

type AppView =
  | 'questions'
  | 'practice'
  | 'history'
  | 'expressions'
  | 'imports'
  | 'settings'

const partLabel = (part: 1 | 2 | 3) => `Part ${part}`

const formatDuration = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0
    ? `${minutes}:${seconds.toString().padStart(2, '0')}`
    : `${seconds} 秒`
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))

const audioExtension = (mimeType: string) => {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'm4a'
  if (mimeType.includes('mpeg')) return 'mp3'
  return 'webm'
}

const statusLabel: Record<TrainingSession['status'], string> = {
  'first-ready': '等待第一次回答',
  'first-review': '查看第一次反馈',
  'feedback-ready': '查看反馈',
  'second-ready': '等待第二次回答',
  'comparison-ready': '查看两次对比',
  completed: '已完成',
}

export const SAFE_PRACTICE_BACK_EVENT = 'ielts-speaking-meow:safe-practice-back'

// eslint-disable-next-line react-refresh/only-export-components -- pure scroll behavior has a focused navigation regression test.
export function resetViewScroll(): void {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

export type AndroidBackAction =
  | 'safe-practice-exit'
  | 'questions'
  | 'browser-back'
  | 'exit-app'

// eslint-disable-next-line react-refresh/only-export-components -- kept pure for native Back routing tests.
export const resolveAndroidBackAction = (
  view: AppView,
  canGoBack: boolean,
): AndroidBackAction => {
  if (view === 'practice') {
    return 'safe-practice-exit'
  }
  if (view !== 'questions') {
    return 'questions'
  }
  return canGoBack ? 'browser-back' : 'exit-app'
}

/**
 * Shared by visible navigation today and a future native Back adapter. Leaving
 * is deliberately denied while microphone capture is pending, active, or being
 * persisted so an answer cannot be abandoned silently.
 */
// eslint-disable-next-line react-refresh/only-export-components -- native Back integration reuses this guard.
export const requestSafePracticeExit = async (
  audioFocus: Pick<AudioFocus, 'state' | 'stopAllPlayback'>,
  exitGuardActive: boolean,
  onExit: () => void,
): Promise<boolean> => {
  if (exitGuardActive || audioFocus.state === 'recording') {
    return false
  }

  await audioFocus.stopAllPlayback()
  onExit()
  return true
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for permission-copy regression tests.
export const formatMicrophoneStartError = (error: unknown): string => {
  const errorLike =
    typeof error === 'object' && error !== null
      ? (error as { name?: unknown; message?: unknown })
      : null
  const name = typeof errorLike?.name === 'string' ? errorLike.name : ''
  const message =
    typeof errorLike?.message === 'string' ? errorLike.message : ''

  const permissionDenied =
    name.toLowerCase() === 'notallowederror' ||
    message.toLowerCase().includes('permission denied')

  if (permissionDenied) {
    return '无法开始录音：麦克风权限未开启。请前往“系统设置 → 应用 → 雅思口语喵 → 权限 → 麦克风”并允许访问，然后返回重试。'
  }

  return error instanceof Error
    ? `无法开始录音：${error.message}`
    : '无法开始录音，请检查麦克风权限。'
}

export function App() {
  const [runtime] = useState(createBrowserRuntime)

  const [view, setView] = useState<AppView>('questions')
  const [session, setSession] = useState<TrainingSession | null>(null)
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [expressions, setExpressions] = useState<SavedExpression[]>([])
  const [importedQuestions, setImportedQuestions] = useState<
    ImportedQuestionRecord[]
  >([])
  const [loading, setLoading] = useState(true)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null)
  const [practiceExitGuardActive, setPracticeExitGuardActive] = useState(false)

  const refreshLibrary = useCallback(async () => {
    const [nextSessions, nextExpressions, nextImportedQuestions] = await Promise.all([
      runtime.practiceService.listSessions(),
      runtime.practiceService.listExpressions(),
      runtime.storage.listImportedQuestions(),
    ])
    setSessions(nextSessions)
    setExpressions(nextExpressions)
    setImportedQuestions(nextImportedQuestions)
  }, [runtime.practiceService, runtime.storage])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        await runtime.initialize()
        await refreshLibrary()
      } catch (error) {
        if (active) {
          setStorageError(
            error instanceof Error ? error.message : '本地数据读取失败。',
          )
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      active = false
      void runtime.audioFocus.cancelRecording()
      void runtime.audioFocus.stopAllPlayback()
      void runtime.storage.close()
    }
  }, [refreshLibrary, runtime])

  const openSession = (nextSession: TrainingSession) => {
    setPracticeExitGuardActive(false)
    setNavigationNotice(null)
    setSession(nextSession)
    setView('practice')
  }

  const startQuestion = async (question: Question) => {
    try {
      const nextSession = await runtime.practiceService.createSession(question.id)
      setSessions((current) => [nextSession, ...current])
      openSession(nextSession)
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : '无法开始本次练习。',
      )
    }
  }

  const handleSessionChange = (nextSession: TrainingSession) => {
    setSession(nextSession)
    setSessions((current) => [
      nextSession,
      ...current.filter((item) => item.id !== nextSession.id),
    ])
    void refreshLibrary().catch(() => undefined)
  }

  const navigateSafely = useCallback(
    (nextView: Exclude<AppView, 'practice'>) => {
      void requestSafePracticeExit(
        runtime.audioFocus,
        practiceExitGuardActive,
        () => {
          setNavigationNotice(null)
          setView(nextView)
        },
      )
        .then((didExit) => {
          if (didExit) {
            return
          }
          setNavigationNotice(
            '正在申请麦克风、录音或保存回答。请先完成“停止并保存”，再离开练习。',
          )
          window.scrollTo({ top: 0, behavior: 'smooth' })
        })
        .catch((error: unknown) => {
          setNavigationNotice(
            error instanceof Error
              ? `暂时无法安全离开：${error.message}`
              : '暂时无法安全离开，请先停止当前音频。',
          )
        })
    },
    [practiceExitGuardActive, runtime.audioFocus],
  )

  const viewRef = useRef(view)
  const navigateSafelyRef = useRef(navigateSafely)

  useEffect(() => {
    viewRef.current = view
    navigateSafelyRef.current = navigateSafely
  }, [navigateSafely, view])

  useEffect(() => {
    resetViewScroll()
  }, [view])

  useEffect(() => {
    const handleSafeBack = () => navigateSafelyRef.current('questions')
    window.addEventListener(SAFE_PRACTICE_BACK_EVENT, handleSafeBack)
    return () => {
      window.removeEventListener(SAFE_PRACTICE_BACK_EVENT, handleSafeBack)
    }
  }, [])

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') {
      return
    }

    let disposed = false
    let listenerHandle: PluginListenerHandle | undefined

    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      const action = resolveAndroidBackAction(viewRef.current, canGoBack)
      switch (action) {
        case 'safe-practice-exit':
          window.dispatchEvent(new Event(SAFE_PRACTICE_BACK_EVENT))
          break
        case 'questions':
          navigateSafelyRef.current('questions')
          break
        case 'browser-back':
          window.history.back()
          break
        case 'exit-app':
          void CapacitorApp.exitApp()
          break
      }
    })
      .then((handle) => {
        if (disposed) {
          void handle.remove()
          return
        }
        listenerHandle = handle
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      if (listenerHandle) {
        void listenerHandle.remove()
      }
    }
  }, [])

  const allQuestions = [
    ...questionBank,
    ...importedQuestions.map((record) => record.question),
  ]
  const activeQuestion = session
    ? allQuestions.find((question) => question.id === session.questionId) ?? null
    : null

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="brand"
          type="button"
          onClick={() => navigateSafely('questions')}
          aria-label="回到题库"
        >
          <span className="brand-mark" aria-hidden="true">
            喵
          </span>
          <span>
            <strong>雅思口语喵</strong>
            <small>两次开口，看见进步</small>
          </span>
        </button>
        <span className="offline-badge">本地优先</span>
      </header>

      {storageError ? (
        <div className="notice notice-error" role="alert">
          <span>{storageError}</span>
          <button type="button" onClick={() => setStorageError(null)}>
            知道了
          </button>
        </div>
      ) : null}

      {navigationNotice ? (
        <div className="notice navigation-notice" role="alert">
          <span>{navigationNotice}</span>
          <button type="button" onClick={() => setNavigationNotice(null)}>
            知道了
          </button>
        </div>
      ) : null}

      <main className="app-main">
        {loading ? (
          <LoadingView />
        ) : view === 'questions' ? (
          <QuestionLibrary
            questions={allQuestions}
            sessions={sessions}
            onStart={(question) => void startQuestion(question)}
            onResume={openSession}
            onImport={() => navigateSafely('imports')}
          />
        ) : view === 'practice' && session && activeQuestion ? (
          <PracticeFlow
            key={session.id}
            question={activeQuestion}
            session={session}
            service={runtime.practiceService}
            audioFocus={runtime.audioFocus}
            stt={runtime.stt}
            remoteStt={runtime.remoteStt}
            textAi={runtime.textAi}
            onExitGuardChange={setPracticeExitGuardActive}
            onChange={handleSessionChange}
            onBack={() => navigateSafely('questions')}
          />
        ) : view === 'history' ? (
          <HistoryView
            questions={allQuestions}
            sessions={sessions}
            onOpen={openSession}
          />
        ) : view === 'expressions' ? (
          <ExpressionLibrary
            expressions={expressions}
            audioFocus={runtime.audioFocus}
          />
        ) : view === 'imports' ? (
          <ImportController
            service={runtime.importService}
            organizer={runtime.textAi}
            existingQuestions={allQuestions}
            onImported={(records) => {
              setImportedQuestions((current) => [
                ...current.filter(
                  (existing) =>
                    !records.some((record) => record.id === existing.id),
                ),
                ...records,
              ])
            }}
            onStartQuestion={(question) => void startQuestion(question)}
            onBack={() => navigateSafely('questions')}
          />
        ) : (
          <SettingsController
            backendClient={runtime.backendClient}
            systemStt={runtime.stt}
            audioFocus={runtime.audioFocus}
          />
        )}
      </main>

      {view !== 'practice' ? (
        <BottomNavigation view={view} onChange={navigateSafely} />
      ) : null}
    </div>
  )
}

function LoadingView() {
  return (
    <div className="loading-view" role="status">
      <span className="loading-paw" aria-hidden="true">
        ●
      </span>
      正在打开本地练习记录…
    </div>
  )
}

function BottomNavigation({
  view,
  onChange,
}: {
  view: AppView
  onChange: (view: Exclude<AppView, 'practice'>) => void
}) {
  const items: Array<{ view: Exclude<AppView, 'practice'>; label: string; icon: string }> = [
    { view: 'questions', label: '练习', icon: '◉' },
    { view: 'history', label: '记录', icon: '↻' },
    { view: 'expressions', label: '表达', icon: '✦' },
    { view: 'settings', label: '设置', icon: '⚙' },
  ]

  return (
    <nav className="bottom-nav" aria-label="主导航">
      {items.map((item) => (
        <button
          type="button"
          key={item.view}
          className={view === item.view ? 'active' : ''}
          onClick={() => onChange(item.view)}
        >
          <span aria-hidden="true">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  )
}

function QuestionLibrary({
  questions,
  sessions,
  onStart,
  onResume,
  onImport,
}: {
  questions: Question[]
  sessions: TrainingSession[]
  onStart: (question: Question) => void
  onResume: (session: TrainingSession) => void
  onImport: () => void
}) {
  const [part, setPart] = useState<1 | 2 | 3>(1)
  const partQuestions = questions.filter((question) => question.part === part)
  const resumable = sessions.find((item) => item.status !== 'completed')
  const resumableQuestion = resumable
    ? questions.find((question) => question.id === resumable.questionId)
    : undefined

  const pickRandom = () => {
    const index = Math.floor(Math.random() * partQuestions.length)
    const question = partQuestions[index]
    if (question) {
      onStart(question)
    }
  }

  return (
    <section className="page-stack">
      <div className="hero-card">
        <div>
          <p className="eyebrow">今天就练一道</p>
          <h1>先自然回答，再带着重点说得更好。</h1>
          <p>不打虚假的总分，只给这一次最值得改的 2–3 件事。</p>
        </div>
        <div className="hero-cat" aria-hidden="true">
          <span>◕ᴗ◕</span>
        </div>
      </div>

      {resumable && resumableQuestion ? (
        <button
          type="button"
          className="resume-card"
          onClick={() => onResume(resumable)}
        >
          <span className="resume-icon" aria-hidden="true">
            ▶
          </span>
          <span>
            <small>继续上次练习 · {partLabel(resumableQuestion.part)}</small>
            <strong>{resumableQuestion.prompt}</strong>
            <em>{statusLabel[resumable.status]}</em>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      ) : null}

      <div className="section-heading">
        <div>
          <p className="eyebrow">基础题库</p>
          <h2>选择一道单题</h2>
        </div>
        <button className="secondary-button compact" type="button" onClick={pickRandom}>
          随机一题
        </button>
        <button className="secondary-button compact" type="button" onClick={onImport}>
          导入材料
        </button>
      </div>

      <div className="part-tabs" role="tablist" aria-label="IELTS Speaking 部分">
        {([1, 2, 3] as const).map((value) => (
          <button
            role="tab"
            aria-selected={part === value}
            type="button"
            key={value}
            className={part === value ? 'active' : ''}
            onClick={() => setPart(value)}
          >
            Part {value}
            <small>{value === 1 ? '短问答' : value === 2 ? '话题卡' : '观点题'}</small>
          </button>
        ))}
      </div>

      <div className="question-list">
        {partQuestions.map((question, index) => (
          <article className="question-row" key={question.id}>
            <span className="question-number">{String(index + 1).padStart(2, '0')}</span>
            <button type="button" onClick={() => onStart(question)}>
              <small>{question.topic}</small>
              <strong>{question.prompt}</strong>
              <span>开始练习 <b aria-hidden="true">→</b></span>
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

function useAudioFocus(audioFocus: AudioFocus) {
  const [state, setState] = useState<AudioFocusState>(audioFocus.state)

  useEffect(() => audioFocus.subscribe(setState), [audioFocus])
  return state
}

function PracticeFlow({
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
    if (!isRecording) {
      return
    }

    const started = Date.now()
    const update = () => setElapsedMs(Date.now() - started)
    update()
    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [isRecording])

  const releaseAudioForLifecycle = useCallback(() => {
    lifecycleGenerationRef.current += 1
    recordingActiveRef.current = false
    const currentSttSession = sttSessionRef.current
    sttSessionRef.current = null
    void currentSttSession?.abort().catch(() => undefined)
    onExitGuardChange(false)
    void audioFocus.cancelRecording().catch(() => undefined)
    void audioFocus.stopAllPlayback().catch(() => undefined)
  }, [audioFocus, onExitGuardChange])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        releaseAudioForLifecycle()
      }
    }
    const handlePageHide = () => releaseAudioForLifecycle()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      recordingActiveRef.current = false
      releaseAudioForLifecycle()
    }
  }, [releaseAudioForLifecycle])

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
        await audioFocus.cancelRecording()
        onExitGuardChange(false)
        setMessage('页面已离开前台，本次未完成录音已安全取消。')
        return
      }
      recordingActiveRef.current = true
      if (remoteStt.isConfigured()) {
        setSttNote('停止后会先保存原录音，再使用云端 STT 转写。')
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
        setMessage('原录音已保存在本机，正在请求独立 STT API…')
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
          setMessage('录音和独立 STT 转写均已保存在本机。')
        } catch (error) {
          if (transcript.length > 0) {
            updated = await service.applySttTranscript(
              session.id,
              recordingAttempt,
              transcript,
            )
            onChange(updated)
            setMessage('远程 STT 失败，已保留原录音并采用设备转写。')
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
                : '远程 STT 失败；原录音已保留，可重试或手工输入。',
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
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '录音保存失败，请重试。',
      )
    } finally {
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
      if (attempt.attemptNumber === 1) await requestAiFeedback(updated)
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
          expression={expression}
          onExpressionChange={setExpression}
          onPlay={(attempt) => void playAttempt(attempt)}
          onSaveTranscript={(attempt, text) => void updateTranscript(attempt, text)}
          onRetryTranscription={(attempt) => void retryTranscription(attempt)}
          onSaveExpression={() => void saveExpression()}
          onSpeakExpression={(text) => void speak(text)}
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
            ? '重新发起独立 STT 转写'
            : '用独立 STT 重试转写'}
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
  expression,
  onExpressionChange,
  onPlay,
  onSaveTranscript,
  onRetryTranscription,
  onSaveExpression,
  onSpeakExpression,
}: {
  session: TrainingSession
  first: PracticeAttempt
  second: PracticeAttempt
  busy: boolean
  expression: string
  onExpressionChange: (value: string) => void
  onPlay: (attempt: PracticeAttempt) => void
  onSaveTranscript: (attempt: PracticeAttempt, text: string) => void
  onRetryTranscription: (attempt: PracticeAttempt) => void
  onSaveExpression: () => void
  onSpeakExpression: (text: string) => void
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

function HistoryView({
  questions,
  sessions,
  onOpen,
}: {
  questions: Question[]
  sessions: TrainingSession[]
  onOpen: (session: TrainingSession) => void
}) {
  return (
    <section className="page-stack library-page">
      <div className="page-title">
        <p className="eyebrow">本地训练记录</p>
        <h1>每次开口都留得住</h1>
        <p>练习、转写和两段录音默认只保存在这台设备。</p>
      </div>
      {sessions.length ? (
        <div className="history-list">
          {sessions.map((session) => {
            const question = questions.find((item) => item.id === session.questionId)
            if (!question) return null
            return (
              <button type="button" key={session.id} onClick={() => onOpen(session)}>
                <span className="part-chip">P{question.part}</span>
                <span>
                  <small>{question.topic} · {formatDate(session.updatedAt)}</small>
                  <strong>{question.prompt}</strong>
                  <em>{statusLabel[session.status]} · {session.attempts.length}/2 次回答</em>
                </span>
                <b aria-hidden="true">›</b>
              </button>
            )
          })}
        </div>
      ) : (
        <EmptyState title="还没有练习记录" body="从一道 Part 1 小题开始，完成你的第一次真实开口。" />
      )}
    </section>
  )
}

function ExpressionLibrary({
  expressions,
  audioFocus,
}: {
  expressions: SavedExpression[]
  audioFocus: AudioFocus
}) {
  const [message, setMessage] = useState<string | null>(null)

  const speak = async (text: string) => {
    setMessage(null)
    try {
      await audioFocus.speak({ text, language: 'en-US', rate: 0.92 })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '语音播放暂不可用。')
    }
  }

  return (
    <section className="page-stack library-page">
      <div className="page-title">
        <p className="eyebrow">个人语料</p>
        <h1>真正说得出口的表达</h1>
        <p>只保存你认可、未来可能再次使用的句子。</p>
      </div>
      {message ? <div className="notice">{message}</div> : null}
      {expressions.length ? (
        <div className="expression-list">
          {expressions.map((item) => (
            <article key={item.id}>
              <div>
                <span>{item.topic}</span>
                <small>{formatDate(item.createdAt)}</small>
              </div>
              <p>{item.text}</p>
              <button type="button" onClick={() => void speak(item.text)}>
                ▶ 播放示范
              </button>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="还没有保存表达" body="完成两次回答后，保存一句你自己真正想再说的话。" />
      )}
    </section>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">=＾● ⋏ ●＾=</span>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  )
}
