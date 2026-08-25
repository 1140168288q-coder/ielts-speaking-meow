import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { createBrowserRuntime } from './app/runtime'
import { SettingsController } from './app/SettingsController'
import { AppHeader } from './app/AppHeader'
import { BottomNavigation } from './app/BottomNavigation'
import { LoadingView, StartupFailureView } from './app/AppFallbacks'
import { Notice } from './app/components/Notice'
import { useUserPreferences } from './app/useUserPreferences'
import { formatSyncDestination, useCloudSync } from './app/useCloudSync'
import {
  requestSafePracticeExit,
  resetViewScroll,
  resolveAndroidBackAction,
  resolveInitialView,
  SAFE_PRACTICE_BACK_EVENT,
  type AppView,
} from './app/navigation'
import { QuestionLibrary } from './features/library'
import { ReviewCenter } from './features/review'
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
  recordBelongsToAccount,
  type AccountProfile,
} from './domain/accounts'
import {
  buildLearnerContext,
  buildMaterialSuggestionContext,
  buildLocalMaterialSuggestions,
  findReusableExpressions,
  findReusablePersonalMaterials,
} from './domain/userMemory'
import type { ImportedQuestionRecord } from './domain/imports'
import type { PersonalMaterialCandidate } from './application/personalMaterialService'
import { ApiProviderError } from './infrastructure/ai/providerErrors'
import { AccountView, CloudAccountPanel } from './features/accounts'
import { CloudSyncCard } from './features/accounts/CloudSyncCard'

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

const BACK_LABELS: Record<AppView, string> = {
  home: '返回首页',
  questions: '返回题库',
  practice: '返回',
  history: '返回复盘',
  expressions: '返回个人语料',
  materials: '返回个人素材',
  accounts: '返回「我的」',
  imports: '返回导入工具',
  settings: '返回设置',
}

