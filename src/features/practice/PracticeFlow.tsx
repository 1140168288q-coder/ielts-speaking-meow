import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { CheckCircle2 } from 'lucide-react'
import type { PracticeService } from '../../application/practiceService'
import type {
  MemoryCandidate,
  NaturalUpgradeLevel,
  Question,
  SpokenEnglishStyle,
  TrainingSession,
} from '../../domain'
import { feedbackLengthBudget } from '../../domain/feedbackGeneration'
import {
  buildTrainingPlan,
  buildTutorContext,
  retrieveTutorKnowledge,
  type ReusableExpression,
  type ReusablePersonalMaterial,
} from '../../domain'
import type { LLMProvider } from '../../ports/ai'
import type { AudioFocus } from '../../ports/speech'
import { ApiProviderError } from '../../infrastructure/ai/providerErrors'
import { buildQuestionSpeechText } from './questionSpeech'
import { TtsPlaybackBar } from './TtsPlaybackBar'
import { useTtsToggle } from './useTtsToggle'
import { QuestionCard } from './components/QuestionCard'
import { TutorKnowledgeCard } from './components/TutorKnowledgeCard'
import { ReusableMaterialCard } from './components/ReusableMaterialCard'
import { PersonalMaterialIdeasCard } from './components/PersonalMaterialIdeasCard'
import { PracticeTopBar } from './components/PracticeTopBar'
import { ReferenceRecap } from './components/feedback/ReferenceAnswers'
import { AnswerFrameworkCard } from './components/feedback/AnswerFrameworkCard'
import { AiFeedbackCard } from './components/feedback/AiFeedbackCard'
import { LocalFeedbackCard } from './components/feedback/LocalFeedbackCard'
import { AnswerTextCard } from './components/AnswerTextCard'
import { TrainingPlanCard } from './components/TrainingPlanCard'
import { AnswerEntryStage } from './stages/AnswerEntryStage'
import { ReviewFirstStage } from './stages/ReviewFirstStage'
import { SubmitCorpusStage } from './stages/SubmitCorpusStage'
import { clearPracticeDraft, practiceDraftKey } from './practiceDraft'

type Stage =
  | 'first-answer'
  | 'review-first'
  | 'second-answer'
  | 'second-submit'
  | 'completed'

function deriveStage(session: TrainingSession): Stage {
  const hasAttempt = (number: 1 | 2) =>
    session.attempts.some((attempt) => attempt.attemptNumber === number)

  if (session.status === 'completed') return 'completed'
  if (hasAttempt(2)) return 'second-submit'
  if (session.status === 'second-ready') return 'second-answer'
  if (hasAttempt(1)) return 'review-first'
  return 'first-answer'
}

const STAGE_STEP: Record<Stage, number> = {
  'first-answer': 1,
  'review-first': 2,
  'second-answer': 3,
  'second-submit': 4,
  completed: 4,
}

