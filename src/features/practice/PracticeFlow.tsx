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
  Question,
  TrainingSession,
} from '../../domain'
import {
  buildTutorContext,
  retrieveTutorKnowledge,
  type ReusableExpression,
  type ReusablePersonalMaterial,
} from '../../domain'
import type { LLMProvider } from '../../ports/ai'
import type { AudioFocus } from '../../ports/speech'
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
  const [insertSeed, setInsertSeed] = useState<{ nonce: number; text: string } | null>(null)
  const mountedRef = useRef(true)
  const sessionRef = useRef(session)
  const onChangeRef = useRef(onChange)
  const aiRequestGenerationRef = useRef(0)
  const aiRequestInFlightRef = useRef(false)
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
  const spokenQuestion = buildQuestionSpeechText(question)

  useEffect(() => {
    sessionRef.current = session
    onChangeRef.current = onChange
  }, [onChange, session])

  useEffect(() => {
    // React StrictMode runs one development-only setup/cleanup cycle before the
    // real mount. Reset the flag in setup so async feedback can still release
    // loading state after that cycle.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      aiRequestGenerationRef.current += 1
      aiRequestInFlightRef.current = false
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

  const requestAiFeedback = useCallback(
    async (targetSession: TrainingSession) => {
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
      setAiNote('正在获取 AI 文本分析和 2 个参考回答…')
      try {
        const feedback = await textAi.getFeedback({
          question,
          answer: attempt.transcript.text,
          answerDurationSeconds:
            attempt.metrics.durationMs > 0
              ? Math.max(1, Math.round(attempt.metrics.durationMs / 1_000))
              : null,
          tutorContext,
          ...(learnerContext.trim().length > 0
            ? { learnerContext: learnerContext.trim() }
            : {}),
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
        )
        if (generation !== aiRequestGenerationRef.current) return
        if (updated === null) {
          setAiNote('答案文本已发生变化，本次旧 AI 结果未保存；可重新分析。')
          return
        }
        onChangeRef.current(updated)
        setAiNote(null)
      } catch (error) {
        if (generation !== aiRequestGenerationRef.current) return
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
    },
    [learnerContext, question, service, textAi, tutorContext],
  )

  const requestSecondAnalysis = useCallback(
    async (targetSession: TrainingSession) => {
      const getSecondAttemptAnalysis = textAi.getSecondAttemptAnalysis
      const attempt = targetSession.attempts.find(
        (item) => item.attemptNumber === 2,
      )
      if (
        !textAi.isConfigured() ||
        getSecondAttemptAnalysis === undefined ||
        attempt?.transcript.status !== 'ready' ||
        attempt.transcript.text.trim().length === 0
      ) {
        return
      }
      const analyzeSecondAttempt = getSecondAttemptAnalysis

      if (aiRequestInFlightRef.current) return
      const generation = ++aiRequestGenerationRef.current
      aiRequestInFlightRef.current = true
      setAiBusy(true)
      setAiNote('正在按简单优化标准检查第二次回答…')
      try {
        const analysis = await analyzeSecondAttempt({
          question,
          answer: attempt.transcript.text,
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
          setAiNote('答案文本已发生变化，本次二答分析未保存；可以重试。')
          return
        }
        onChangeRef.current(updated)
        setAiNote(null)
      } catch (error) {
        if (generation !== aiRequestGenerationRef.current) return
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
      setMessage('第二次回答已保存，正在整理修正句和可加入 Memory 的信息。')
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
        <ReviewFirstStage
          firstAttempt={firstAttempt}
          aiFeedback={aiFeedback}
          aiConfigured={aiConfigured}
          aiBusy={aiBusy}
          aiNote={aiNote}
          busy={busy}
          feedbackDetail={feedbackDetail}
          speakingKey={speakingKey}
          onToggleSpeak={(key, text) => void toggleSpeak(key, text)}
          onRequestAiFeedback={() => void requestAiFeedback(session)}
          onPrepareSecond={() => void prepareSecond()}
        />
      ) : null}

      {stage === 'second-answer' ? (
        <div className="practice-stack">
          {aiFeedback ? (
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
          busy={busy}
          onRetryAnalysis={() => void requestSecondAnalysis(session)}
          onSubmit={(correctedSentences, memoryCandidates) =>
            void submitCorpus(correctedSentences, memoryCandidates)
          }
          onComplete={() => void completePractice()}
        />
      ) : null}

      {stage === 'completed' ? (
        <section className="completed-card">
          <span className="celebration" aria-hidden="true"><CheckCircle2 size={28} /></span>
          <p className="eyebrow">本次练习完成</p>
          <h2>你已经完成了两次回答</h2>
          <p>留下的句子，会在「复盘 · 个人语料」等你回来。</p>
          <button type="button" className="primary-button" onClick={onBack}>
            {backLabel}
          </button>
        </section>
      ) : null}
    </section>
  )
}
