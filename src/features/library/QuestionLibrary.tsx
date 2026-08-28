import { useState } from 'react'
import {
  ArrowRight,
  Search,
  SearchX,
  Shuffle,
  Upload,
} from 'lucide-react'
import {
  filterPracticeQuestions,
  pickRandomQuestion,
  type QuestionDoneFilter,
} from '../../domain/questionSelection'
import type { Question } from '../../domain/models'
import { EmptyState } from '../../app/components/EmptyState'

export function QuestionLibrary({
  initialPart,
  questions,
  bankMeta,
  questionDoneById,
  onStart,
  onQuestionDoneChange,
  onImport,
}: {
  initialPart: 1 | 2 | 3
  questions: Question[]
  bankMeta: { seasonLabel: string; counts: { 1: number; 2: number; 3: number } }
  questionDoneById: Record<string, boolean>
  onStart: (question: Question) => void
  onQuestionDoneChange: (questionId: string, isDone: boolean) => void
  onImport: () => void
}) {
  const [part, setPart] = useState<1 | 2 | 3>(initialPart)
  const [query, setQuery] = useState('')
  const [newOnly, setNewOnly] = useState(false)
  const [category, setCategory] = useState('all')
  const [topic, setTopic] = useState('all')
  const [doneFilter, setDoneFilter] = useState<QuestionDoneFilter>('all')
  const [visibleLimit, setVisibleLimit] = useState(20)
  const [showFollowUpsFor, setShowFollowUpsFor] = useState<string | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const partQuestions = questions.filter((question) => question.part === part)
  const categories = Array.from(
    new Set(partQuestions.map((question) => question.category ?? '导入题目')),
  )
  const topics = Array.from(new Set(partQuestions.map((question) => question.topic)))
    .sort((left, right) => left.localeCompare(right))
  const visiblePartQuestions = filterPracticeQuestions(
    questions,
    questionDoneById,
    {
      part,
      topic,
      done: doneFilter,
      query: normalizedQuery,
      category,
      newOnly,
    },
  )
  const questionById = new Map(questions.map((question) => [question.id, question]))
  const visibleQuestions = visiblePartQuestions.slice(0, visibleLimit)
  const groups = groupQuestions(visibleQuestions)
  const groupTotals = new Map(
    groupQuestions(visiblePartQuestions).map((group) => [group.label, group.questions.length]),
  )

  const pickRandom = () => {
    const question = pickRandomQuestion(visiblePartQuestions)
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
              setTopic('all')
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
        <label className="question-topic-select">
          <span>主题</span>
          <select
            aria-label="按主题筛选"
            value={topic}
            onChange={(event) => { setTopic(event.target.value); setVisibleLimit(20) }}
          >
            <option value="all">全部主题</option>
            {topics.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <div className="question-filter-chips" role="group" aria-label="题目分类">
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
        <div className="question-filter-chips" role="group" aria-label="练习状态">
          {([
            ['all', '全部状态'],
            ['undone', '仅未做'],
            ['done', '仅已做'],
          ] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={doneFilter === value ? 'active' : ''}
              aria-pressed={doneFilter === value}
              onClick={() => { setDoneFilter(value); setVisibleLimit(20) }}
            >
              {label}
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
                  isDone={questionDoneById[question.id] === true}
                  showFollowUps={showFollowUpsFor === question.id}
                  onToggleFollowUps={toggleFollowUps}
                  onStart={onStart}
                  onToggleDone={onQuestionDoneChange}
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
  isDone,
  showFollowUps,
  onToggleFollowUps,
  onStart,
  onToggleDone,
}: {
  question: Question
  index: number
  questionById: Map<string, Question>
  isDone: boolean
  showFollowUps: boolean
  onToggleFollowUps: (questionId: string) => void
  onStart: (question: Question) => void
  onToggleDone: (questionId: string, isDone: boolean) => void
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
            <QuestionStatus isNew={question.isNew} isDone={isDone} />
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
        <button
          type="button"
          className="question-row-done"
          aria-pressed={isDone}
          onClick={() => onToggleDone(question.id, !isDone)}
        >
          {isDone ? '标为未做' : '标为已做'}
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

function QuestionStatus({
  isNew,
  isDone,
}: {
  isNew: boolean | undefined
  isDone: boolean
}) {
  const doneLabel = isDone ? <b className="done-tag">已做</b> : <span>未做</span>
  if (isNew === true) return <>{doneLabel} · <b className="new-tag">新题</b></>
  if (isNew === false) return <>{doneLabel} · <span>保留题</span></>
  return <>{doneLabel} · <span>自定义</span></>
}

function EmptyQuestionResult({
  query,
  newOnly,
}: {
  query: string
  newOnly: boolean
}) {
  return (
    <EmptyState
      icon={<SearchX aria-hidden="true" size={28} />}
      title="没有匹配的题目"
      body={`${query ? `没有找到包含“${query}”的题目。` : ''}${newOnly ? '当前筛选只显示当季新题。' : ''}可以清除筛选，或随机抽一道题开始。`}
    />
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