export function PracticeFlow({
  question,
  session,
  service,
  audioFocus,
  textAi,
  reusableExpressions = [],
  reusablePersonalMaterials = [],
  learnerContext = '',
  userKnowledgeContext = '',
  naturalUpgradeLevel = 'medium',
  spokenEnglishStyle = 'british',
  autoPlayQuestion = true,
  feedbackDetail = 'focused',
  onExpressionReused = () => undefined,
  onExitGuardChange,
  onChange,
  onBack,
  backLabel = '返回题库',
}: {
  question: Question
  session: TrainingSession
  service: PracticeService
  audioFocus: AudioFocus
  textAi: LLMProvider
  reusableExpressions?: ReusableExpression[]
  reusablePersonalMaterials?: ReusablePersonalMaterial[]
  learnerContext?: string
  userKnowledgeContext?: string
  naturalUpgradeLevel?: NaturalUpgradeLevel
  spokenEnglishStyle?: SpokenEnglishStyle
  autoPlayQuestion?: boolean
  feedbackDetail?: 'focused' | 'expanded'
  onExpressionReused?: (expressionId: string) => void | Promise<void>
  onExitGuardChange: (active: boolean) => void
  onChange: (session: TrainingSession) => void
  onBack: () => void
  backLabel?: string
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [aiRetryable, setAiRetryable] = useState(true)
  const [insertSeed, setInsertSeed] = useState<{ nonce: number; text: string } | null>(null)
  const [activeUpgradeLevel, setActiveUpgradeLevel] = useState<NaturalUpgradeLevel>(
    session.feedbackGenerationProfile?.level ?? naturalUpgradeLevel,
  )
  const [activeSpokenStyle, setActiveSpokenStyle] = useState<SpokenEnglishStyle>(
    session.feedbackGenerationProfile?.style ?? spokenEnglishStyle,
  )
  const mountedRef = useRef(true)
  const sessionRef = useRef(session)
  const onChangeRef = useRef(onChange)
  const aiRequestGenerationRef = useRef(0)
  const aiRequestInFlightRef = useRef(false)
  const aiRequestPromiseRef = useRef<Promise<void> | null>(null)
  const secondAiRequestInFlightRef = useRef(false)
  const autoPlayedRef = useRef(false)
  const {
    speakingKey,
    playback: ttsPlayback,
    toggle: toggleTts,
    pause: pauseTts,
    resume: resumeTts,
    seek: seekTts,
    stop: stopTts,
  } = useTtsToggle(audioFocus)

  const stage = deriveStage(session)
  const step = STAGE_STEP[stage]
  const aiConfigured = textAi.isConfigured()
  const aiFeedback = session.aiFeedback
  const tutorContext = buildTutorContext(question)
  const tutorKnowledge = retrieveTutorKnowledge(question)
  const planningKnowledge = retrieveTutorKnowledge(question, 2, { need: 'answer-planning' })
  const spokenQuestion = buildQuestionSpeechText(question)

  useEffect(() => {
    sessionRef.current = session
    onChangeRef.current = onChange
  }, [onChange, session])

  useEffect(() => {
    // Keep the practice exit guard active while a durable answer or its AI
    // result is being written. The answer is already local, but leaving here
    // would otherwise unmount the flow and discard a late validated result.
    onExitGuardChange(aiBusy || busy)
    return () => onExitGuardChange(false)
  }, [aiBusy, busy, onExitGuardChange])

  useEffect(() => {
    // React StrictMode runs one development-only setup/cleanup cycle before the
    // real mount. Reset the flag in setup so async feedback can still release
    // loading state after that cycle.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      aiRequestGenerationRef.current += 1
      aiRequestInFlightRef.current = false
      secondAiRequestInFlightRef.current = false
    }
  }, [])

  // 进入答题界面自动播放一次题目;用户可随时用按钮重播或停止。
  // 计时器不会自动开始。
  useEffect(() => {
    if (autoPlayedRef.current || !autoPlayQuestion) return
    autoPlayedRef.current = true
    void toggleTts(`question:${question.id}`, spokenQuestion).catch(() => undefined)
    // 只在进入练习页时按用户偏好自动播放一次,失败静默(可手动重播)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showError = (error: unknown, fallback: string) => {
    if (!mountedRef.current) return
    setMessage(error instanceof Error ? error.message : fallback)
  }

  const canRetryAiError = (error: unknown): boolean =>
    error instanceof ApiProviderError ? error.retryable : true

  const requestAiFeedback = useCallback(
    async (targetSession: TrainingSession) => {
      const attempt = targetSession.attempts.find(
        (item) => item.attemptNumber === 1,
      )
      if (!textAi.isConfigured()) {
        setAiRetryable(false)
        setAiNote('Text AI 未配置；已保留本地规则提示，可以继续完成第二次回答。')
        return
      }
      if (
        attempt?.transcript.status !== 'ready' ||
        attempt.transcript.text.trim().length === 0
      ) {
        setAiRetryable(false)
        setAiNote('第一次回答文本为空；已保留本地规则提示。')
        return
      }

      if (aiRequestPromiseRef.current !== null) {
        setAiNote('Text AI 反馈仍在处理中，请等待本次请求完成。')
        return
      }

      const generation = ++aiRequestGenerationRef.current
      const operation = (async () => {
        aiRequestInFlightRef.current = true
        setAiBusy(true)
        setAiRetryable(true)
        setAiNote('正在获取 AI 文本分析和 2 个参考回答…')
        try {
          const feedback = await textAi.getFeedback({
            question,
            answer: attempt.transcript.text,
            idempotencyKey: buildAnalysisIdempotencyKey(
              targetSession.id,
              attempt.id,
              attempt.transcript.updatedAt,
              1,
            ),
            answerDurationSeconds:
              attempt.metrics.durationMs > 0
                ? Math.max(1, Math.round(attempt.metrics.durationMs / 1_000))
                : null,
            tutorContext,
            ...(learnerContext.trim().length > 0
              ? { learnerContext: learnerContext.trim() }
              : {}),
            ...(userKnowledgeContext.trim().length > 0
              ? { userKnowledgeContext: userKnowledgeContext.trim() }
              : {}),
            naturalUpgradeLevel: activeUpgradeLevel,
            spokenEnglishStyle: activeSpokenStyle,
          })

          if (generation !== aiRequestGenerationRef.current) return
          const updated = await service.applyAiFeedbackIfAnswerCurrent(
            targetSession.id,
            {
              attemptId: attempt.id,
              text: attempt.transcript.text,
              updatedAt: attempt.transcript.updatedAt,
            },
            feedback,
            {
              level: activeUpgradeLevel,
              style: activeSpokenStyle,
              profileVersion: 1,
            },
          )
          if (generation !== aiRequestGenerationRef.current) return
          if (updated === null) {
            setAiRetryable(true)
            setAiNote('答案文本已发生变化，本次旧 AI 结果未保存；可重新分析。')
            return
          }
          onChangeRef.current(updated)
          setAiNote(null)
        } catch (error) {
          if (generation !== aiRequestGenerationRef.current) return
          setAiRetryable(canRetryAiError(error))
          setAiNote(
            error instanceof Error
              ? `${error.message} 已转用本地规则提示。`
              : 'Text AI 暂不可用；已转用本地规则提示。',
          )
        } finally {
          if (generation === aiRequestGenerationRef.current) {
            aiRequestInFlightRef.current = false
            if (mountedRef.current) setAiBusy(false)
          }
        }
      })()
      aiRequestPromiseRef.current = operation
      try {
        await operation
      } finally {
        if (aiRequestPromiseRef.current === operation) {
          aiRequestPromiseRef.current = null
        }
      }
    },
    [activeSpokenStyle, activeUpgradeLevel, learnerContext, question, service, textAi, tutorContext, userKnowledgeContext],
  )

  const requestSecondAnalysis = useCallback(
    async (targetSession: TrainingSession) => {
      const attempt = targetSession.attempts.find(
        (item) => item.attemptNumber === 2,
      )
      if (!textAi.isConfigured()) {
        setAiRetryable(false)
        setAiNote('Text AI 未配置；已保留本地手动候选，可以直接确认语料。')
        return
      }
      if (textAi.getSecondAttemptAnalysis === undefined) {
        setAiRetryable(false)
        setAiNote('当前 Text AI 不支持二答分析；已保留本地手动候选。')
        return
      }
      if (
        attempt?.transcript.status !== 'ready' ||
        attempt.transcript.text.trim().length === 0
      ) {
        setAiRetryable(false)
        setAiNote('二答文本为空；已保留本地手动候选。')
        return
      }

      if (secondAiRequestInFlightRef.current) {
        setAiNote('二答 AI 分析已在处理中，请等待本次请求完成。')
        return
      }
      secondAiRequestInFlightRef.current = true
      const previousRequest = aiRequestPromiseRef.current
      if (previousRequest !== null) {
        setAiBusy(true)
        setAiNote('第一次 AI 分析仍在处理中，二答分析会在它结束后自动开始…')
        await previousRequest
        if (!mountedRef.current) {
          secondAiRequestInFlightRef.current = false
          return
        }
        if (aiRequestPromiseRef.current === previousRequest) {
          aiRequestPromiseRef.current = null
        }
      }

      const generation = ++aiRequestGenerationRef.current
      const operation = (async () => {
        aiRequestInFlightRef.current = true
        setAiBusy(true)
        setAiRetryable(true)
        setAiNote('正在按简单优化标准检查第二次回答…')
        try {
          const analysis = await textAi.getSecondAttemptAnalysis!({
            question,
            answer: attempt.transcript.text,
            idempotencyKey: buildAnalysisIdempotencyKey(
              targetSession.id,
              attempt.id,
              attempt.transcript.updatedAt,
              2,
            ),
          })
          if (generation !== aiRequestGenerationRef.current) return
          const updated = await service.applySecondAttemptAnalysisIfAnswerCurrent(
            targetSession.id,
            {
              attemptId: attempt.id,
              text: attempt.transcript.text,
              updatedAt: attempt.transcript.updatedAt,
            },
            analysis,
          )
          if (generation !== aiRequestGenerationRef.current) return
          if (updated === null) {
            setAiRetryable(true)
            setAiNote('答案文本已发生变化，本次二答分析未保存；可以重试。')
            return
          }
          onChangeRef.current(updated)
          setAiNote(null)
        } catch (error) {
          if (generation !== aiRequestGenerationRef.current) return
          setAiRetryable(canRetryAiError(error))
          setAiNote(
            error instanceof Error
              ? `${error.message}；可以先手动确认语料。`
              : '二答 AI 分析暂不可用；可以先手动确认语料。',
          )
        } finally {
          if (generation === aiRequestGenerationRef.current) {
            aiRequestInFlightRef.current = false
            if (mountedRef.current) setAiBusy(false)
          }
        }
      })()
      aiRequestPromiseRef.current = operation
      try {
        await operation
      } finally {
        secondAiRequestInFlightRef.current = false
        if (aiRequestPromiseRef.current === operation) {
          aiRequestPromiseRef.current = null
        }
      }
    },
    [question, service, textAi],
  )

  const saveAnswer = async (
    attemptNumber: 1 | 2,
    text: string,
    answerDurationMs: number | null,
  ) => {
    onExitGuardChange(true)
    setBusy(true)
    setMessage(null)
    setAiNote(null)
    setAiRetryable(true)
    let saved: TrainingSession | null = null
    try {
      saved = await service.saveTextAttempt(
        session.id,
        attemptNumber,
        text,
        answerDurationMs,
      )
      onChange(saved)
    } catch (error) {
      showError(error, '答案保存失败，请重试。')
    } finally {
      setBusy(false)
      onExitGuardChange(false)
    }

    if (saved === null) return
    if (attemptNumber === 1) {
      clearPracticeDraft(session, attemptNumber)
      void requestAiFeedback(saved)
    } else {
      clearPracticeDraft(session, attemptNumber)
      setMessage(
        aiConfigured
          ? '第二次回答已保存，正在整理修正句和可加入 Memory 的信息。'
          : '第二次回答已保存；当前使用本地手动候选，可以直接确认语料。',
      )
      void requestSecondAnalysis(saved)
    }
  }

  const prepareSecond = async () => {
    onExitGuardChange(true)
    setBusy(true)
    try {
      await stopTts()
      const updated = await service.prepareSecondAttempt(session.id)
      onChange(updated)
      setMessage(null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      showError(error, '暂时无法进入第二次回答。')
    } finally {
      setBusy(false)
      onExitGuardChange(false)
    }
  }

  const submitCorpus = async (
    correctedSentences: string[],
    memoryCandidates: MemoryCandidate[],
  ) => {
    onExitGuardChange(true)
    setBusy(true)
    setMessage(null)
    try {
      const result = await service.finalizeSecondAttempt(
        session.id,
        {
          correctedSentences,
          memoryCandidates,
          topic: question.topic,
        },
      )
      onChange(result.session)
      setMessage(
        `第二次回答已完成${result.expressions.length > 0 ? `，收录 ${result.expressions.length} 句个人语料` : ''}${memoryCandidates.length > 0 ? `，加入 ${memoryCandidates.length} 条 Memory` : ''}。`,
      )
    } catch (error) {
      showError(error, '收录失败，请重试。')
    } finally {
      setBusy(false)
      onExitGuardChange(false)
    }
  }

  const completePractice = async () => {
    onExitGuardChange(true)
    setBusy(true)
    setMessage(null)
    try {
      const updated = await service.completeSession(session.id)
      onChange(updated)
    } catch (error) {
      showError(error, '暂时无法完成练习，请重试。')
    } finally {
      setBusy(false)
      onExitGuardChange(false)
    }
  }

  const toggleSpeak = async (key: string, text: string) => {
    setMessage(null)
    try {
      await toggleTts(key, text)
    } catch (error) {
      showError(error, '语音播放暂不可用，你仍可以继续练习。')
    }
  }

  const reuseExpression = (item: ReusableExpression) => {
    setInsertSeed((current) => ({
      nonce: (current?.nonce ?? 0) + 1,
      text: item.expression.text,
    }))
    try {
      void onExpressionReused(item.expression.id)
    } catch {
      // 复用计数失败不影响答题
    }

  }
  const reusePersonalMaterial = (item: ReusablePersonalMaterial) => {
    setInsertSeed((current) => ({
      nonce: (current?.nonce ?? 0) + 1,
      text: `${item.material.title}：${item.material.content}`,
    }))
  }

  const firstAttempt = session.attempts.find(
    (attempt) => attempt.attemptNumber === 1,
  )
  const secondAttempt = session.attempts.find(
    (attempt) => attempt.attemptNumber === 2,
  )
  const trainingPlan = buildTrainingPlan({
    question,
    teachingDocs: planningKnowledge,
    aiFeedback,
    reusableExpressions,
    reusablePersonalMaterials,
    completedSession: stage === 'completed' ? session : null,
  })

  return (
    <section className="practice-page">
      <PracticeTopBar part={question.part} step={step} onBack={onBack} backLabel={backLabel} />

      <QuestionCard
        question={question}
        playing={speakingKey === `question:${question.id}`}
        compact={stage !== 'first-answer'}
        onToggle={() => void toggleSpeak(`question:${question.id}`, spokenQuestion)}
      />

      {speakingKey ? (
        <TtsPlaybackBar
          playback={ttsPlayback}
          onPause={() => void pauseTts()}
          onResume={() => void resumeTts()}
          onSeek={(positionSeconds) => void seekTts(positionSeconds)}
          onStop={() => void stopTts()}
        />
      ) : null}

      {message ? <div className="notice" role="status">{message}</div> : null}

      {stage === 'first-answer' ? (
        <div className="practice-stack">
          <AnswerEntryStage
            eyebrow="第一次回答"
            heading="输入你的回答，或按住键盘麦克风直接说。"
            buttonLabel="保存第 1 次回答"
            busy={busy}
            insertSeed={insertSeed}
            draftKey={practiceDraftKey(session, 1)}
            onSubmit={(text, durationMs) => void saveAnswer(1, text, durationMs)}
          />
        </div>
      ) : null}

      {stage === 'review-first' && firstAttempt ? (
        <>
          <FeedbackGenerationControls
            part={question.part}
            level={activeUpgradeLevel}
            style={activeSpokenStyle}
            onLevelChange={setActiveUpgradeLevel}
            onStyleChange={setActiveSpokenStyle}
          />
          <ReviewFirstStage
            firstAttempt={firstAttempt}
            aiFeedback={aiFeedback}
            aiConfigured={aiConfigured}
            aiBusy={aiBusy}
            aiNote={aiNote}
            aiRetryable={aiRetryable}
            busy={busy}
            feedbackDetail={feedbackDetail}
            speakingKey={speakingKey}
            onToggleSpeak={(key, text) => void toggleSpeak(key, text)}
            onRequestAiFeedback={() => void requestAiFeedback(session)}
            onPrepareSecond={() => void prepareSecond()}
          />
        </>
      ) : null}

      {stage === 'second-answer' ? (
        <div className="practice-stack">
          <TrainingPlanCard plan={trainingPlan} />
          {firstAttempt && aiFeedback ? (
            <AnswerFrameworkCard feedback={aiFeedback} />
          ) : (
            <TutorKnowledgeCard docs={tutorKnowledge} />
          )}
          {aiFeedback ? (
            <ReferenceRecap
              feedback={aiFeedback}
              playingKey={speakingKey}
              onToggle={(key, text) => void toggleSpeak(key, text)}
            />
          ) : null}
          {reusablePersonalMaterials.length ? (
            <PersonalMaterialIdeasCard
              items={reusablePersonalMaterials}
              onUse={reusePersonalMaterial}
            />
          ) : null}
          {reusableExpressions.length ? (
            <ReusableMaterialCard
              items={reusableExpressions}
              playingKey={speakingKey}
              onToggle={(key, text) => void toggleSpeak(key, text)}
              onUse={reuseExpression}
            />
          ) : null}
          <AnswerEntryStage
            eyebrow="第二次回答"
            heading="结合刚才的重点，再完整回答一次。"
            buttonLabel="提交第 2 次回答"
            busy={busy}
            insertSeed={insertSeed}
            draftKey={practiceDraftKey(session, 2)}
            onSubmit={(text, durationMs) => void saveAnswer(2, text, durationMs)}
          />
        </div>
      ) : null}

      {stage === 'second-submit' && secondAttempt ? (
        <SubmitCorpusStage
          key={`${secondAttempt.id}:${session.secondAttemptAnalysis ? JSON.stringify(session.secondAttemptAnalysis) : 'pending'}`}
          attempt={secondAttempt}
          analysis={session.secondAttemptAnalysis ?? null}
          aiBusy={aiBusy}
          aiNote={aiNote}
          aiRetryable={aiRetryable}
          busy={busy}
          onRetryAnalysis={() => void requestSecondAnalysis(session)}
          onSubmit={(correctedSentences, memoryCandidates) =>
            void submitCorpus(correctedSentences, memoryCandidates)
          }
          onComplete={() => void completePractice()}
        />
      ) : null}

      {stage === 'completed' ? (
        <div className="practice-stack completed-review">
          <section className="completed-card">
            <span className="celebration" aria-hidden="true"><CheckCircle2 size={28} /></span>
            <p className="eyebrow">本次练习完成</p>
            <h2>你已经完成了两次回答</h2>
            <p>下面保留这次练习的重点，方便你回看两次之间的变化。</p>
          </section>
          <TrainingPlanCard plan={trainingPlan} />
          {firstAttempt ? (
            <AnswerTextCard attempt={firstAttempt} />
          ) : null}
          {aiFeedback ? (
            <AiFeedbackCard
              feedback={aiFeedback}
              playingKey={speakingKey}
              onToggle={(key, text) => void toggleSpeak(key, text)}
              detail={feedbackDetail}
            />
          ) : firstAttempt ? (
            <LocalFeedbackCard busy={false} attempt={firstAttempt} />
          ) : null}
          {secondAttempt ? (
            <AnswerTextCard
              attempt={secondAttempt}
              eyebrow="已保存的第二次回答"
              heading="这次比刚才更进一步了吗？"
            />
          ) : null}
          {session.secondAttemptAnalysis ? (
            <section className="second-review-section">
              <p className="eyebrow">二答复盘</p>
              <h2>确认过的修正与个人信息</h2>
              {session.secondAttemptAnalysis.correctedSentences.length > 0 ? (
                <ul>
                  {session.secondAttemptAnalysis.correctedSentences.map((item, index) => (
                    <li key={`${item.original}-${index}`}><small>原句：{item.original}</small><br />{item.corrected}<br /><small>{item.reason}</small></li>
                  ))}
                </ul>
              ) : <p className="settings-note">这次没有确认需要收录的错误句。</p>}
              {session.confirmedMemoryFacts && session.confirmedMemoryFacts.length > 0 ? (
                <p className="settings-note">已确认的个人信息：{session.confirmedMemoryFacts.map((fact) => fact.content).join('；')}</p>
              ) : null}
            </section>
          ) : null}
          <button type="button" className="primary-button" onClick={onBack}>
            {backLabel}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function buildAnalysisIdempotencyKey(
  sessionId: string,
  attemptId: string,
  updatedAt: string,
  attemptNumber: 1 | 2,
): string {
  const raw = `feedback:${sessionId}:${attemptNumber}:${attemptId}:${updatedAt}`
  return raw.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 128)
}

function FeedbackGenerationControls({
  part,
  level,
  style,
  onLevelChange,
  onStyleChange,
}: {
  part: 1 | 2 | 3
  level: NaturalUpgradeLevel
  style: SpokenEnglishStyle
  onLevelChange: (level: NaturalUpgradeLevel) => void
  onStyleChange: (style: SpokenEnglishStyle) => void
}) {
  return (
    <section className="feedback-generation-controls" aria-label="本题自然提升设置">
      <p className="eyebrow">本题自然提升</p>
      <div className="inline-fields">
        <label>
          <span>难度</span>
          <select value={level} onChange={(event) => onLevelChange(event.target.value as NaturalUpgradeLevel)}>
            <option value="simple">简单 · 约 {feedbackLengthBudget(part, 'simple').targetSeconds} 秒</option>
            <option value="medium">中等 · 约 {feedbackLengthBudget(part, 'medium').targetSeconds} 秒</option>
            <option value="challenging">较难 · 约 {feedbackLengthBudget(part, 'challenging').targetSeconds} 秒</option>
          </select>
        </label>
        <label>
          <span>风格</span>
          <select value={style} onChange={(event) => onStyleChange(event.target.value as SpokenEnglishStyle)}>
            <option value="british">英式自然口语</option>
            <option value="american">美式自然口语</option>
          </select>
        </label>
      </div>
      <small>只影响自然提升版；简单优化版始终只修正你的原回答。Part 2 会按独立的 1–2 分钟口语长度生成。</small>
    </section>
  )
}
