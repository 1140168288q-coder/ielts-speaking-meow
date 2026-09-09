import { useMemo, useRef, useState } from 'react'
import { userKnowledgeEntrySchema, type UserKnowledgeEntry, type UserKnowledgeSource } from '../../domain/userKnowledge'
import type { UserKnowledgeCandidate, UserKnowledgeOrganizer } from '../../ports/ai'
import type { UserKnowledgeStorage } from '../../ports/userKnowledge'
import type { UserKnowledgeDraftWithExtraction, UserKnowledgeService } from '../../application/userKnowledgeService'

const KNOWLEDGE_ACCEPT = [
  '.txt', '.md', '.docx', '.pdf', '.jpg', '.jpeg', '.png',
  'text/plain', 'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf', 'image/jpeg', 'image/png',
].join(',')

interface CandidateRow {
  id: string
  selected: boolean
  candidate: UserKnowledgeCandidate
}

export function KnowledgeLibrary({
  service,
  organizer,
  storage,
  sources,
  entries,
  ownerId,
  onChanged,
}: {
  service: UserKnowledgeService
  organizer: UserKnowledgeOrganizer
  storage: UserKnowledgeStorage
  sources: UserKnowledgeSource[]
  entries: UserKnowledgeEntry[]
  ownerId: string
  onChanged: () => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<UserKnowledgeDraftWithExtraction | null>(null)
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedSource, setExpandedSource] = useState<string | null>(null)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [editingEntry, setEditingEntry] = useState<{
    title: string
    body: string
    topics: string
    tags: string
  } | null>(null)

  const draftTextStats = useMemo(() => {
    if (draft === null) return null
    return {
      characters: draft.extraction.text.length,
      pages: draft.extraction.pages.length,
      chunks: draft.chunks.length,
    }
  }, [draft])

  const selectFile = async (file: File) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    setCandidates([])
    try {
      const nextDraft = await service.prepare(file)
      const duplicate = sources.find((source) => source.sourceSha256 === nextDraft.source.sourceSha256)
      setDraft(nextDraft)
      if (duplicate) {
        setMessage(`这份文件已导入过（${duplicate.title}）。你仍可整理成新版本，确认后会覆盖同源条目。`)
      } else {
        setMessage('文件已在本机提取。请点击 AI 整理，完成预览确认后才会写入知识库。')
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '文件提取失败。')
    } finally {
      setBusy(false)
    }
  }

  const organize = async () => {
    if (draft === null) return
    setBusy(true)
    setError(null)
    try {
      const result = organizer.isConfigured()
        ? await service.organize(draft, organizer)
        : service.localCandidates(draft)
      setCandidates(result.map((candidate, index) => ({
        id: `candidate-${index + 1}`,
        selected: true,
        candidate,
      })))
      setMessage(organizer.isConfigured()
        ? `DeepSeek 返回 ${result.length} 条候选。逐条检查后再保存。`
        : `当前离线，已生成 ${result.length} 条本地草稿。检查后可直接保存，稍后仍可编辑。`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'AI 整理失败；原始提取仍保留在当前草稿。')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (draft === null) return
    const selected = candidates.filter((row) => row.selected).map((row) => row.candidate)
    if (selected.length === 0) {
      setError('请至少保留一条知识条目。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await service.commit(draft, selected)
      await onChanged()
      setMessage(`已保存「${result.source.title}」和 ${result.entries.length} 条知识。它们现在会参与本地检索。`)
      setDraft(null)
      setCandidates([])
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '知识库保存失败。')
    } finally {
      setBusy(false)
    }
  }

  const updateCandidate = (id: string, patch: Partial<UserKnowledgeCandidate>) => {
    setCandidates((rows) => rows.map((row) => row.id === id
      ? { ...row, candidate: { ...row.candidate, ...patch } }
      : row))
  }

  const toggleEntry = async (entry: UserKnowledgeEntry) => {
    const now = new Date().toISOString()
    await storage.updateUserKnowledgeEntry({ ...entry, enabled: !entry.enabled, updatedAt: now })
    const source = sources.find((item) => item.id === entry.sourceId)
    if (source !== undefined && source.deletedAt === null) {
      const nextCount = Math.max(0, source.entryCount + (entry.enabled ? -1 : 1))
      await storage.updateUserKnowledgeSource({
        ...source,
        entryCount: nextCount,
        status: nextCount > 0 ? 'ready' : 'disabled',
        updatedAt: now,
      })
    }
    await onChanged()
  }

  const beginEditEntry = (entry: UserKnowledgeEntry) => {
    setEditingEntryId(entry.id)
    setEditingEntry({
      title: entry.title,
      body: entry.body,
      topics: entry.topics.join('、'),
      tags: entry.tags.join('、'),
    })
    setError(null)
  }

  const saveEntryEdit = async (entry: UserKnowledgeEntry) => {
    if (editingEntry === null || editingEntryId !== entry.id) return
    try {
      const now = new Date().toISOString()
      const updated = userKnowledgeEntrySchema.parse({
        ...entry,
        title: editingEntry.title,
        body: editingEntry.body,
        topics: splitLabels(editingEntry.topics, 20),
        tags: splitLabels(editingEntry.tags, 20),
        updatedAt: now,
      })
      await storage.updateUserKnowledgeEntry(updated)
      setEditingEntryId(null)
      setEditingEntry(null)
      await onChanged()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '知识条目保存失败。')
    }
  }

  const deleteEntry = async (entry: UserKnowledgeEntry) => {
    if (!window.confirm(`删除知识条目「${entry.title}」？`)) return
    await storage.deleteUserKnowledgeEntry(entry.id, ownerId, new Date().toISOString())
    await onChanged()
  }

  const deleteSource = async (source: UserKnowledgeSource) => {
    if (!window.confirm(`删除来源「${source.title}」及其 ${source.entryCount} 条知识？`)) return
    await storage.deleteUserKnowledgeSource(source.id, ownerId, new Date().toISOString())
    await onChanged()
  }

  return (
    <section className="page-stack knowledge-library-page">
      <div className="question-library-heading">
        <div>
          <p className="eyebrow">Private teaching RAG</p>
          <h1>我的知识库</h1>
          <p>导入自己的教学资料或表达资料。它与“我的真实素材”分开保存，只有你确认后的条目才会参与自然提升版。</p>
        </div>
        <button className="primary-button compact" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          导入知识
        </button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept={KNOWLEDGE_ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void selectFile(file)
            event.target.value = ''
          }}
        />
      </div>

      {message ? <p className="notice info" role="status">{message}</p> : null}
      {error ? <p className="notice error" role="alert">{error}</p> : null}

      {draft ? (
        <section className="card knowledge-draft-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">本机草稿</p>
              <h2>{draft.source.fileName}</h2>
              <p>{draft.source.format.toUpperCase()} · {draftTextStats?.characters.toLocaleString()} 字 · {draftTextStats?.pages} 页 · {draftTextStats?.chunks} 个分块</p>
            </div>
            <button type="button" className="secondary-button compact" onClick={() => { setDraft(null); setCandidates([]) }}>
              取消草稿
            </button>
          </div>
          {draft.extraction.warnings.length > 0 ? (
            <ul className="warning-list">{draft.extraction.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          ) : null}
          <p className="privacy-note">原始文件只保存在本机备份中；发送给 DeepSeek 的是带页码和章节的文本分块，不包含账号密钥。</p>
          {candidates.length === 0 ? (
            <button type="button" className="secondary-button" onClick={() => void organize()} disabled={busy}>
              {organizer.isConfigured() ? '用 DeepSeek 整理为知识条目' : '离线生成本地草稿'}
            </button>
          ) : (
            <>
              <div className="knowledge-candidate-list">
                {candidates.map((row) => (
                  <article className="knowledge-candidate" key={row.id}>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={row.selected} onChange={(event) => setCandidates((current) => current.map((item) => item.id === row.id ? { ...item, selected: event.target.checked } : item))} />
                      <span>加入知识库</span>
                    </label>
                    <label><span>标题</span><input value={row.candidate.title} maxLength={160} onChange={(event) => updateCandidate(row.id, { title: event.target.value })} /></label>
                    <label><span>内容</span><textarea rows={4} value={row.candidate.body} maxLength={2_000} onChange={(event) => updateCandidate(row.id, { body: event.target.value })} /></label>
                    <div className="inline-fields">
                      <label><span>Part</span><select value={String(row.candidate.part)} onChange={(event) => updateCandidate(row.id, { part: event.target.value === 'all' ? 'all' : Number(event.target.value) as 1 | 2 | 3 })}><option value="all">全部</option><option value="1">Part 1</option><option value="2">Part 2</option><option value="3">Part 3</option></select></label>
                      <label><span>难度</span><select value={row.candidate.level} onChange={(event) => updateCandidate(row.id, { level: event.target.value as UserKnowledgeCandidate['level'] })}><option value="basic">基础</option><option value="developing">进阶</option><option value="stretch">拓展</option></select></label>
                    </div>
                    <small>来源：{row.candidate.sourcePage ? `第 ${row.candidate.sourcePage} 页` : '无页码'}{row.candidate.sourceSection ? ` · ${row.candidate.sourceSection}` : ''} · 置信度 {row.candidate.confidence}</small>
                  </article>
                ))}
              </div>
              <div className="action-row">
                <button type="button" className="primary-button" onClick={() => void save()} disabled={busy}>确认并保存 {candidates.filter((row) => row.selected).length} 条</button>
                <button type="button" className="secondary-button" onClick={() => void organize()} disabled={busy}>重新整理</button>
              </div>
            </>
          )}
        </section>
      ) : null}

      <section className="card">
        <div className="card-heading"><div><p className="eyebrow">Sources</p><h2>已导入来源</h2></div><span>{sources.length} 份</span></div>
        {sources.length === 0 ? <p className="muted">还没有知识来源。导入一份 TXT、MD、DOCX、PDF、JPG 或 PNG 开始。</p> : (
          <div className="knowledge-source-list">
            {sources.map((source) => {
              const sourceEntries = entries.filter((entry) => entry.sourceId === source.id)
              const open = expandedSource === source.id
              return (
                <article className="knowledge-source" key={source.id}>
                  <div className="knowledge-source-header">
                    <button type="button" className="text-button" onClick={() => setExpandedSource(open ? null : source.id)} aria-expanded={open}><strong>{source.title}</strong><small>{source.fileName} · {source.entryCount} 条 · {source.status === 'ready' ? '启用' : '已停用'}</small></button>
                    <button type="button" className="danger-button compact" onClick={() => void deleteSource(source)}>删除来源</button>
                  </div>
                  {open ? <div className="knowledge-entry-list">{sourceEntries.length === 0 ? <p className="muted">来源下没有启用中的条目。</p> : sourceEntries.map((entry) => {
                    const editing = editingEntryId === entry.id && editingEntry !== null
                    return <article className={entry.enabled ? 'knowledge-entry' : 'knowledge-entry disabled'} key={entry.id}>
                      {editing ? (
                        <div className="knowledge-entry-edit">
                          <label><span>标题</span><input value={editingEntry.title} maxLength={160} onChange={(event) => setEditingEntry({ ...editingEntry, title: event.target.value })} /></label>
                          <label><span>内容</span><textarea rows={4} maxLength={2_000} value={editingEntry.body} onChange={(event) => setEditingEntry({ ...editingEntry, body: event.target.value })} /></label>
                          <label><span>主题（用顿号或逗号分隔）</span><input value={editingEntry.topics} maxLength={1_600} onChange={(event) => setEditingEntry({ ...editingEntry, topics: event.target.value })} /></label>
                          <label><span>标签（用顿号或逗号分隔）</span><input value={editingEntry.tags} maxLength={1_600} onChange={(event) => setEditingEntry({ ...editingEntry, tags: event.target.value })} /></label>
                        </div>
                      ) : (
                        <div><strong>{entry.title}</strong><p>{entry.body}</p><small>{entry.part === 'all' ? '全部 Part' : `Part ${entry.part}`} · {entry.topics.join('、') || '未标主题'} · {entry.sourcePage ? `第 ${entry.sourcePage} 页` : '无页码'}</small></div>
                      )}
                      <div className="action-row">
                        {editing ? <><button type="button" className="primary-button compact" onClick={() => void saveEntryEdit(entry)}>保存</button><button type="button" className="secondary-button compact" onClick={() => { setEditingEntryId(null); setEditingEntry(null) }}>取消</button></> : <button type="button" className="secondary-button compact" onClick={() => beginEditEntry(entry)}>编辑</button>}
                        <button type="button" className="secondary-button compact" onClick={() => void toggleEntry(entry)}>{entry.enabled ? '停用' : '启用'}</button><button type="button" className="danger-button compact" onClick={() => void deleteEntry(entry)}>删除</button>
                      </div>
                    </article>
                  })}</div> : null}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </section>
  )
}

function splitLabels(value: string, maximum: number): string[] {
  return value
    .split(/[、,，;；\n]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maximum)
}
