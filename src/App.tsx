import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  BookOpenText,
  ChartNoAxesColumnIncreasing,
  Home,
  Lightbulb,
  LibraryBig,
  LoaderCircle,
  Search,
  SearchX,
  Shuffle,
  Upload,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { createBrowserRuntime } from './app/runtime'
import { SettingsController } from './app/SettingsController'
import {
  ExpressionLibrary,
  HistoryView,
  LearnerMemoryPanel,
  PersonalMaterialLibrary,
  PracticeFlow,
} from './features/practice'
import { HomeView } from './features/home'
import {
  type Question,
  type SavedExpression,
  type TrainingSession,
} from './domain/models'
import type { PersonalMaterial } from './domain/personalMaterials'
import {
  LOCAL_DEFAULT_USER_ID,
  recordBelongsToAccount,
  type AccountProfile,
} from './domain/accounts'
import {
  buildLearnerContext,
  findReusableExpressions,
  findReusablePersonalMaterials,
} from './domain/userMemory'
import {
  createDefaultUserPreferences,
  updateUserPreferences,
  type UserPreferences,
  type UserPreferencesUpdate,
} from './domain/userPreferences'
import type { ImportedQuestionRecord } from './domain/imports'
import type { AudioFocus } from './ports/speech'
import { AccountView, CloudAccountPanel } from './features/accounts'
import {
  CloudSyncCard,
  type CloudSyncStatus,
} from './features/accounts/CloudSyncCard'
import type { CloudAccountSession } from './domain/cloudAccount'
import { CloudSyncError } from './domain/cloudSync'
import { AccountCloudSyncService } from './application/accountCloudSyncService'

const ImportController = lazy(async () => {
  const module = await import('./app/ImportController')
  return { default: module.ImportController }
})

interface QuestionDataModule {
  questionBank: Question[]
  questionBankMeta: {
    seasonLabel: string
    counts: { 1: number; 2: number; 3: number }
  }
  legacyQuestionsById: Map<string, Question>
}


type AppView =
  | 'home'
  | 'questions'
  | 'practice'
  | 'history'
  | 'expressions'
  | 'materials'
  | 'accounts'
  | 'imports'
  | 'settings'

type ThemePreference = 'system' | 'light' | 'dark'
const THEME_STORAGE_KEY = 'ielts-speaking-meow:theme'

function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Private browsing or an embedded WebView may deny localStorage access.
  }
  return 'system'
}

export const SAFE_PRACTICE_BACK_EVENT = 'ielts-speaking-meow:safe-practice-back'

// eslint-disable-next-line react-refresh/only-export-components -- pure scroll behavior has a focused navigation regression test.
export function resetViewScroll(): void {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  // Some Android WebViews and embedded browser surfaces keep the root element's
  // scroll offset even after window.scrollTo. Reset both roots so every primary
  // navigation starts from the page heading.
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

export type AndroidBackAction =
  | 'safe-practice-exit'
  | 'home'
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
  if (view !== 'home') {
    return 'home'
  }
  return canGoBack ? 'browser-back' : 'exit-app'
}

// eslint-disable-next-line react-refresh/only-export-components -- pure startup routing helper.
export const resolveInitialView = (search: string): AppView => {
  const params = new URLSearchParams(search)
  const action = params.get('action')
  const token = params.get('token')?.trim() ?? ''
  const isAccountAction = action === 'verify-email' || action === 'reset-password'
  return isAccountAction && token.length >= 32 && token.length <= 512
    ? 'accounts'
    : 'home'
}

function formatSyncDestination(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || '当前云端服务'
  } catch {
    return '当前云端服务'
  }
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
  if (exitGuardActive) {
    return false
  }

  await audioFocus.stopAllPlayback()
  onExit()
  return true
}

