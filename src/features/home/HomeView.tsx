import {
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  Clock3,
  Layers3,
  MessageCircleMore,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import type { Question, TrainingSession } from '../../domain'
import { recommendQuestion } from '../../domain/progress'
import { partLabel, statusLabel } from '../practice/format'

const WEEK_MS = 7 * 24 * 60 * 60 * 1_000

export function HomeView({
  questions,
  sessions,
  expressionCount,
  accountName,
  onStart,
  onResume,
  onOpenLibrary,
  onOpenReview,
}: {
  questions: Question[]
  sessions: TrainingSession[]
  expressionCount: number
  accountName: string
  onStart: (question: Question) => void
  onResume: (session: TrainingSession) => void
  onOpenLibrary: (part?: 1 | 2 | 3) => void
  onOpenReview: () => void
}) {
  const questionById = new Map(questions.map((question) => [question.id, question]))
  const resumable = sessions.find((item) => item.status !== 'completed')
  const resumableQuestion = resumable ? questionById.get(resumable.questionId) : undefined
  const recommendation = recommendQuestion(questions, sessions)
  const [openedAt] = useState(Date.now)
  const weeklySessions = sessions.filter((item) => {
    const createdAt = Date.parse(item.createdAt)
    return Number.isFinite(createdAt) && openedAt - createdAt <= WEEK_MS
  }).length
  const completedSecondAttempts = sessions.filter((item) =>
    item.attempts.some((attempt) => attempt.attemptNumber === 2),
  ).length

  const focusQuestion = resumableQuestion ?? recommendation?.question
  const focusMeta = resumable && resumableQuestion
    ? `${partLabel(resumableQuestion.part)} · ${statusLabel[resumable.status]}`
    : focusQuestion
      ? `${partLabel(focusQuestion.part)} · 一道题完成两次回答`
      : '题库准备完成'

  const startFocus = () => {
    if (resumable && resumableQuestion) {
      onResume(resumable)
      return
    }
    if (focusQuestion) onStart(focusQuestion)
  }

  return (
    <section className="home-page page-stack">
      <header className="home-welcome">
        <div>
          <p className="eyebrow">Today · Speaking practice</p>
          <h1>{accountName}，今天再说好一点。</h1>
          <p>不刷题量。完成一题、听懂反馈，再认真说第二遍。</p>
        </div>
        <button type="button" className="week-pill" onClick={onOpenReview}>
          <CheckCircle2 aria-hidden="true" size={17} />
          本周 {weeklySessions} 题
        </button>
      </header>

      <section className="today-focus-card" aria-labelledby="today-focus-title">
        <div className="today-focus-meta">
          <span className="focus-icon" aria-hidden="true">
            {resumable ? <RotateCcw size={19} /> : <Sparkles size={19} />}
          </span>
          <span>{resumable ? '继续未完成练习' : '今日建议'}</span>
          <small>{focusMeta}</small>
        </div>
        <h2 id="today-focus-title">
          {focusQuestion?.prompt ?? '从季度题库挑一道题开始'}
        </h2>
        <p>
          {resumable
            ? '你的答案和反馈都已保留，直接回到上次停下的位置。'
            : recommendation?.reason ?? '先说自己的版本，AI 只帮你抓最值得改的重点。'}
        </p>
        <div className="today-focus-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!focusQuestion}
            onClick={startFocus}
          >
            {resumable ? '继续完成' : '开始今日一题'}
            <ArrowRight aria-hidden="true" size={18} />
          </button>
          <button type="button" className="secondary-button" onClick={() => onOpenLibrary()}>
            自己挑题
          </button>
        </div>
        <div className="focus-loop" aria-label="本次训练流程">
          <span><b>1</b>先回答</span>
          <i aria-hidden="true" />
          <span><b>2</b>抓重点</span>
          <i aria-hidden="true" />
          <span><b>3</b>再回答</span>
        </div>
      </section>

      <section className="home-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Choose a focus</p>
            <h2>按你今天的状态开始</h2>
          </div>
        </div>
        <div className="practice-mode-grid">
          <button type="button" onClick={() => onOpenLibrary(1)}>
            <span className="mode-icon"><MessageCircleMore size={21} /></span>
            <strong>短回答</strong>
            <small>Part 1 · 热身开口</small>
            <ArrowRight aria-hidden="true" size={17} />
          </button>
          <button type="button" onClick={() => onOpenLibrary(2)}>
            <span className="mode-icon"><BookOpenText size={21} /></span>
            <strong>话题卡</strong>
            <small>Part 2 · 完整展开</small>
            <ArrowRight aria-hidden="true" size={17} />
          </button>
          <button type="button" onClick={() => onOpenLibrary(3)}>
            <span className="mode-icon"><Layers3 size={21} /></span>
            <strong>观点题</strong>
            <small>Part 3 · 解释理由</small>
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>
      </section>

      <section className="learning-snapshot">
        <button type="button" onClick={onOpenReview} aria-label="打开复盘中心">
          <div>
            <p className="eyebrow">Your learning trail</p>
            <h2>练过的内容，正在变成你的话。</h2>
          </div>
          <ArrowRight aria-hidden="true" size={19} />
        </button>
        <div className="snapshot-stats">
          <div><Clock3 aria-hidden="true" size={17} /><strong>{sessions.length}</strong><span>练习记录</span></div>
          <div><RotateCcw aria-hidden="true" size={17} /><strong>{completedSecondAttempts}</strong><span>完成二答</span></div>
          <div><Sparkles aria-hidden="true" size={17} /><strong>{expressionCount}</strong><span>个人语料</span></div>
        </div>
      </section>
    </section>
  )
}