export function App() {
  const [runtime] = useState(createBrowserRuntime)

  const [view, setView] = useState<AppView>(() =>
    resolveInitialView(globalThis.location?.search ?? ''),
  )
  const [session, setSession] = useState<TrainingSession | null>(null)
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [expressions, setExpressions] = useState<SavedExpression[]>([])
  const [personalMaterials, setPersonalMaterials] = useState<PersonalMaterial[]>([])
  const [materialCandidates, setMaterialCandidates] = useState<
    PersonalMaterialCandidate[]
  >([])
  const [questionData, setQuestionData] = useState<QuestionDataModule | null>(null)
  const [importedQuestions, setImportedQuestions] = useState<
    ImportedQuestionRecord[]
  >([])
  const [currentAccount, setCurrentAccount] = useState<AccountProfile | null>(
    null,
  )
  const [loading, setLoading] = useState(true)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null)
  const [practiceExitGuardActive, setPracticeExitGuardActive] = useState(false)
  const [apiConnected, setApiConnected] = useState(false)
  /** 记录进入 practice/imports/settings 前的来源视图,供"返回上一级"使用。 */
  const [backOrigin, setBackOrigin] = useState<AppView>('home')
  const viewRef = useRef(view)

  const {
    theme,
    preferences,
    libraryPart,
    setLibraryPart,
    loadUserPreferences,
    changeUserPreferences,
  } = useUserPreferences({ runtime })

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

  const {
    cloudSession,
    cloudSyncStatus,
    cloudSyncMessage,
    handleCloudSessionChange,
    runCloudSync,
    setCloudSession,
  } = useCloudSync({
    runtime,
    onAccountBound: setCurrentAccount,
    refreshLibrary,
  })

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
  }, [loadUserPreferences, refreshLibrary, runtime, setCloudSession])

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

  /** 进入覆盖型视图(practice/imports/settings)前记住来源,返回时回来源而非写死题库。 */
  const rememberBackOrigin = useCallback((target: AppView) => {
    if (viewRef.current !== target) {
      setBackOrigin(viewRef.current)
    }
  }, [])

  /** 返回目标永远不是 practice;兜底回题库。 */
  const backTarget = (): Exclude<AppView, 'practice'> =>
    backOrigin === 'practice' ? 'questions' : backOrigin

  const openSession = (nextSession: TrainingSession) => {
    rememberBackOrigin('practice')
    setPracticeExitGuardActive(false)
    setNavigationNotice(null)
    setSession(nextSession)
    setView('practice')
  }

  /**
   * 一键提炼个人素材:云端可用时走 /v1/materials/suggest,否则用本地启发式
   * 生成"可写角度"草稿。结果只是候选,用户确认后才写入素材库。
   */
  const handleSuggestMaterials = async (): Promise<PersonalMaterialCandidate[]> => {
    const context = buildMaterialSuggestionContext(sessions, expressions, allQuestions)
    const existingTitles = personalMaterials.map((material) => material.title)
    const localSuggestions = () =>
      buildLocalMaterialSuggestions(context, existingTitles)
    const health = runtime.healthCache.getSnapshot()
    const deepSeekReady =
      runtime.textAi.isConfigured() &&
      health.health?.providers.deepseek?.configured === true
    let suggestions
    if (!deepSeekReady) {
      suggestions = localSuggestions()
    } else {
      try {
        suggestions = await runtime.textAi.suggestMaterials({
          memoryDigest: context.digest,
          existingTitles,
          maxCount: 4,
        })
      } catch (error) {
        const canUseLocalFallback =
          error instanceof ApiProviderError &&
          ['network', 'timeout', 'server', 'not-configured'].includes(error.code)
        if (!canUseLocalFallback) throw error
        suggestions = localSuggestions()
      }
    }
    const nextCandidates = suggestions.map((suggestion, index) => ({
      candidateId: `suggest-${index + 1}-${Date.now()}`,
      status: 'candidate' as const,
      ...suggestion,
    }))
    setMaterialCandidates(nextCandidates)
    return nextCandidates
  }

  const handleConfirmCandidate = async (candidate: PersonalMaterialCandidate) => {
    await runtime.personalMaterialService.confirmCandidate(candidate, {
      userConfirmed: true,
    })
    setMaterialCandidates((current) =>
      current.filter((item) => item.candidateId !== candidate.candidateId),
    )
    await refreshLibrary()
  }

  const handleDismissCandidate = (candidateId: string) => {
    setMaterialCandidates((current) =>
      current.filter((item) => item.candidateId !== candidateId),
    )
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
    setMaterialCandidates([])
    setBackOrigin('home')
    setView('home')
    void refreshLibrary()
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

  const navigateSafelyRef = useRef(navigateSafely)
  // Android 返回键监听只注册一次,通过 ref 读取最新来源视图。
  const backOriginRef = useRef(backOrigin)

  useEffect(() => {
    viewRef.current = view
    navigateSafelyRef.current = navigateSafely
    backOriginRef.current = backOrigin
  }, [backOrigin, navigateSafely, view])

  useEffect(() => {
    resetViewScroll()
  }, [view])

  useEffect(() => {
    // 只读 ref:监听器注册一次即可拿到最新来源。
    const handleSafeBack = () =>
      navigateSafelyRef.current(
        backOriginRef.current === 'practice'
          ? 'questions'
          : backOriginRef.current,
      )
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
      const action = resolveAndroidBackAction(
        viewRef.current,
        canGoBack,
        backOriginRef.current,
      )
      switch (action) {
        case 'safe-practice-exit':
          window.dispatchEvent(new Event(SAFE_PRACTICE_BACK_EVENT))
          break
        case 'origin':
          navigateSafelyRef.current(
            backOriginRef.current === 'practice'
              ? 'questions'
              : backOriginRef.current,
          )
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
      {view !== 'practice' ? (
        <AppHeader
          accountLabel={
            cloudSession?.user.email.split('@')[0] ?? currentAccount?.displayName ?? '本机用户'
          }
          apiConnected={apiConnected}
          onBrandClick={() => navigateSafely('home')}
          onAccountClick={() => navigateSafely('accounts')}
        />
      ) : null}

      {storageError ? (
        <Notice tone="error" text={storageError} onDismiss={() => setStorageError(null)} />
      ) : null}

      {navigationNotice ? (
        <Notice tone="info" text={navigationNotice} onDismiss={() => setNavigationNotice(null)} />
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
            titleOverride={preferences.homeTitleOverride}
            subtitleOverride={preferences.homeSubtitleOverride}
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
            onImport={() => {
              rememberBackOrigin('imports')
              navigateSafely('imports')
            }}
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
            onBack={() => navigateSafely(backTarget())}
            backLabel={BACK_LABELS[backOrigin] ?? '返回'}
          />
        ) : view === 'history' ? (
          <ReviewCenter active="history" onChange={navigateSafely}>
            <LearnerMemoryPanel sessions={sessions} />
            <HistoryView
              questions={questionsForHistory}
              sessions={sessions}
              onOpen={openSession}
              onDelete={(sessionId) => void deleteSession(sessionId)}
              onPractice={(questionId) => {
                const question = questionsForHistory.find((item) => item.id === questionId)
                if (question) {
                  void startQuestion(question)
                } else {
                  setStorageError('这条练习关联的原题已不存在，记录本身仍安全保留。')
                }
              }}
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
              candidates={materialCandidates}
              onCreate={async (input) => { await runtime.personalMaterialService.create(input); await refreshLibrary() }}
              onUpdate={async (id, input) => { await runtime.personalMaterialService.update(id, input); await refreshLibrary() }}
              onArchive={async (id) => { await runtime.personalMaterialService.archive(id); await refreshLibrary() }}
              onRestore={async (id) => { await runtime.personalMaterialService.restore(id); await refreshLibrary() }}
              onDelete={async (id) => { await runtime.personalMaterialService.delete(id); await refreshLibrary() }}
              onSuggestMaterials={handleSuggestMaterials}
              onConfirmCandidate={handleConfirmCandidate}
              onDismissCandidate={handleDismissCandidate}
            />
          </ReviewCenter>
        ) : view === 'accounts' ? (
          <AccountView
            service={runtime.accountService}
            onSwitched={handleAccountSwitched}
            onOpenSettings={() => {
              rememberBackOrigin('settings')
              navigateSafely('settings')
            }}
            preferences={preferences}
            onPreferencesChange={changeUserPreferences}
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
              onBack={() => navigateSafely(backTarget())}
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
            onBack={() => navigateSafely(backTarget())}
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