export function App() {
  const [runtime] = useState(createBrowserRuntime)

  const [view, setView] = useState<AppView>(() =>
    resolveInitialView(globalThis.location?.search ?? ''),
  )
  const [libraryPart, setLibraryPart] = useState<1 | 2 | 3>(1)
  const [session, setSession] = useState<TrainingSession | null>(null)
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [expressions, setExpressions] = useState<SavedExpression[]>([])
  const [personalMaterials, setPersonalMaterials] = useState<PersonalMaterial[]>([])
  const [questionData, setQuestionData] = useState<QuestionDataModule | null>(null)
  const [importedQuestions, setImportedQuestions] = useState<
    ImportedQuestionRecord[]
  >([])
  const [currentAccount, setCurrentAccount] = useState<AccountProfile | null>(
    null,
  )
  const [cloudSession, setCloudSession] = useState<CloudAccountSession | null>(null)
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>('idle')
  const [cloudSyncMessage, setCloudSyncMessage] = useState('尚未同步。')
  const [loading, setLoading] = useState(true)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null)
  const [practiceExitGuardActive, setPracticeExitGuardActive] = useState(false)
  const [apiConnected, setApiConnected] = useState(false)
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference)
  const [preferences, setPreferences] = useState<UserPreferences>(() =>
    createDefaultUserPreferences(LOCAL_DEFAULT_USER_ID),
  )

  const loadUserPreferences = useCallback(async (ownerId: string) => {
    const stored = await runtime.storage.getUserPreferences(ownerId)
    const next = stored ?? createDefaultUserPreferences(ownerId)
    if (stored === null) await runtime.storage.saveUserPreferences(next)
    runtime.setUserPreferences(next)
    setPreferences(next)
    setTheme(next.theme)
    setLibraryPart(next.defaultPart)
  }, [runtime])

  const changeUserPreferences = useCallback(async (
    update: UserPreferencesUpdate,
  ) => {
    const next = updateUserPreferences(preferences, update)
    await runtime.storage.saveUserPreferences(next)
    runtime.setUserPreferences(next)
    setPreferences(next)
    setTheme(next.theme)
    if (update.defaultPart !== undefined) setLibraryPart(next.defaultPart)
  }, [preferences, runtime])

  const refreshLibrary = useCallback(async () => {
    const ownerId = runtime.accountService.getCurrentUserId()
    const [nextSessions, nextExpressions, nextPersonalMaterials, nextImportedQuestions] = await Promise.all([
      runtime.practiceService.listSessions(),
      runtime.practiceService.listExpressions(),
      runtime.personalMaterialService.list({ includeArchived: true }),
      runtime.storage.listImportedQuestions(ownerId),
    ])
    setSessions(nextSessions)
    setExpressions(nextExpressions)
    setPersonalMaterials(nextPersonalMaterials)
    setImportedQuestions(
      nextImportedQuestions.filter((record) =>
        recordBelongsToAccount(record.ownerId, ownerId),
      ),
    )
  }, [runtime.practiceService, runtime.personalMaterialService, runtime.storage, runtime.accountService])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [loadedQuestionData] = await Promise.all([
          import('./data/questions'),
          runtime.initialize(),
        ])
        const account = runtime.accountService.getCurrentAccount()
        if (account !== null) await loadUserPreferences(account.userId)
        if (active) {
          setCurrentAccount(account)
          setQuestionData(loadedQuestionData)
        }
        await refreshLibrary()
        void runtime.cloudAuthClient
          .restoreSession(runtime.authTokenStore)
          .then((restored) => {
            if (active) setCloudSession(restored)
          })
          .catch(() => {
            if (active) setCloudSession(null)
          })
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
      void runtime.audioFocus.stopAllPlayback()

      void runtime.storage.close()
    }
  }, [loadUserPreferences, refreshLibrary, runtime])

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = preferences.reduceMotion
      ? 'true'
      : 'false'
  }, [preferences.reduceMotion])


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

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const resolved = theme === 'system'
        ? (media?.matches ? 'dark' : 'light')
        : theme
      document.documentElement.dataset.theme = resolved
      document.documentElement.style.colorScheme = resolved
    }
    applyTheme()
    if (theme !== 'system' || !media) return
    media.addEventListener?.('change', applyTheme)
    return () => media.removeEventListener?.('change', applyTheme)
  }, [theme])

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
      await runtime.practiceService.deleteSession(sessionId)
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

  const handleAccountSwitched = (account: AccountProfile) => {
    // Cloud tokens are device-global, while practice data is owner-scoped.
    // Clear the local cloud session whenever the owner changes so a stale token
    // can never silently sync into the newly selected local data space.
    void runtime.authTokenStore.clearToken().catch(() => undefined)
    handleCloudSessionChange(null)
    setCurrentAccount(account)
    void loadUserPreferences(account.userId).catch((error: unknown) => {
      setStorageError(error instanceof Error ? error.message : '偏好设置读取失败。')
    })
    setSession(null)
    setPracticeExitGuardActive(false)
    setNavigationNotice(null)
    setView('home')
    void refreshLibrary()
  }

  const handleCloudSessionChange = (nextSession: CloudAccountSession | null) => {
    setCloudSession(nextSession)
    setCloudSyncStatus('idle')
    setCloudSyncMessage(nextSession ? '尚未同步。' : '')
  }

  const runCloudSync = async () => {
    if (!cloudSession?.user.emailVerified) {
      setCloudSyncStatus('error')
      setCloudSyncMessage('请先验证邮箱，再同步资料。')
      return
    }

    setCloudSyncStatus('syncing')
    setCloudSyncMessage('正在比较本机与云端版本，本机数据会在成功前保留。')
    try {
      const boundAccount = await runtime.accountService.bindCurrentAccountToCloud(
        cloudSession.user.id,
      )
      setCurrentAccount(boundAccount)
      const syncService = new AccountCloudSyncService({
        scopeId: cloudSession.user.id,
        ownerId: runtime.accountService.getCurrentUserId(),
        storage: runtime.storage,
        gateway: runtime.cloudSyncClient,
      })
      const summary = await syncService.synchronize()
      await refreshLibrary()

      if (summary.status === 'conflict') {
        setCloudSyncStatus('conflict')
        setCloudSyncMessage(
          `${summary.conflicts[0]?.message ?? '发现同步冲突。'} 已停止覆盖；本机资料仍保留。`,
        )
        return
      }

      setCloudSyncStatus('success')
      setCloudSyncMessage(
        `同步完成：上传 ${summary.uploaded} 项，恢复或更新 ${summary.downloaded} 项。`,
      )
    } catch (error) {
      if (
        error instanceof CloudSyncError &&
        (error.code === 'unauthenticated' || error.code === 'session-expired')
      ) {
        handleCloudSessionChange(null)
        setCloudSyncStatus('error')
        setCloudSyncMessage('登录已失效，请重新登录后再试。本机资料没有丢失。')
        return
      }
      setCloudSyncStatus('error')
      setCloudSyncMessage(
        `${error instanceof Error ? error.message : '同步失败。'} 本机资料与待同步项目仍保留，可稍后重试。`,
      )
    }
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
        case 'home':
          navigateSafelyRef.current('home')
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
    ...(questionData?.questionBank ?? []),
    ...importedQuestions.map((record) => record.question),
  ]
  /** 历史记录允许引用 V1.8 之前的旧内置题;这些题不进入浏览/随机抽题。 */
  const questionsForHistory = [
    ...allQuestions,
    ...(questionData === null ? [] : questionData.legacyQuestionsById.values()),
  ]
  const activeQuestion = session
    ? allQuestions.find((question) => question.id === session.questionId) ??
      questionData?.legacyQuestionsById.get(session.questionId) ??
      null
    : null
  const activeMemory = activeQuestion && preferences.memoryEnabled
    ? {
        reusableExpressions: findReusableExpressions(
          activeQuestion,
          expressions,
          3,
        ),
        learnerContext: buildLearnerContext(
          activeQuestion,
          sessions,
          expressions,
          preferences.sharePersonalMaterialsWithAi ? personalMaterials : [],
          allQuestions,
        ),
        personalMaterials: findReusablePersonalMaterials(
          activeQuestion,
          personalMaterials,
          2,
        ),
      }
    : { reusableExpressions: [], learnerContext: '', personalMaterials: [] }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="brand"
          type="button"
          onClick={() => navigateSafely('home')}
          aria-label="回到首页"
        >
          <span className="brand-mark" aria-hidden="true">
            喵
          </span>
          <span>
            <strong>雅思口语喵</strong>
            <small>说出来，再改一遍</small>
          </span>
        </button>
        <span className="header-tools">
          <button
            type="button"
            className="account-chip"
            onClick={() => navigateSafely('accounts')}
            aria-label="打开账号页"
          >
            <UserRound aria-hidden="true" size={15} />
            {cloudSession?.user.email.split('@')[0] ?? currentAccount?.displayName ?? '本机用户'}
          </button>
          <span className={apiConnected ? 'api-badge ok' : 'api-badge down'}>
            {apiConnected ? <Wifi aria-hidden="true" size={13} /> : <WifiOff aria-hidden="true" size={13} />}
            {apiConnected ? '云端可用' : '离线可练'}
          </span>
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
        ) : questionData === null ? (
          <StartupFailureView />
        ) : view === 'home' ? (
          <HomeView
            questions={allQuestions}
            sessions={sessions}
            expressionCount={expressions.length}
            accountName={currentAccount?.displayName ?? '本机用户'}
            onStart={(question) => void startQuestion(question)}
            onResume={openSession}
            onOpenLibrary={(part) => {
              if (part) setLibraryPart(part)
              navigateSafely('questions')
            }}
            onOpenReview={() => navigateSafely('history')}
          />
        ) : view === 'questions' ? (
          <QuestionLibrary
            initialPart={libraryPart}
            questions={allQuestions}
            bankMeta={questionData.questionBankMeta}
            onStart={(question) => void startQuestion(question)}
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
            reusableExpressions={activeMemory.reusableExpressions}
            reusablePersonalMaterials={activeMemory.personalMaterials}
            autoPlayQuestion={preferences.autoPlayQuestion}
            feedbackDetail={preferences.feedbackDetail}
            learnerContext={activeMemory.learnerContext}
            onExpressionReused={(expressionId) =>
              void runtime.practiceService
                .markExpressionReused(expressionId)
                .then(() => refreshLibrary())
                .catch(() => undefined)
            }
            onExitGuardChange={setPracticeExitGuardActive}
            onChange={handleSessionChange}
            onBack={() => navigateSafely('questions')}
          />
        ) : view === 'history' ? (
          <ReviewCenter active="history" onChange={navigateSafely}>
            <LearnerMemoryPanel sessions={sessions} />
            <HistoryView
              questions={questionsForHistory}
              sessions={sessions}
              onOpen={openSession}
              onDelete={(sessionId) => void deleteSession(sessionId)}
            />
          </ReviewCenter>
        ) : view === 'expressions' ? (
          <ReviewCenter active="expressions" onChange={navigateSafely}>
            <ExpressionLibrary
              expressions={expressions}
              audioFocus={runtime.audioFocus}
              onUpdate={updateExpression}
              onDelete={deleteExpression}
              onReviewed={markExpressionReviewed}
              onPractice={(questionId) => {
                const question = questionsForHistory.find((item) => item.id === questionId)
                if (question) {
                  void startQuestion(question)
                } else {
                  setStorageError('这条表达关联的原题已不存在，表达本身仍安全保留。')
                }
              }}
            />
          </ReviewCenter>
        ) : view === 'materials' ? (
          <ReviewCenter active="materials" onChange={navigateSafely}>
            <PersonalMaterialLibrary
              materials={personalMaterials}
              onCreate={async (input) => { await runtime.personalMaterialService.create(input); await refreshLibrary() }}
              onUpdate={async (id, input) => { await runtime.personalMaterialService.update(id, input); await refreshLibrary() }}
              onArchive={async (id) => { await runtime.personalMaterialService.archive(id); await refreshLibrary() }}
              onRestore={async (id) => { await runtime.personalMaterialService.restore(id); await refreshLibrary() }}
              onDelete={async (id) => { await runtime.personalMaterialService.delete(id); await refreshLibrary() }}
            />
          </ReviewCenter>
        ) : view === 'accounts' ? (
          <AccountView
            service={runtime.accountService}
            onSwitched={handleAccountSwitched}
            onOpenSettings={() => navigateSafely('settings')}
            cloudPanel={(
              <>
                <CloudAccountPanel
                  client={runtime.cloudAuthClient}
                  tokenStore={runtime.authTokenStore}
                  onSessionChange={handleCloudSessionChange}
                />
                {cloudSession ? (
                  <CloudSyncCard
                    status={cloudSyncStatus}
                    message={cloudSyncMessage}
                    destination={formatSyncDestination(runtime.configStore.getBaseUrl())}
                    emailVerified={cloudSession.user.emailVerified}
                    onSync={() => void runCloudSync()}
                    bindingRequired={currentAccount?.cloudAccountId == null}
                    localProfileName={currentAccount?.displayName ?? '本机用户'}
                  />
                ) : null}
              </>
            )}
          />
        ) : view === 'imports' ? (
          <Suspense fallback={<LoadingView label="正在打开导入工具…" />}>
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
          </Suspense>
        ) : (
          <SettingsController
            configStore={runtime.configStore}
            healthCache={runtime.healthCache}
            systemTts={runtime.systemTts}
            preferredVoice={runtime.voiceAi}
            dataMaintenance={runtime.storage}
            backupService={runtime.backupService}
            onDataChanged={refreshLibrary}
            theme={theme}
            onThemeChange={(nextTheme) => void changeUserPreferences({ theme: nextTheme })}
            preferences={preferences}
            onPreferencesChange={changeUserPreferences}
          />
        )}
      </main>

      {view !== 'practice' ? (
        <BottomNavigation view={view} onChange={navigateSafely} />
      ) : null}
    </div>
  )
}

