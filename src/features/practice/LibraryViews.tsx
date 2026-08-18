import { useMemo, useState } from 'react'
import type {
  Question,
  SavedExpression,
  TrainingSession,
} from '../../domain'
import type { AudioFocus } from '../../ports/speech'
import { selectExpressionReviewQueue } from '../../domain/progress'
import { useTtsToggle } from './useTtsToggle'
import {
  formatDate,
  statusLabel,
} from './format'

export function HistoryView({
  questions,
  sessions,
  onOpen,
  onDelete,
}: {
  questions: Question[]
  sessions: TrainingSession[]
  onOpen: (session: TrainingSession) => void
  onDelete: (sessionId: string) => void
}) {
  return (
    <section className="page-stack library-page">
      <div className="page-title">
        <p className="eyebrow">本地训练记录</p>
        <h1>每次练习都留得住</h1>
        <p>练习、答案文本和个人语料默认只保存在这台设备。</p>
      </div>
      {sessions.length ? (
        <div className="history-list">
          {sessions.map((session) => {
            const question = questions.find((item) => item.id === session.questionId)
            if (!question) return null
            return (
              <article key={session.id}>
                <button
                  type="button"
                  className="history-open"
                  onClick={() => onOpen(session)}
                >
                  <span className="part-chip">P{question.part}</span>
                  <span>
                    <small>{question.topic} · {formatDate(session.updatedAt)}</small>
                    <strong>{question.prompt}</strong>
                    <em>{statusLabel[session.status]} · {session.attempts.length}/2 次回答</em>
                  </span>
                  <b aria-hidden="true">›</b>
                </button>
                <button
                  type="button"
                  className="history-delete"
                  aria-label={`删除练习：${question.prompt}`}
                  onClick={() => onDelete(session.id)}
                >
                  删除练习
                </button>
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState title="还没有练习记录" body="从一道 Part 1 小题开始，提交你的第一次真实回答。" />
      )}
    </section>
  )
}

export function ExpressionLibrary({
  expressions,
  audioFocus,
  onUpdate,
  onDelete,
  onReviewed,
  onPractice,
}: {
  expressions: SavedExpression[]
  audioFocus: AudioFocus
  onUpdate: (expressionId: string, text: string, topic: string) => Promise<void>
  onDelete: (expressionId: string) => Promise<void>
  onReviewed: (expressionId: string) => Promise<void>
  onPractice: (questionId: string) => void
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editTopic, setEditTopic] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const { speakingKey, toggle: toggleTts } = useTtsToggle(audioFocus)
  const reviewIds = useMemo(
    () => new Set(selectExpressionReviewQueue(expressions).map((item) => item.id)),
    [expressions],
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleExpressions = expressions.filter((item) =>
    !normalizedQuery ||
    item.text.toLocaleLowerCase().includes(normalizedQuery) ||
    item.topic.toLocaleLowerCase().includes(normalizedQuery),
  )

  const speak = async (expressionId: string, text: string) => {
    setMessage(null)
    try {
      await toggleTts(`expression:${expressionId}:${text}`, text)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '语音播放暂不可用。')
    }
  }

  const run = async (expressionId: string, action: () => Promise<void>) => {
    setMessage(null)
    setBusyId(expressionId)
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '个人表达更新失败。')
    } finally {
      setBusyId(null)
    }
  }

  const beginEdit = (item: SavedExpression) => {
    setEditingId(item.id)
    setEditText(item.text)
    setEditTopic(item.topic)
  }

  const saveEdit = (item: SavedExpression) => {
    void run(item.id, async () => {
      await onUpdate(item.id, editText, editTopic)
      setEditingId(null)
      setMessage('表达已更新并保存在本机。')
    })
  }

  const deleteItem = (item: SavedExpression) => {
    if (!window.confirm('删除这条个人表达？此操作不可撤销。')) return
    void run(item.id, async () => {
      await onDelete(item.id)
      setMessage('表达已删除。')
    })
  }

  const markReviewed = (item: SavedExpression) => {
    void run(item.id, async () => {
      await onReviewed(item.id)
      setMessage('已记录这次听读复习。')
    })
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
        <>
          <div className="expression-review-card">
            <div>
              <p className="eyebrow">轻复习</p>
              <h2>{reviewIds.size ? `有 ${reviewIds.size} 句值得再听读` : '今天的表达已复习'}</h2>
              <p>未听读或超过 7 天的表达会优先标记，不做复杂记忆算法。</p>
            </div>
            <span aria-hidden="true">↻</span>
          </div>
          <label className="expression-search">
            <span>搜索个人表达</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入英文或主题"
            />
          </label>
        </>
      ) : null}
      {expressions.length ? (
        <div className="expression-list">
          {visibleExpressions.map((item) => (
            <article key={item.id}>
              <div className="expression-meta">
                <span>{item.topic}{reviewIds.has(item.id) ? ' · 待听读' : ''}</span>
                <small>{formatDate(item.createdAt)}</small>
              </div>
              {editingId === item.id ? (
                <div className="expression-edit-form">
                  <label>
                    <span>主题</span>
                    <input value={editTopic} maxLength={80} onChange={(event) => setEditTopic(event.target.value)} />
                  </label>
                  <label>
                    <span>表达</span>
                    <textarea value={editText} maxLength={1000} onChange={(event) => setEditText(event.target.value)} />
                  </label>
                  <div>
                    <button type="button" disabled={!editText.trim() || !editTopic.trim() || busyId === item.id} onClick={() => saveEdit(item)}>
                      保存修改
                    </button>
                    <button type="button" className="expression-muted-action" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p>{item.text}</p>
                  <small className="review-count">
                    已听读 {item.reviewCount ?? 0} 次{item.lastReviewedAt ? ` · 最近 ${formatDate(item.lastReviewedAt)}` : ''}
                  </small>
                  <div className="expression-item-actions">
                    <button
                      type="button"
                      onClick={() => void speak(item.id, item.text)}
                    >
                      {speakingKey === `expression:${item.id}:${item.text}` ? '■ 停止' : '▶ 试听'}
                    </button>
                    <button type="button" disabled={busyId === item.id} onClick={() => markReviewed(item)}>✓ 已听读</button>
                    <button type="button" onClick={() => onPractice(item.questionId)}>用原题再练</button>
                    <button type="button" onClick={() => beginEdit(item)}>编辑</button>
                    <button type="button" className="expression-delete-action" disabled={busyId === item.id} onClick={() => deleteItem(item)}>删除</button>
                  </div>
                </>
              )}
            </article>
          ))}
          {visibleExpressions.length === 0 ? (
            <EmptyState title="没有找到匹配表达" body="换一个英文关键词或主题试试。" />
          ) : null}
        </div>
      ) : (
        <EmptyState title="还没有保存表达" body="完成两次回答后，保存一句你自己真正想再说的话。" />
      )}
    </section>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">=＾● ⋏ ●＾=</span>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  )
}
