import { useMemo, useState } from 'react'
import { Brain, Check, ChevronRight, Play, Square } from 'lucide-react'
import type {
  IeltsPart,
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
import { EmptyState } from '../../app/components/EmptyState'

export { EmptyState } from '../../app/components/EmptyState'

export function LearnerMemoryPanel({
  sessions,
  onUpdateFactPart,
  onDeleteFact,
}: {
  sessions: TrainingSession[]
  onUpdateFactPart?: (sessionId: string, factId: string, sourcePart: IeltsPart | null) => Promise<void>
  onDeleteFact?: (sessionId: string, factId: string) => Promise<void>
}) {
  const [selectedPart, setSelectedPart] = useState<IeltsPart | 'all' | 'unclassified'>(1)
  const [factBusyId, setFactBusyId] = useState<string | null>(null)
  const [factMessage, setFactMessage] = useState<string | null>(null)
  const recent = sessions
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12)
  const visibleRecent = recent.filter((session) =>
    selectedPart === 'all'
      ? true
      : selectedPart === 'unclassified'
        ? sessionPart(session) === null
        : sessionPart(session) === selectedPart,
  )
  const problemThemes = [...new Set(visibleRecent.flatMap((item) => item.aiFeedback?.problems ?? []))].slice(0, 2)
  const strengths = [...new Set(visibleRecent.flatMap((item) => item.aiFeedback?.strengths ?? []))].slice(0, 2)
  const memoryFacts = sessions
    .flatMap((session) => (session.confirmedMemoryFacts ?? []).map((fact) => ({ sessionId: session.id, fact })))
    .filter((item, index, all) =>
      all.findIndex((candidate) => candidate.fact.content === item.fact.content) === index,
    )
    .filter((item) =>
      selectedPart === 'all'
        ? true
        : selectedPart === 'unclassified'
          ? item.fact.sourcePart === null
          : item.fact.sourcePart === selectedPart,
    )
    .slice(0, 8)

  const reclassifyFact = async (
    sessionId: string,
    factId: string,
    sourcePart: IeltsPart | null,
  ) => {
    if (!onUpdateFactPart || factBusyId !== null) return
    setFactBusyId(factId)
    setFactMessage(null)
    try {
      await onUpdateFactPart(sessionId, factId, sourcePart)
      setFactMessage('长期记忆归类已更新。')
    } catch (error) {
      setFactMessage(error instanceof Error ? error.message : '长期记忆归类保存失败。')
    } finally {
      setFactBusyId(null)
    }
  }

  const deleteFact = async (sessionId: string, factId: string, content: string) => {
    if (!onDeleteFact || factBusyId !== null) return
    if (!window.confirm(`确定删除这条长期记忆吗？\n${content}`)) return
    setFactBusyId(factId)
    setFactMessage(null)
    try {
      await onDeleteFact(sessionId, factId)
      setFactMessage('长期记忆已删除。')
    } catch (error) {
      setFactMessage(error instanceof Error ? error.message : '长期记忆删除失败。')
    } finally {
      setFactBusyId(null)
    }
  }

  return (
    <details className="learner-memory-details">
      <summary>点开，看看自己走了多远</summary>
      <section className="learner-memory-panel">
        <span className="memory-icon"><Brain aria-hidden="true" size={21} /></span>
        <div>
          <p className="eyebrow">Your speaking trail</p>
          <h2>每一次开口，都被悄悄记住</h2>
          <p>练过的每一题都在告诉你：哪里已经稳了，哪里值得再来一次。</p>
          <div className="question-filter-chips" role="group" aria-label="长期记忆 Part 筛选">
            <button type="button" className={selectedPart === 'all' ? 'active' : ''} aria-pressed={selectedPart === 'all'} onClick={() => setSelectedPart('all')}>全部记忆</button>
            {([1, 2, 3] as const).map((part) => (
              <button key={part} type="button" className={selectedPart === part ? 'active' : ''} aria-pressed={selectedPart === part} onClick={() => setSelectedPart(part)}>Part {part}</button>
            ))}
            <button type="button" className={selectedPart === 'unclassified' ? 'active' : ''} aria-pressed={selectedPart === 'unclassified'} onClick={() => setSelectedPart('unclassified')}>未分类</button>
          </div>
          {factMessage ? <small role="status">{factMessage}</small> : null}
          {memoryFacts.length ? (
            <div className="memory-signals">
              {memoryFacts.map(({ sessionId, fact }) => (
                <article key={fact.id} className="memory-fact-item">
                  <span>P{fact.sourcePart ?? '未分类'} · {fact.content}</span>
                  {onUpdateFactPart || onDeleteFact ? (
                    <div className="question-filter-chips" role="group" aria-label={`管理长期记忆：${fact.content}`}>
                      {onUpdateFactPart ? (
                        <>
                          {([1, 2, 3] as const).map((part) => (
                            <button
                              key={part}
                              type="button"
                              className={fact.sourcePart === part ? 'active' : ''}
                              aria-pressed={fact.sourcePart === part}
                              disabled={factBusyId !== null}
                              onClick={() => void reclassifyFact(sessionId, fact.id, part)}
                            >
                              P{part}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={fact.sourcePart === null ? 'active' : ''}
                            aria-pressed={fact.sourcePart === null}
                            disabled={factBusyId !== null}
                            onClick={() => void reclassifyFact(sessionId, fact.id, null)}
                          >
                            未分类
                          </button>
                        </>
                      ) : null}
                      {onDeleteFact ? (
                        <button
                          type="button"
                          className="secondary-button compact"
                          disabled={factBusyId !== null}
                          onClick={() => void deleteFact(sessionId, fact.id, fact.content)}
                        >
                          删除
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
          {problemThemes.length || strengths.length ? (
            <div className="memory-signals">
              {problemThemes.map((item) => <span key={`problem:${item}`}>继续练 · {item}</span>)}
              {strengths.map((item) => <span key={`strength:${item}`}>做得好 · {item}</span>)}
            </div>
          ) : (
            <small>再练几题，这里会长出属于你的曲线。</small>
          )}
        </div>
      </section>
    </details>
  )
}

function sessionPart(session: TrainingSession): IeltsPart | null {
  if (session.part !== null) return session.part
  const match = /^p([123])-/u.exec(session.questionId)
  return match === null ? null : Number(match[1]) as IeltsPart
}

export function HistoryView({
  questions,
  sessions,
  onOpen,
  onDelete,
  onPractice,
}: {
  questions: Question[]
  sessions: TrainingSession[]
  onOpen: (session: TrainingSession) => void
  onDelete: (sessionId: string) => void
  onPractice?: (questionId: string) => void
}) {
  return (
    <section className="page-stack library-page">
      <div className="page-title">
        <p className="eyebrow">Learning trail</p>
        <h1>第二遍，看得见的进步</h1>
        <p>这里存着你每次开口的样子，和两次之间的那一步。</p>
      </div>
      {sessions.length ? (
        <div className="history-list">
          {sessions.map((session) => {
            const question = questions.find((item) => item.id === session.questionId)
            if (!question) return null
            const firstAttempt = session.attempts.find((item) => item.attemptNumber === 1)
            const secondAttempt = session.attempts.find((item) => item.attemptNumber === 2)
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
                    {firstAttempt ? (
                      <span className="history-progress">
                        <span>一答 {firstAttempt.metrics.wordCount} 词</span>
                        {secondAttempt ? <span>二答 {secondAttempt.metrics.wordCount} 词</span> : <span>等待二答</span>}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
                <button
                  type="button"
                  className="history-delete"
                  aria-label={`删除练习：${question.prompt}`}
                  onClick={() => onDelete(session.id)}
                >
                  删除练习
                </button>
                {onPractice ? (
                  <button
                    type="button"
                    className="history-practice"
                    onClick={() => onPractice(session.questionId)}
                  >
                    再练一次
                  </button>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState title="这里还安安静静的" body="从一道 Part 1 小题开始吧，第一句哪怕磕磕巴巴也没关系。" />
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
  onUpdate: (expressionId: string, text: string, topic: string, sourcePart: IeltsPart | null) => Promise<void>
  onDelete: (expressionId: string) => Promise<void>
  onReviewed: (expressionId: string) => Promise<void>
  onPractice: (questionId: string) => void
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editTopic, setEditTopic] = useState('')
  const [editSourcePart, setEditSourcePart] = useState<IeltsPart | null>(null)
  const [selectedPart, setSelectedPart] = useState<IeltsPart | 'unclassified'>(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { speakingKey, toggle: toggleTts } = useTtsToggle(audioFocus)
  const reviewIds = useMemo(
    () => new Set(selectExpressionReviewQueue(expressions).map((item) => item.id)),
    [expressions],
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleExpressions = expressions.filter((item) =>
    (selectedPart === 'unclassified'
      ? item.sourcePart === null
      : item.sourcePart === selectedPart) &&
    (!normalizedQuery ||
      item.text.toLocaleLowerCase().includes(normalizedQuery) ||
      item.topic.toLocaleLowerCase().includes(normalizedQuery)),
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
    setEditSourcePart(item.sourcePart)
  }

  const saveEdit = (item: SavedExpression) => {
    void run(item.id, async () => {
      await onUpdate(item.id, editText, editTopic, editSourcePart)
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
        <p>只留下你认可、下次还敢用的句子。</p>
      </div>
      {message ? <div className="notice">{message}</div> : null}
      {expressions.length ? (
        <>
          <div className="expression-review-card">
            <div>
              <p className="eyebrow">轻复习</p>
              <h2>{reviewIds.size ? `有 ${reviewIds.size} 句在等你回头` : '今天的句子都已听过一遍'}</h2>
              <p>隔了些日子的句子会被轻轻顶到前面——没有算法，只有提醒。</p>
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
          <div className="question-filter-chips" role="group" aria-label="个人语料 Part 筛选">
            {([1, 2, 3] as const).map((part) => (
              <button key={part} type="button" className={selectedPart === part ? 'active' : ''} aria-pressed={selectedPart === part} onClick={() => setSelectedPart(part)}>Part {part}</button>
            ))}
            <button type="button" className={selectedPart === 'unclassified' ? 'active' : ''} aria-pressed={selectedPart === 'unclassified'} onClick={() => setSelectedPart('unclassified')}>未分类</button>
          </div>
        </>
      ) : null}
      {expressions.length ? (
        <div className="expression-list">
          {visibleExpressions.map((item) => (
            <article key={item.id}>
              <div className="expression-meta">
                <span>P{item.sourcePart ?? '未分类'} · {item.topic}{reviewIds.has(item.id) ? ' · 待听读' : ''}</span>
                <small>{formatDate(item.createdAt)}</small>
              </div>
              {editingId === item.id ? (
                <div className="expression-edit-form">
                  <fieldset>
                    <legend>归属 Part</legend>
                    <div className="question-filter-chips">
                      {([1, 2, 3] as const).map((part) => (
                        <button key={part} type="button" className={editSourcePart === part ? 'active' : ''} aria-pressed={editSourcePart === part} onClick={() => setEditSourcePart(part)}>Part {part}</button>
                      ))}
                      <button type="button" className={editSourcePart === null ? 'active' : ''} aria-pressed={editSourcePart === null} onClick={() => setEditSourcePart(null)}>未分类</button>
                    </div>
                  </fieldset>
                  <label>
                    <span>主题</span>
                    <input value={editTopic} maxLength={80} onChange={(event) => setEditTopic(event.target.value)} />
                  </label>
                  <label>
                    <span>表达</span>
                    <textarea value={editText} maxLength={1000} onChange={(event) => setEditText(event.target.value)} />
                  </label>
                  <div>
                    <button type="button" disabled={!editText.trim() || !editTopic.trim() || editSourcePart === null || busyId === item.id} onClick={() => saveEdit(item)}>
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
                      {speakingKey === `expression:${item.id}:${item.text}` ? <><Square aria-hidden="true" size={13} fill="currentColor" /> 停止</> : <><Play aria-hidden="true" size={14} fill="currentColor" /> 试听</>}
                    </button>
                    <button type="button" disabled={busyId === item.id} onClick={() => markReviewed(item)}><Check aria-hidden="true" size={14} /> 已听读</button>
                    <button type="button" onClick={() => onPractice(item.questionId)}>用原题再练</button>
                    <button type="button" onClick={() => beginEdit(item)}>编辑</button>
                    <button type="button" className="expression-delete-action" disabled={busyId === item.id} onClick={() => deleteItem(item)}>删除</button>
                  </div>
                </>
              )}
            </article>
          ))}
          {visibleExpressions.length === 0 ? (
            <EmptyState title="没有找到匹配表达" body="换一个英文关键词，或换个主题试试。" />
          ) : null}
        </div>
      ) : (
        <EmptyState title="还没有留下句子" body="完成两次回答后，把一句你自己真正想再说的话留在这里。" />
      )}
    </section>
  )
}