function LoadingView({ label = '正在打开本地练习记录…' }: { label?: string }) {
  return (
    <div className="loading-view" role="status">
      <LoaderCircle className="loading-paw" aria-hidden="true" size={20} />
      {label}
    </div>
  )
}

function StartupFailureView() {
  return (
    <section className="empty-state" role="alert">
      <SearchX aria-hidden="true" size={24} />
      <h2>应用数据没有完整载入</h2>
      <p>题库或本地记录校验失败。你的本机数据没有被删除，可以重新载入后再试。</p>
      <button
        type="button"
        className="primary-button"
        onClick={() => window.location.reload()}
      >
        重新载入
      </button>
    </section>
  )
}

function BottomNavigation({
  view,
  onChange,
}: {
  view: AppView
  onChange: (view: Exclude<AppView, 'practice'>) => void
}) {
  const items: Array<{
    view: Exclude<AppView, 'practice' | 'expressions' | 'imports' | 'settings'>
    label: string
    icon: LucideIcon
  }> = [
    { view: 'home', label: '首页', icon: Home },
    { view: 'questions', label: '题库', icon: LibraryBig },
    { view: 'history', label: '复盘', icon: ChartNoAxesColumnIncreasing },
    { view: 'accounts', label: '我的', icon: UserRound },
  ]

  return (
    <nav className="bottom-nav" aria-label="主导航">
      {items.map((item) => {
        const Icon = item.icon
        const active = view === item.view ||
          (item.view === 'history' && (view === 'expressions' || view === 'materials')) ||
          (item.view === 'accounts' && view === 'settings')
        return (
          <button
            type="button"
            key={item.view}
            className={active ? 'active' : ''}
            onClick={() => onChange(item.view)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon aria-hidden="true" size={21} strokeWidth={active ? 2.4 : 2} />
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}

function ReviewCenter({
  active,
  onChange,
  children,
}: {
  active: 'history' | 'expressions' | 'materials'
  onChange: (view: Exclude<AppView, 'practice'>) => void
  children: ReactNode
}) {
  return (
    <section className="review-center">
      <div className="review-center-heading">
        <div>
          <p className="eyebrow">Review & reuse</p>
          <h1>复盘中心</h1>
          <p>回看练习，也把真正能复用的英语留下来。</p>
        </div>
      </div>
      <nav className="review-tabs" aria-label="复盘内容">
        <button
          type="button"
          className={active === 'history' ? 'active' : ''}
          aria-current={active === 'history' ? 'page' : undefined}
          onClick={() => onChange('history')}
        >
          <ChartNoAxesColumnIncreasing aria-hidden="true" size={17} />
          练习记录
        </button>
        <button
          type="button"
          className={active === 'expressions' ? 'active' : ''}
          aria-current={active === 'expressions' ? 'page' : undefined}
          onClick={() => onChange('expressions')}
        >
          <BookOpenText aria-hidden="true" size={17} />
          个人语料
        </button>
        <button
          type="button"
          className={active === 'materials' ? 'active' : ''}
          onClick={() => onChange('materials')}
        >
          <Lightbulb aria-hidden="true" size={17} />
          个人素材
        </button>
      </nav>
      {children}
    </section>
  )
}

function QuestionLibrary({
  initialPart,
  questions,
  bankMeta,
  onStart,
  onImport,
}: {
  initialPart: 1 | 2 | 3
  questions: Question[]
  bankMeta: { seasonLabel: string; counts: { 1: number; 2: number; 3: number } }
  onStart: (question: Question) => void
  onImport: () => void
}) {
  const [part, setPart] = useState<1 | 2 | 3>(initialPart)
  const [query, setQuery] = useState('')
  const [newOnly, setNewOnly] = useState(false)
  const [category, setCategory] = useState('all')
  const [visibleLimit, setVisibleLimit] = useState(20)
  const [showFollowUpsFor, setShowFollowUpsFor] = useState<string | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const partQuestions = questions.filter((question) => question.part === part)
  const categories = Array.from(
    new Set(partQuestions.map((question) => question.category ?? '导入题目')),
  )
  const visiblePartQuestions = partQuestions.filter((question) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      question.topic.toLocaleLowerCase().includes(normalizedQuery) ||
      question.prompt.toLocaleLowerCase().includes(normalizedQuery) ||
      (question.category ?? '').toLocaleLowerCase().includes(normalizedQuery)
    // 只隐藏明确的旧题;导入题没有 new/old 标记,仍然可见。
    const matchesNew = !newOnly || question.isNew !== false
    const matchesCategory = category === 'all' ||
      (question.category ?? '导入题目') === category
    return matchesQuery && matchesNew && matchesCategory
  })
  const questionById = new Map(questions.map((question) => [question.id, question]))
  const visibleQuestions = visiblePartQuestions.slice(0, visibleLimit)
  const groups = groupQuestions(visibleQuestions)
  const groupTotals = new Map(
    groupQuestions(visiblePartQuestions).map((group) => [group.label, group.questions.length]),
  )

  const pickRandom = () => {
    // eslint-disable-next-line react-hooks/purity -- 随机抽题只在用户点击时执行
    const index = Math.floor(Math.random() * visiblePartQuestions.length)
    const question = visiblePartQuestions[index]
    if (question) {
      onStart(question)
    }
  }

  const toggleFollowUps = (questionId: string) => {
    setShowFollowUpsFor((current) =>
      current === questionId ? null : questionId,
    )
  }

  return (
    <section className="page-stack question-library-page">
      <div className="question-library-heading">
        <div>
          <p className="eyebrow">{bankMeta.seasonLabel} · Question bank</p>
          <h1>选一道真正想练的题</h1>
          <p>按 Part、主题和新旧题筛选。一次只加载少量结果，找题更快。</p>
        </div>
        <button className="secondary-button compact" type="button" onClick={onImport}>
          <Upload aria-hidden="true" size={16} />
          导入
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
            onClick={() => {
              setPart(value)
              setCategory('all')
              setVisibleLimit(20)
              setShowFollowUpsFor(null)
            }}
          >
            Part {value}
            <small>
              {value === 1 ? '短问答' : value === 2 ? '话题卡' : '观点题'}
              {' · '}
              {bankMeta.counts[value]} 题
            </small>
          </button>
        ))}
      </div>

      <section className="question-filter-panel" aria-label="筛选题库">
        <label className="question-search">
          <Search aria-hidden="true" size={18} />
          <span className="sr-only">搜索题目或主题</span>
          <input
            type="search"
            value={query}
            placeholder="搜索题目或主题"
            onChange={(event) => {
              setQuery(event.target.value)
              setVisibleLimit(20)
            }}
          />
        </label>
        <div className="question-filter-chips" role="group" aria-label="主题分类">
          <button
            type="button"
            className={category === 'all' ? 'active' : ''}
            aria-pressed={category === 'all'}
            onClick={() => { setCategory('all'); setVisibleLimit(20) }}
          >
            全部
          </button>
          {categories.map((item) => (
            <button
              type="button"
              key={item}
              className={category === item ? 'active' : ''}
              aria-pressed={category === item}
              onClick={() => { setCategory(item); setVisibleLimit(20) }}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="question-filter-actions">
          <button
            type="button"
            className={newOnly ? 'filter-toggle active' : 'filter-toggle'}
            aria-pressed={newOnly}
            onClick={() => { setNewOnly((value) => !value); setVisibleLimit(20) }}
          >
            只看新题
          </button>
          <button
            type="button"
            className="secondary-button compact"
            disabled={visiblePartQuestions.length === 0}
            onClick={pickRandom}
          >
            <Shuffle aria-hidden="true" size={16} />
            随机一题
          </button>
          <span>{visiblePartQuestions.length} 道结果</span>
        </div>
      </section>

      {groups.length ? (
        groups.map((group) => (
          <section className="question-group" key={group.label}>
            <div className="question-group-heading">
              <strong>{group.label}</strong>
              <small>{group.questions.length} / {groupTotals.get(group.label) ?? group.questions.length} 题</small>
            </div>
            <div className="question-list">
              {group.questions.map((question, index) => (
                <QuestionRow
                  key={question.id}
                  question={question}
                  index={index}
                  questionById={questionById}
                  showFollowUps={showFollowUpsFor === question.id}
                  onToggleFollowUps={toggleFollowUps}
                  onStart={onStart}
                />
              ))}
            </div>
          </section>
        ))
      ) : (
        <EmptyQuestionResult query={normalizedQuery} newOnly={newOnly} />
      )}
      {visibleQuestions.length < visiblePartQuestions.length ? (
        <button
          type="button"
          className="load-more-button"
          onClick={() => setVisibleLimit((value) => value + 20)}
        >
          再显示 20 道
          <small>已显示 {visibleQuestions.length} / {visiblePartQuestions.length}</small>
        </button>
      ) : null}
    </section>
  )
}

function QuestionRow({
  question,
  index,
  questionById,
  showFollowUps,
  onToggleFollowUps,
  onStart,
}: {
  question: Question
  index: number
  questionById: Map<string, Question>
  showFollowUps: boolean
  onToggleFollowUps: (questionId: string) => void
  onStart: (question: Question) => void
}) {
  const followUpIds =
    question.part === 2 ? (question.relatedPart3Ids ?? []) : []
  const followUps = followUpIds
    .map((id) => questionById.get(id))
    .filter((item): item is Question => item !== undefined)
  const parentPart2 =
    question.part === 3 && question.part2QuestionId !== undefined
      ? questionById.get(question.part2QuestionId)
      : undefined
  const topicLabel = parentPart2 ? `对应 P2 · ${parentPart2.topic}` : question.topic

  return (
    <div className="question-row-wrap">
      <article className="question-row">
        <span className="question-number">{String(index + 1).padStart(2, '0')}</span>
        <button type="button" onClick={() => onStart(question)}>
          <small>
            {topicLabel}
            {' · '}
            <QuestionStatus isNew={question.isNew} />
            {' · '}
            {difficultyLabel(question.difficulty)}
            {question.part === 2 ? ` · ${question.cuePoints.length} 个提示点` : ''}
          </small>
          <strong>{question.prompt}</strong>
          <span>
            {question.category ?? '导入题目'}
            {followUps.length > 0 ? ` · 对应 Part 3 ${followUps.length} 道` : ''}
            {' · 开始练习 '}
            <ArrowRight aria-hidden="true" size={14} />
          </span>
        </button>
      </article>
      {followUps.length > 0 ? (
        <div className="follow-up-row">
          <button
            type="button"
            className="follow-up-toggle"
            aria-expanded={showFollowUps}
            onClick={() => onToggleFollowUps(question.id)}
          >
            {showFollowUps ? '收起对应 Part 3' : `查看对应 Part 3（${followUps.length} 道）`}
          </button>
          {showFollowUps ? (
            <div className="follow-up-list">
              {followUps.map((followUp) => (
                <button
                  type="button"
                  key={followUp.id}
                  onClick={() => onStart(followUp)}
                >
                  {followUp.prompt}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function QuestionStatus({ isNew }: { isNew: boolean | undefined }) {
  if (isNew === true) return <b className="new-tag">新题</b>
  if (isNew === false) return <span>保留题</span>
  return <span>自定义</span>
}

function EmptyQuestionResult({
  query,
  newOnly,
}: {
  query: string
  newOnly: boolean
}) {
  return (
    <div className="empty-state">
      <SearchX aria-hidden="true" size={28} />
      <h2>没有匹配的题目</h2>
      <p>
        {query ? `没有找到包含“${query}”的题目。` : ''}
        {newOnly ? '当前筛选只显示当季新题。' : ''}
        可以清除筛选，或随机抽一道题开始。
      </p>
    </div>
  )
}

function groupQuestions(questions: Question[]): Array<{
  label: string
  questions: Question[]
}> {
  const groups: Array<{ label: string; questions: Question[] }> = []
  const byLabel = new Map<string, Question[]>()
  for (const question of questions) {
    const label = question.category ?? '导入题目'
    const list = byLabel.get(label) ?? []
    list.push(question)
    byLabel.set(label, list)
  }
  for (const [label, list] of byLabel) {
    groups.push({ label, questions: list })
  }
  return groups
}

function difficultyLabel(difficulty: Question['difficulty']): string {
  if (difficulty === 'developing') return '进阶'
  if (difficulty === 'stretch') return '拓展'
  return '基础'
}
