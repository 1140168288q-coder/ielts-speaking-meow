import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { CheckCircle2, ChevronLeft, Lightbulb, Play, Sparkles, Square } from 'lucide-react'
import type { PracticeService } from '../../application/practiceService'
import type {
  AiFeedback,
  PracticeAttempt,
  Question,
  ReferenceAnswer,
  TrainingSession,
} from '../../domain'
import {
  buildTutorContext,
  createLocalSummary,
  retrieveTutorKnowledge,
  type ReusableExpression,
  type ReusablePersonalMaterial,
} from '../../domain'
import type { LLMProvider } from '../../ports/ai'
import type { AudioFocus } from '../../ports/speech'
import {
  formatDuration,
  partLabel,
} from './format'
import { buildQuestionSpeechText } from './questionSpeech'
import { TtsPlaybackBar } from './TtsPlaybackBar'
import { useTtsToggle } from './useTtsToggle'

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
      setAiNote('正在获取 AI 文本分析和 3 个参考回答…')
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
      setMessage('第二次回答已保存。现在可以完成练习，或挑一句收进个人语料。')
    }
  }

  const prepareSecond = async () => {
    onExitGuardChange(true)
    setBusy(true)
    try {
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

  const submitCorpus = async (text: string) => {
    onExitGuardChange(true)
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
      text: item.material.content,
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
      <div className="practice-topbar">
        <button type="button" className="icon-button" onClick={onBack} aria-label="返回题库">
          <ChevronLeft aria-hidden="true" size={21} />
        </button>
        <div className="step-track" role="group" aria-label={`当前第 ${step} 步，共 4 步`}>
          {[1, 2, 3, 4].map((value) => (
            <span key={value} className={value <= step ? 'active' : ''} />
          ))}
        </div>
        <span className="step-count">{step}/4</span>
      </div>

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
        <div className="practice-stack">
          <AnswerTextCard attempt={firstAttempt} />
          {aiFeedback ? (
            <AiFeedbackCard
              feedback={aiFeedback}
              playingKey={speakingKey}
              onToggle={(key, text) => void toggleSpeak(key, text)}
              detail={feedbackDetail}
            />
          ) : (
            <LocalFeedbackCard busy={aiBusy} attempt={firstAttempt} />
          )}
          {aiNote ? <div className="inline-note">{aiNote}</div> : null}
          {aiConfigured && !aiFeedback ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busy || aiBusy}
              onClick={() => void requestAiFeedback(session)}
            >
              {aiBusy ? '正在获取 AI 分析…' : '重试 AI 分析'}
            </button>
          ) : null}
          <section className="next-attempt-card">
            <p className="eyebrow">第二次是核心</p>
            <h2>先用本地重点继续练；AI 结果会在后台补充。</h2>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void prepareSecond()}
            >
              进入第二次回答
            </button>
          </section>
        </div>
      ) : null}

      {stage === 'second-answer' ? (
        <div className="practice-stack">
          <TutorKnowledgeCard docs={tutorKnowledge} />
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
          attempt={secondAttempt}
          busy={busy}
          onSubmit={(text) => void submitCorpus(text)}
          onComplete={() => void completePractice()}
        />
      ) : null}

      {stage === 'completed' ? (
        <section className="completed-card">
          <span className="celebration" aria-hidden="true"><CheckCircle2 size={28} /></span>
          <p className="eyebrow">本次练习完成</p>
          <h2>你已经完成了两次回答</h2>
          <p>练习记录已保存；确认过的短表达可在“复盘 → 个人语料”继续复习。</p>
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
  playing,
  compact,
  onToggle,
}: {
  question: Question
  playing: boolean
  compact: boolean
  onToggle: () => void
}) {
  const cueList = 'cuePoints' in question ? (
    <ul className="cue-list">
      {question.cuePoints.map((point) => (
        <li key={point}>{point}</li>
      ))}
    </ul>
  ) : null

  return (
    <article className={compact ? 'prompt-card compact' : 'prompt-card'}>
      <div className="prompt-meta">
        <span>{partLabel(question.part)}</span>
        <span>{question.topic}</span>
      </div>
      <h1>{question.prompt}</h1>
      {compact && cueList ? (
        <details className="compact-cue-list">
          <summary>查看提示点</summary>
          {cueList}
        </details>
      ) : cueList}
      <div className="prompt-actions">
        <button
          type="button"
          className={playing ? 'sound-button playing' : 'sound-button'}
          onClick={onToggle}
        >
          {playing ? <Square aria-hidden="true" size={15} fill="currentColor" /> : <Play aria-hidden="true" size={16} fill="currentColor" />}
          {playing ? '停止播报' : '播放题目'}
        </button>
        <span className="audio-state">
          {playing ? '正在播报' : '可随时试听题目'}
        </span>
      </div>
    </article>
  )
}

