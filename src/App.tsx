import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { createBrowserRuntime } from './app/runtime'
import { ImportController } from './app/ImportController'
import { SettingsController } from './app/SettingsController'
import {
  ExpressionLibrary,
  HistoryView,
  PracticeFlow,
} from './features/practice'
import {
  partLabel,
  statusLabel,
} from './features/practice/format'
import { questionBank } from './data/questions'
import {
  DEFAULT_PRACTICE_TEXTS,
  type PracticeTexts,
  type Question,
  type SavedExpression,
  type TrainingSession,
} from './domain/models'
import { recommendQuestion } from './domain/progress'
import type { ImportedQuestionRecord } from './domain/imports'
import type { AudioFocus } from './ports/speech'



type AppView =
  | 'questions'
  | 'practice'
  | 'history'
  | 'expressions'
  | 'imports'
  | 'settings'

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
 * is deliberately denied while an answer is being persisted so it cannot be
 * abandoned silently.
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
  const [practiceTexts, setPracticeTexts] = useState<PracticeTexts>(
    DEFAULT_PRACTICE_TEXTS,
  )
  const [apiConnected, setApiConnected] = useState(false)

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
        const storedTexts = await runtime.storage.getPracticeTexts()
        if (active && storedTexts !== null) {
          setPracticeTexts(storedTexts)
        }
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

  // 右上角 API 状态由 /health 真实可达性驱动,定期重新检查保持新鲜。
  useEffect(() => {
    const check = () => {
      void runtime.healthCache.refresh().then((snapshot) => {
        setApiConnected(snapshot.health !== null)
      })
    }
    check()
    const interval = window.setInterval(check, 15_000)
    return () => window.clearInterval(interval)
  }, [runtime.healthCache])

  const updatePracticeTexts = (texts: PracticeTexts) => {
    setPracticeTexts(texts)
    void runtime.storage.savePracticeTexts(texts).catch(() => undefined)
  }

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

  const deleteSession = async (sessionId: string) => {
    if (!window.confirm('删除这次练习记录？此操作不可撤销。')) return
    try {
      await runtime.storage.deleteSessionWithAudio(sessionId)
      if (session?.id === sessionId) setSession(null)
      await refreshLibrary()
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : '练习删除失败。')
    }
  }

  const updateExpression = async (expressionId: string, text: string, topic: string) => {
    await runtime.practiceService.updateExpression(expressionId, { text, topic })
    await refreshLibrary()
  }

  const deleteExpression = async (expressionId: string) => {
    await runtime.practiceService.deleteExpression(expressionId)
    await refreshLibrary()
  }

  const markExpressionReviewed = async (expressionId: string) => {
    await runtime.practiceService.markExpressionReviewed(expressionId)
    await refreshLibrary()
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
            '正在保存回答，请稍候片刻再离开练习。',
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
            <small>说出来，再改一遍</small>
          </span>
        </button>
        <span className={apiConnected ? 'api-badge ok' : 'api-badge down'}>
          {apiConnected ? 'API连接成功' : 'API未连接'}
        </span>
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
            practiceTexts={practiceTexts}
            onPracticeTextsChange={updatePracticeTexts}
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
            onDelete={(sessionId) => void deleteSession(sessionId)}
          />
        ) : view === 'expressions' ? (
          <ExpressionLibrary
            expressions={expressions}
            audioFocus={runtime.audioFocus}
            onUpdate={updateExpression}
            onDelete={deleteExpression}
            onReviewed={markExpressionReviewed}
            onPractice={(questionId) => {
              const question = allQuestions.find((item) => item.id === questionId)
              if (question) {
                void startQuestion(question)
              } else {
                setStorageError('这条表达关联的原题已不存在，表达本身仍安全保留。')
              }
            }}
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
            configStore={runtime.configStore}
            healthCache={runtime.healthCache}
            systemTts={runtime.systemTts}
            preferredVoice={runtime.voiceAi}
            dataMaintenance={runtime.storage}
            backupService={runtime.backupService}
            onDataChanged={refreshLibrary}
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
  practiceTexts,
  onPracticeTextsChange,
  onStart,
  onResume,
  onImport,
}: {
  questions: Question[]
  sessions: TrainingSession[]
  practiceTexts: PracticeTexts
  onPracticeTextsChange: (texts: PracticeTexts) => void
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
  const recommendation = recommendQuestion(questions, sessions)

  const pickRandom = () => {
    const index = Math.floor(Math.random() * partQuestions.length)
    const question = partQuestions[index]
    if (question) {
      onStart(question)
    }
  }

  const setText = (field: keyof PracticeTexts, value: string) => {
    onPracticeTextsChange({ ...practiceTexts, [field]: value })
  }

  return (
    <section className="page-stack">
      <div className="hero-card">
        <div className="hero-lines">
          <input
            className="hero-line hero-line-top"
            type="text"
            value={practiceTexts.top}
            placeholder={DEFAULT_PRACTICE_TEXTS.top}
            maxLength={200}
            onChange={(event) => setText('top', event.target.value)}
          />
          <input
            className="hero-line hero-line-middle"
            type="text"
            value={practiceTexts.middle}
            placeholder={DEFAULT_PRACTICE_TEXTS.middle}
            maxLength={200}
            onChange={(event) => setText('middle', event.target.value)}
          />
          <input
            className="hero-line hero-line-bottom"
            type="text"
            value={practiceTexts.bottom}
            placeholder={DEFAULT_PRACTICE_TEXTS.bottom}
            maxLength={200}
            onChange={(event) => setText('bottom', event.target.value)}
          />
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

      {recommendation ? (
        <button
          type="button"
          className="question-recommendation"
          onClick={() => onStart(recommendation.question)}
        >
          <span>
            <small>根据本机练习记录推荐</small>
            <strong>{recommendation.question.prompt}</strong>
            <em>{recommendation.reason}</em>
          </span>
          <b aria-hidden="true">开始 →</b>
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
              <small>{question.topic} · {difficultyLabel(question.difficulty)}</small>
              <strong>{question.prompt}</strong>
              <span>{question.source ?? '本地题库'} · 开始练习 <b aria-hidden="true">→</b></span>
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

function difficultyLabel(difficulty: Question['difficulty']): string {
  if (difficulty === 'developing') return '进阶'
  if (difficulty === 'stretch') return '拓展'
  return '基础'
}
