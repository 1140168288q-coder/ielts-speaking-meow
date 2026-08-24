import { useMemo, useState } from 'react'
import {
  Archive,
  Check,
  Lightbulb,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import type {
  PersonalMaterial,
  PersonalMaterialKind,
} from '../../domain/personalMaterials'
import type {
  PersonalMaterialCandidate,
  PersonalMaterialInput,
} from '../../application/personalMaterialService'
import { EmptyState } from './LibraryViews'
import { formatDate } from './format'

const kindLabels: Record<PersonalMaterialKind, string> = {
  person: '人物',
  place: '地点',
  experience: '经历',
  object: '物品',
  opinion: '观点',
}

const kindOptions = Object.entries(kindLabels) as Array<
  [PersonalMaterialKind, string]
>

type StatusFilter = 'active' | 'archived'

export interface PersonalMaterialLibraryProps {
  materials: PersonalMaterial[]
  candidates?: PersonalMaterialCandidate[]
  onCreate: (input: PersonalMaterialInput) => Promise<void>
  onUpdate: (
    materialId: string,
    input: PersonalMaterialInput,
  ) => Promise<void>
  onArchive: (materialId: string) => Promise<void>
  onRestore: (materialId: string) => Promise<void>
  onDelete: (materialId: string) => Promise<void>
  onConfirmCandidate?: (
    candidate: PersonalMaterialCandidate,
  ) => Promise<void>
  onDismissCandidate?: (candidateId: string) => void
}

export function PersonalMaterialLibrary({
  materials,
  candidates = [],
  onCreate,
  onUpdate,
  onArchive,
  onRestore,
  onDelete,
  onConfirmCandidate,
  onDismissCandidate,
}: PersonalMaterialLibraryProps) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<PersonalMaterialKind | 'all'>('all')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const visibleMaterials = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return materials.filter((material) => {
      const statusMatches =
        status === 'archived'
          ? material.status === 'archived'
          : material.status !== 'archived'
      const kindMatches = kind === 'all' || material.kind === kind
      const textMatches =
        normalizedQuery.length === 0 ||
        [material.title, material.content, ...material.topicTags]
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      return statusMatches && kindMatches && textMatches
    })
  }, [kind, materials, query, status])

  const run = async (
    itemId: string,
    action: () => Promise<void>,
    successMessage: string,
  ) => {
    setMessage(null)
    setBusyId(itemId)
    try {
      await action()
      setMessage(successMessage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '个人素材更新失败。')
    } finally {
      setBusyId(null)
    }
  }

  const confirmArchive = (material: PersonalMaterial) => {
    if (!window.confirm('归档后不会再用于日常素材推荐，仍可在“已归档”中恢复。')) {
      return
    }
    void run(
      material.id,
      () => onArchive(material.id),
      '素材已归档。',
    )
  }

  const confirmDelete = (material: PersonalMaterial) => {
    if (!window.confirm('删除这条个人素材？删除后将不再用于个性化训练。')) {
      return
    }
    void run(material.id, () => onDelete(material.id), '素材已删除。')
  }

  return (
    <section className="page-stack library-page">
      <div className="page-title">
        <p className="eyebrow">个人素材</p>
        <h1>积累你真正经历过的内容</h1>
        <p>
          素材库保存“说什么”的人物、地点、经历、物品和观点；个人语料保存
          “怎么说”的英文表达，两者独立管理。
        </p>
      </div>

      <div className="expression-review-card">
        <div>
          <p className="eyebrow">内容记忆</p>
          <h2>先有自己的故事，再练自然表达</h2>
          <p>训练时可按题目主题调用素材，但不会把整段答案自动收进来。</p>
        </div>
        <span aria-hidden="true"><Lightbulb size={21} /></span>
      </div>

      {message ? <div className="notice" role="status">{message}</div> : null}

      {candidates.length > 0 ? (
        <section aria-labelledby="material-candidates-title">
          <div className="question-group-heading">
            <span id="material-candidates-title">待你确认的候选素材</span>
            <small>{candidates.length} 条</small>
          </div>
          <div className="expression-list">
            {candidates.map((candidate) => (
              <article key={candidate.candidateId}>
                <div className="expression-meta">
                  <span>AI 候选 · {kindLabels[candidate.kind]}</span>
                  <small>尚未保存</small>
                </div>
                <h2>{candidate.title}</h2>
                <p>{candidate.content}</p>
                <div className="expression-item-actions">
                  <button
                    type="button"
                    disabled={busyId === candidate.candidateId || onConfirmCandidate === undefined}
                    onClick={() => void run(
                      candidate.candidateId,
                      async () => {
                        if (onConfirmCandidate === undefined) return
                        await onConfirmCandidate(candidate)
                      },
                      '候选素材已确认收录。',
                    )}
                  >
                    <Check size={15} aria-hidden="true" /> 确认收录
                  </button>
                  <button
                    type="button"
                    className="expression-muted-action"
                    disabled={onDismissCandidate === undefined}
                    onClick={() => onDismissCandidate?.(candidate.candidateId)}
                  >
                    <X size={15} aria-hidden="true" /> 忽略
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="question-filter-panel">
        <label className="question-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">搜索个人素材</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、内容或主题"
          />
        </label>
        <div className="question-filter-chips" role="group" aria-label="素材类型筛选">
          <button
            type="button"
            className={kind === 'all' ? 'active' : ''}
            aria-pressed={kind === 'all'}
            onClick={() => setKind('all')}
          >
            全部类型
          </button>
          {kindOptions.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={kind === value ? 'active' : ''}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="question-filter-actions">
          <button
            type="button"
            className={`filter-toggle${status === 'active' ? ' active' : ''}`}
            aria-pressed={status === 'active'}
            onClick={() => setStatus('active')}
          >
            使用中
          </button>
          <button
            type="button"
            className={`filter-toggle${status === 'archived' ? ' active' : ''}`}
            aria-pressed={status === 'archived'}
            onClick={() => setStatus('archived')}
          >
            已归档
          </button>
          <span>{visibleMaterials.length} 条素材</span>
        </div>
      </div>

      {creating ? (
        <MaterialForm
          title="新建个人素材"
          submitLabel="保存素材"
          busy={busyId === 'create'}
          onCancel={() => setCreating(false)}
          onSubmit={(input) => void run(
            'create',
            async () => {
              await onCreate(input)
              setCreating(false)
            },
            '素材已保存。',
          )}
        />
      ) : (
        <button type="button" className="primary-button" onClick={() => setCreating(true)}>
          <Plus size={17} aria-hidden="true" /> 新建素材
        </button>
      )}

      {visibleMaterials.length > 0 ? (
        <div className="expression-list">
          {visibleMaterials.map((material) => (
            <article key={material.id}>
              {editingId === material.id ? (
                <MaterialForm
                  title="编辑个人素材"
                  initialValue={material}
                  submitLabel="保存修改"
                  busy={busyId === material.id}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(input) => void run(
                    material.id,
                    async () => {
                      await onUpdate(material.id, input)
                      setEditingId(null)
                    },
                    '素材已更新。',
                  )}
                />
              ) : (
                <>
                  <div className="expression-meta">
                    <span>{kindLabels[material.kind]} · {material.topicTags.join(' · ') || '未添加主题'}</span>
                    <small>{material.status === 'archived' ? '已归档' : formatDate(material.updatedAt)}</small>
                  </div>
                  <h2>{material.title}</h2>
                  <p>{material.content}</p>
                  <div className="expression-item-actions">
                    <button type="button" onClick={() => setEditingId(material.id)}>
                      <Pencil size={15} aria-hidden="true" /> 编辑
                    </button>
                    {material.status === 'archived' ? (
                      <button
                        type="button"
                        disabled={busyId === material.id}
                        onClick={() => void run(
                          material.id,
                          () => onRestore(material.id),
                          '素材已恢复使用。',
                        )}
                      >
                        <RotateCcw size={15} aria-hidden="true" /> 恢复
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === material.id}
                        onClick={() => confirmArchive(material)}
                      >
                        <Archive size={15} aria-hidden="true" /> 归档
                      </button>
                    )}
                    <button
                      type="button"
                      className="expression-delete-action"
                      disabled={busyId === material.id}
                      onClick={() => confirmDelete(material)}
                    >
                      <Trash2 size={15} aria-hidden="true" /> 删除
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title={query.trim() || kind !== 'all' ? '没有找到匹配素材' : status === 'archived' ? '还没有归档素材' : '还没有个人素材'}
          body={status === 'archived' ? '归档后的素材会出现在这里，并可随时恢复。' : '从一个熟悉的人、地点或经历开始，写下以后答题能用的真实内容。'}
        />
      )}
    </section>
  )
}

function MaterialForm({
  title,
  initialValue,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  title: string
  initialValue?: PersonalMaterial
  submitLabel: string
  busy: boolean
  onSubmit: (input: PersonalMaterialInput) => void
  onCancel: () => void
}) {
  const [materialTitle, setMaterialTitle] = useState(initialValue?.title ?? '')
  const [content, setContent] = useState(initialValue?.content ?? '')
  const [kind, setKind] = useState<PersonalMaterialKind>(initialValue?.kind ?? 'experience')
  const [tags, setTags] = useState(initialValue?.topicTags.join('，') ?? '')
  const valid = materialTitle.trim().length > 0 && content.trim().length > 0

  return (
    <form
      className="expression-edit-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid) return
        onSubmit({
          title: materialTitle,
          content,
          kind,
          topicTags: parseTags(tags),
          questionIds: initialValue?.questionIds ?? [],
          sourceSessionId: initialValue?.sourceSessionId ?? null,
        })
      }}
    >
      <h2>{title}</h2>
      <fieldset>
        <legend>素材类型</legend>
        <div className="question-filter-chips">
          {kindOptions.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={kind === value ? 'active' : ''}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        <span>标题</span>
        <input
          value={materialTitle}
          maxLength={160}
          onChange={(event) => setMaterialTitle(event.target.value)}
          placeholder="例如：教我做饭的奶奶"
        />
      </label>
      <label>
        <span>内容</span>
        <textarea
          value={content}
          maxLength={5000}
          onChange={(event) => setContent(event.target.value)}
          placeholder="记录事实、细节和你的感受，不必先写成英文答案。"
        />
      </label>
      <label>
        <span>主题标签</span>
        <input
          value={tags}
          maxLength={400}
          onChange={(event) => setTags(event.target.value)}
          placeholder="家庭，烹饪，童年"
        />
      </label>
      <div>
        <button type="submit" disabled={!valid || busy}>
          <Check size={15} aria-hidden="true" /> {submitLabel}
        </button>
        <button type="button" className="expression-muted-action" onClick={onCancel}>
          <X size={15} aria-hidden="true" /> 取消
        </button>
      </div>
    </form>
  )
}

function parseTags(value: string): string[] {
  return [...new Set(
    value
      .split(/[,，]/u)
      .map((tag) => tag.trim())
      .filter(Boolean),
  )]
}