function TutorKnowledgeCard({
  docs,
}: {
  docs: ReturnType<typeof retrieveTutorKnowledge>
}) {
  if (docs.length === 0) return null
  return (
    <details className="tutor-knowledge-card">
      <summary>
        本题备考要点（{docs.length} 条）· 离线可用
      </summary>
      <div className="tutor-knowledge-list">
        {docs.map((item) => (
          <article key={item.doc.id}>
            <strong>{item.doc.title}</strong>
            <p>{item.doc.body}</p>
          </article>
        ))}
      </div>
    </details>
  )
}

function ReusableMaterialCard({
  items,
  playingKey,
  onToggle,
  onUse,
}: {
  items: ReusableExpression[]
  playingKey: string | null
  onToggle: (key: string, text: string) => void
  onUse: (item: ReusableExpression) => void
}) {
  return (
    <section className="reusable-material-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">你的个人语料</p>
          <h2>挑一句你说过的话，放进这次回答</h2>
        </div>
      </div>
      <div className="reusable-material-list">
        {items.map((item) => {
          const key = `reuse:${item.expression.id}:${item.expression.text}`
          return (
            <article key={item.expression.id}>
              <div className="reusable-material-meta">
                <span>{item.expression.topic}</span>
                <small>{item.reason}</small>
              </div>
              <p>{item.expression.text}</p>
              <div className="reusable-material-actions">
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => onToggle(key, item.expression.text)}
                >
                  {playingKey === key ? <><Square aria-hidden="true" size={13} fill="currentColor" /> 停止</> : <><Play aria-hidden="true" size={14} fill="currentColor" /> 试听</>}
                </button>
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => onUse(item)}
                >
                  + 插入答案
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function PersonalMaterialIdeasCard({
  items,
  onUse,
}: {
  items: ReusablePersonalMaterial[]
  onUse: (item: ReusablePersonalMaterial) => void
}) {
  return (
    <section className="personal-material-ideas-card">
      <div className="section-heading compact-heading">
        <span className="memory-icon"><Lightbulb aria-hidden="true" size={20} /></span>
        <div>
          <p className="eyebrow">你的个人素材 · 说什么</p>
          <h2>这些真实经历可能适合本题</h2>
        </div>
      </div>
      <div className="personal-material-ideas-list">
        {items.map((item) => (
          <article key={item.material.id}>
            <div><strong>{item.material.title}</strong><small>{item.reason}</small></div>
            <p>{item.material.content}</p>
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => onUse(item)}
            >
              + 插入答案
            </button>
          </article>
        ))}
      </div>
      <small className="privacy-caption">仅在本机展示，不会自动发送给 AI；需要个性化生成时应再次由你确认。</small>
    </section>
  )
}

type TimerStatus = 'idle' | 'running' | 'paused'

function useManualTimer() {
  const [elapsedMs, setElapsedMs] = useState(0)
  const [status, setStatus] = useState<TimerStatus>('idle')
  const startedAtRef = useRef(0)
  const accumulatedMsRef = useRef(0)
  const intervalRef = useRef<number | null>(null)

  const stopTicking = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const start = () => {
    if (status === 'running') return
    stopTicking()
    accumulatedMsRef.current = 0
    startedAtRef.current = Date.now()
    setElapsedMs(0)
    setStatus('running')
    intervalRef.current = window.setInterval(() => {
      setElapsedMs(
        accumulatedMsRef.current + Math.max(0, Date.now() - startedAtRef.current),
      )
    }, 250)
  }

  const pause = () => {
    if (status !== 'running') return
    stopTicking()
    accumulatedMsRef.current += Math.max(0, Date.now() - startedAtRef.current)
    setElapsedMs(accumulatedMsRef.current)
    setStatus('paused')
  }

  const resume = () => {
    if (status !== 'paused') return
    startedAtRef.current = Date.now()
    setStatus('running')
    intervalRef.current = window.setInterval(() => {
      setElapsedMs(
        accumulatedMsRef.current + Math.max(0, Date.now() - startedAtRef.current),
      )
    }, 250)
  }

  const reset = () => {
    stopTicking()
    accumulatedMsRef.current = 0
    startedAtRef.current = 0
    setElapsedMs(0)
    setStatus('idle')
  }

  useEffect(() => stopTicking, [])

  return { elapsedMs, status, start, pause, resume, reset }
}

function AnswerEntryStage({
  eyebrow,
  heading,
  buttonLabel,
  busy,
  insertSeed = null,
  draftKey,
  onSubmit,
}: {
  eyebrow: string
  heading: string
  buttonLabel: string
  busy: boolean
  insertSeed?: { nonce: number; text: string } | null
  draftKey: string
  onSubmit: (text: string, answerDurationMs: number | null) => void
}) {
  const [draft, setDraft] = useState(() => readPracticeDraft(draftKey))
  const { elapsedMs, status, start, pause, resume, reset } = useManualTimer()

  useEffect(() => {
    try {
      if (draft.trim().length === 0) {
        window.localStorage.removeItem(draftKey)
      } else {
        window.localStorage.setItem(draftKey, draft)
      }
    } catch {
      // The answer remains in component state if local draft storage is unavailable.
    }
  }, [draft, draftKey])

  // 用户点击“插入素材”时,把历史表达追加到当前答案框。
  useEffect(() => {
    if (insertSeed === null) return
    const text = insertSeed.text.trim()
    if (text.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 把外部点击事件转成受控 textarea 的一次性追加
    setDraft((current) => {
      const cleanCurrent = current.trim()
      return cleanCurrent.length === 0
        ? text
        : `${cleanCurrent} ${text}`
    })
  }, [insertSeed])

  const submit = () => {
    const text = draft.trim()
    if (text.length === 0 || busy) return
    onSubmit(text, elapsedMs > 0 ? elapsedMs : null)
  }

  return (
    <section className="answer-entry-card">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{heading}</h2>
      <label className="answer-field">
        <span>你的答案文本</span>
        <textarea
          value={draft}
          rows={7}
          maxLength={10_000}
          placeholder="在这里输入你的英文回答。也可以用手机键盘上的麦克风语音输入，再手动改掉识别错误。"
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <p className="keyboard-hint">
        手机系统键盘自带语音输入，可以直接说英文；本应用不会录音或转写。
      </p>
      <div className="manual-timer">
        <div className="manual-timer-head">
          <span>参考计时</span>
          <strong>{formatTimer(elapsedMs)}</strong>
        </div>
        <p>计时仅供参考，不会强制结束或自动提交。</p>
        <div className="manual-timer-actions">
          {status === 'running' ? (
            <button type="button" className="secondary-button compact" onClick={pause}>
              暂停
            </button>
          ) : null}
          {status === 'paused' ? (
            <button type="button" className="secondary-button compact" onClick={resume}>
              继续
            </button>
          ) : null}
          {status === 'idle' ? (
            <button type="button" className="secondary-button compact" onClick={start}>
              开始计时
            </button>
          ) : null}
          <button type="button" className="secondary-button compact" onClick={reset}>
            重置
          </button>
        </div>
      </div>
      <button
        type="button"
        className="primary-button"
        disabled={busy || draft.trim().length === 0}
        onClick={submit}
      >
        {busy ? '正在保存…' : buttonLabel}
      </button>
    </section>
  )
}

function AnswerTextCard({ attempt }: { attempt: PracticeAttempt }) {
  const durationMs = attempt.metrics.durationMs
  return (
    <section className="answer-text-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">已保存的第一次回答</p>
          <h2>这次说了什么</h2>
        </div>
        {durationMs > 0 ? (
          <span className="answer-duration">作答用时 {formatDuration(durationMs)}</span>
        ) : null}
      </div>
      <p className="answer-quote">{attempt.transcript.text}</p>
    </section>
  )
}

function LocalFeedbackCard({
  attempt,
  busy,
}: {
  attempt: PracticeAttempt
  busy: boolean
}) {
  const summary = createLocalSummary(attempt.metrics)
  return (
    <section className="summary-feedback-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{busy ? '正在分析' : '本地规则提示'}</p>
          <h2>先看最值得改的一点</h2>
        </div>
      </div>
      {busy ? (
        <div className="inline-note" role="status">
          正在获取 AI 文本分析…
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

function AiFeedbackCard({
  feedback,
  playingKey,
  onToggle,
  detail,
}: {
  feedback: AiFeedback
  playingKey: string | null
  onToggle: (key: string, text: string) => void
  detail: 'focused' | 'expanded'
}) {
  const [activeReferenceIndex, setActiveReferenceIndex] = useState(0)
  const topIssues = pickTopIssues(feedback)
  const references = feedback.referenceAnswers
  const activeReference = references[activeReferenceIndex] ?? references[0]

  return (
    <section className="ai-feedback-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">AI 文本分析 · 不评分</p>
          <h2>先改最值得改的 2-3 点</h2>
        </div>
      </div>

      <p className="ai-summary">{feedback.summary}</p>
      {feedback.strengths.length > 0 ? (
        <p className="ai-strengths">
          <strong>已经不错：</strong>
          {feedback.strengths.join('；')}
        </p>
      ) : null}

      {topIssues.length > 0 ? (
        <section className="priority-issues">
          <h3>优先改这 {topIssues.length} 点</h3>
          <ol>
            {topIssues.map((item, index) => (
              <li key={`${item.tone}-${index}`} className={item.tone}>
                <span>{index + 1}</span>
                <p>{item.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {feedback.grammarSuggestions.length > 0 ? (
        <details className="feedback-details grammar" open={detail === 'expanded'}>
          <summary>
            语法微修（{feedback.grammarSuggestions.length}）
          </summary>
          <ul>
            {feedback.grammarSuggestions.map((item, index) => (
              <li key={`grammar-${index}`}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {feedback.vocabularySuggestions.length > 0 ? (
        <details className="feedback-details vocabulary" open={detail === 'expanded'}>
          <summary>
            词汇替换（{feedback.vocabularySuggestions.length}）
          </summary>
          <ul>
            {feedback.vocabularySuggestions.map((item, index) => (
              <li key={`vocabulary-${index}`}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="improved-answer-details" open={detail === 'expanded'}>
        <summary>优化答案（保持你的水平，不是范文）</summary>
        <TtsSection
          title="优化答案"
          text={feedback.improvedAnswer}
          playingKey={playingKey}
          onToggle={onToggle}
        />
      </details>

      {references.length > 0 ? (
        <section className="reference-answers">
          <div className="reference-heading">
            <p className="eyebrow">3 个参考回答</p>
            <h3>逐个看，不要一次读三篇</h3>
          </div>
          <div className="reference-tabs" role="tablist" aria-label="参考回答版本">
            {references.map((reference, index) => (
              <button
                key={`${reference.label}-${index}`}
                type="button"
                role="tab"
                aria-selected={index === activeReferenceIndex}
                className={index === activeReferenceIndex ? 'active' : ''}
                onClick={() => setActiveReferenceIndex(index)}
              >
                {reference.label}
              </button>
            ))}
          </div>
          {activeReference ? (
            <ReferenceAnswerCard
              reference={activeReference}
              playingKey={playingKey}
              onToggle={onToggle}
            />
          ) : null}
        </section>
      ) : null}
    </section>
  )
}

function pickTopIssues(feedback: AiFeedback): Array<{
  text: string
  tone: 'problem' | 'grammar' | 'vocabulary'
}> {
  if (feedback.problems.length > 0) {
    return feedback.problems.slice(0, 3).map((text) => ({
      text,
      tone: 'problem',
    }))
  }
  const fallback: Array<{ text: string; tone: 'grammar' | 'vocabulary' }> = [
    ...feedback.grammarSuggestions.slice(0, 2).map((text) => ({
      text,
      tone: 'grammar' as const,
    })),
    ...feedback.vocabularySuggestions.slice(0, 1).map((text) => ({
      text,
      tone: 'vocabulary' as const,
    })),
  ]
  return fallback.slice(0, 3)
}

function TtsSection({
  title,
  text,
  playingKey,
  onToggle,
}: {
  title: string
  text: string
  playingKey: string | null
  onToggle: (key: string, text: string) => void
}) {
  const key = `tts:${title}:${text}`
  return (
    <section className="tts-section">
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <TtsPlayButton
        label="试听"
        playingLabel="停止"
        playing={playingKey === key}
        onClick={() => onToggle(key, text)}
      />
    </section>
  )
}

function ReferenceAnswerCard({
  reference,
  playingKey,
  onToggle,
}: {
  reference: ReferenceAnswer
  playingKey: string | null
  onToggle: (key: string, text: string) => void
}) {
  const key = `tts:reference:${reference.label}:${reference.text}`
  return (
    <article className="reference-answer-card">
      <div className="version-head">
        <strong>{reference.label}</strong>
      </div>
      <p>{reference.text}</p>
      <TtsPlayButton
        label={`试听 ${reference.label}`}
        playingLabel="停止"
        playing={playingKey === key}
        onClick={() => onToggle(key, reference.text)}
      />
    </article>
  )
}

function TtsPlayButton({
  label,
  playingLabel,
  playing,
  onClick,
}: {
  label: string
  playingLabel: string
  playing: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={playing ? 'secondary-button playing' : 'secondary-button'}
      onClick={onClick}
    >
      {playing ? <Square aria-hidden="true" size={14} fill="currentColor" /> : <Play aria-hidden="true" size={15} fill="currentColor" />}
      {playing ? playingLabel : label}
    </button>
  )
}

function ReferenceRecap({
  feedback,
  playingKey,
  onToggle,
}: {
  feedback: AiFeedback
  playingKey: string | null
  onToggle: (key: string, text: string) => void
}) {
  return (
    <section className="reference-recap-card">
      <p className="eyebrow">上一轮参考</p>
      <h2>回答前可随时试听优化版和 3 个参考回答</h2>
      <div className="reference-recap-actions">
        <TtsPlayButton
          label="优化答案"
          playingLabel="停止"
          playing={playingKey === `tts:recap:improved:${feedback.improvedAnswer}`}
          onClick={() => onToggle(`tts:recap:improved:${feedback.improvedAnswer}`, feedback.improvedAnswer)}
        />
        {feedback.referenceAnswers.map((reference, index) => {
          const key = `tts:recap:reference:${index}:${reference.text}`
          return (
            <TtsPlayButton
              key={key}
              label={reference.label}
              playingLabel="停止"
              playing={playingKey === key}
              onClick={() => onToggle(key, reference.text)}
            />
          )
        })}
      </div>
    </section>
  )
}

function SubmitCorpusStage({
  attempt,
  busy,
  onSubmit,
  onComplete,
}: {
  attempt: PracticeAttempt
  busy: boolean
  onSubmit: (text: string) => void
  onComplete: () => void
}) {
  const [draft, setDraft] = useState(() => suggestReusableSnippet(attempt.transcript.text))
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
        ? suggestReusableSnippet(incomingText)
        : current,
    )
  }, [attempt.id, attempt.transcript.text, attempt.transcript.updatedAt])

  return (
    <section className="submit-corpus-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">完成与沉淀</p>
          <h2>这次练习已经完成，要留下一句以后再用吗？</h2>
        </div>
        {attempt.metrics.durationMs > 0 ? (
          <span className="answer-duration">
            作答用时 {formatDuration(attempt.metrics.durationMs)}
          </span>
        ) : null}
      </div>
      <label className="transcript-field">
        <span>
          候选表达
          <small>系统先挑出一句；请确认或改短。完整回答不会进入个人语料库。</small>
        </span>
        <textarea
          value={draft}
          placeholder="例如：It helps me unwind after a long day."
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          maxLength={320}
        />
      </label>
      <div className="corpus-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy || draft.trim().length === 0}
          onClick={() => onSubmit(draft)}
        >
          <Sparkles aria-hidden="true" size={17} />
          {busy ? '正在保存…' : '收进个人语料并完成'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onComplete}
        >
          仅完成练习
        </button>
      </div>
    </section>
  )
}

function practiceDraftKey(session: TrainingSession, attemptNumber: 1 | 2): string {
  return `ielts-speaking-meow:draft:${session.ownerId ?? 'local'}:${session.id}:${attemptNumber}`
}

function clearPracticeDraft(session: TrainingSession, attemptNumber: 1 | 2): void {
  try {
    window.localStorage.removeItem(practiceDraftKey(session, attemptNumber))
  } catch {
    // Draft persistence is best-effort; the durable answer is already saved.
  }
}

function readPracticeDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function suggestReusableSnippet(text: string): string {
  const clean = text.trim()
  const firstSentence = clean.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? clean
  return firstSentence.slice(0, 320)
}

function formatTimer(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
