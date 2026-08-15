import { useMemo, useRef, useState } from 'react'
import styles from './ImportWorkspace.module.css'
import type {
  ImportCandidate,
  ImportCandidatePatch,
  ImportFailure,
  ImportFileSummary,
  ImportProgress,
  ImportSuccess,
  ImportWorkspacePhase,
} from './types'

export const IMPORT_FILE_ACCEPT = [
  '.txt',
  '.md',
  '.docx',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
  'image/jpeg',
  'image/png',
].join(',')

export interface ImportWorkspaceProps {
  phase: ImportWorkspacePhase
  file: ImportFileSummary | null
  progress: ImportProgress | null
  candidates: ImportCandidate[]
  failure: ImportFailure | null
  success: ImportSuccess | null
  manualText: string
  onFileSelected: (file: File) => void
  onManualTextChange: (text: string) => void
  onExtractManualText: () => void
  onCancel: () => void
  onRetry: () => void
  onChooseAnother: () => void
  onCandidateChange: (candidateId: string, patch: ImportCandidatePatch) => void
  onCandidateSelectionChange: (candidateId: string, selected: boolean) => void
  onDuplicateDecision: (candidateId: string, include: boolean) => void
  onImport: (candidateIds: string[]) => void
  textAiAvailable?: boolean
  onOrganizeWithTextAi?: () => void
  onContinueLocalCandidates?: () => void
  onStartFirstQuestion: () => void
  onBackToLibrary: () => void
}

type ReviewFilter = 'all' | 'needs-review' | 'duplicates'

const stageLabels: Record<ImportProgress['stage'], string> = {
  reading: '正在读取文件',
  'extracting-text': '正在提取文字',
  ocr: '正在用本机识别图片文字',
  'finding-questions': '正在整理候选题',
  saving: '正在保存到本地题库',
}

const failureCopy: Record<ImportFailure['code'], { title: string; body: string }> = {
  unsupported: {
    title: '暂不支持这个文件',
    body: '请使用 TXT、MD、DOCX、PDF、JPG 或 PNG。旧版 .doc 请先在 Word 中另存为 .docx。',
  },
  'too-large': {
    title: '文件太大，手机暂时处理不了',
    body: '请压缩图片或把文档拆成更小的文件后重试。',
  },
  'decode-failed': {
    title: '无法读取这个文件',
    body: '文件可能已损坏、加密或编码异常。你可以换一个文件，或手工粘贴题目。',
  },
  'ocr-failed': {
    title: '本机图片文字识别没有完成',
    body: '源文件没有被修改，也没有创建半成品题目。你可以重试或手工粘贴。',
  },
  'ai-failed': {
    title: 'Text AI 没有完成整理',
    body: '本地提取内容仍在当前预览中；你可以重试、继续使用本地候选题或手工粘贴。',
  },
  'no-questions': {
    title: '没有找到可确认的口语题',
    body: '文件已经读取，但内容没有被可靠识别为题目。你可以手工粘贴或换一个文件。',
  },
}

const formatLabels = ['TXT', 'MD', 'DOCX', 'PDF', 'JPG', 'PNG'] as const

const formatFileSize = (bytes: number) => {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 * 1_024) return `${Math.round(bytes / 1_024)} KB`
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`
}

const candidateProblems = (candidate: ImportCandidate) => {
  const problems: string[] = []
  const cuePoints = candidate.cuePoints.map((point) => point.trim()).filter(Boolean)

  if (candidate.part === null) problems.push('请选择 Part')
  if (!candidate.topic.trim()) problems.push('请填写主题')
  if (candidate.topic.trim().length > 80) problems.push('主题不能超过 80 个字符')
  if (!candidate.prompt.trim()) problems.push('请填写题目')
  if (candidate.prompt.trim().length > 500) problems.push('题目不能超过 500 个字符')
  if (candidate.part === 2 && (cuePoints.length < 2 || cuePoints.length > 5)) {
    problems.push('Part 2 需要 2–5 条提示点')
  }
  if (candidate.cuePoints.some((point) => point.trim().length > 160)) {
    problems.push('每条提示点不能超过 160 个字符')
  }
  for (const issue of candidate.issues) {
    if (issue.severity === 'error') problems.push(issue.message)
  }
  if (candidate.duplicate && !candidate.includeDuplicate && candidate.selected) {
    problems.push('请先确认是否仍要导入重复题')
  }

  return [...new Set(problems)]
}

function FileSummary({ file }: { file: ImportFileSummary }) {
  return (
    <div className={styles.fileSummary}>
      <div>
        <strong>{file.name}</strong>
        <small>
          {file.format.toUpperCase()} · {formatFileSize(file.sizeBytes)}
          {file.pageCount === null ? '' : ` · ${file.pageCount} 页`}
        </small>
      </div>
    </div>
  )
}

function ManualPaste({
  value,
  onChange,
  onExtract,
}: {
  value: string
  onChange: (value: string) => void
  onExtract: () => void
}) {
  return (
    <section className={styles.manualCard}>
      <div>
        <p className={styles.eyebrow}>备用方式</p>
        <h2>直接粘贴题目文字</h2>
      </div>
      <textarea
        value={value}
        rows={6}
        placeholder="粘贴题目、Part 标记和 Part 2 提示点。提取后仍会进入人工预览。"
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={!value.trim()}
        onClick={onExtract}
      >
        从粘贴内容提取
      </button>
    </section>
  )
}

function SelectStep({ props }: { props: ImportWorkspaceProps }) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={styles.stack}>
      <section className={styles.introCard}>
        <p className={styles.eyebrow}>本地题库</p>
        <h1>导入自己的 IELTS 口语题</h1>
        <p>
          文档在本机提取；JPG、PNG 和扫描 PDF 使用 Android 本机 OCR，不发送给 Text AI。
        </p>
        <div className={styles.formatList} aria-label="支持的文件格式">
          {formatLabels.map((label) => <span key={label}>{label}</span>)}
        </div>
        <input
          ref={inputRef}
          className={styles.hiddenInput}
          type="file"
          aria-hidden="true"
          tabIndex={-1}
          accept={IMPORT_FILE_ACCEPT}
          onChange={(event) => {
            const nextFile = event.target.files?.[0]
            if (nextFile) props.onFileSelected(nextFile)
            event.target.value = ''
          }}
        />
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => inputRef.current?.click()}
        >
          选择一个文件
        </button>
        <small className={styles.supportNote}>
          一次选择一个文件；旧版 .doc 请先另存为 .docx。
        </small>
      </section>
      <ManualPaste
        value={props.manualText}
        onChange={props.onManualTextChange}
        onExtract={props.onExtractManualText}
      />
    </div>
  )
}

function BusyStep({ props }: { props: ImportWorkspaceProps }) {
  const progress = props.progress
  const value = progress?.percent === null
    ? null
    : Math.max(0, Math.min(100, progress?.percent ?? 0))

  return (
    <section className={styles.centerCard} aria-live="polite">
      <p className={styles.eyebrow}>导入题目</p>
      <h1>{progress ? stageLabels[progress.stage] : '正在处理'}</h1>
      {props.file ? <FileSummary file={props.file} /> : null}
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-label="导入进度"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(value === null ? {} : { 'aria-valuenow': value })}
      >
        <span style={{ width: value === null ? '38%' : `${value}%` }} />
      </div>
      <p className={styles.progressDetail}>
        {progress?.detail ?? '请保持 App 在前台，完成前不会写入题库。'}
      </p>
      {props.phase === 'extracting' ? (
        <button type="button" className={styles.textButton} onClick={props.onCancel}>
          取消导入
        </button>
      ) : (
        <p className={styles.lockedNote}>正在原子保存，请稍候。</p>
      )}
    </section>
  )
}

function CandidateEditor({
  candidate,
  problems,
  onChange,
}: {
  candidate: ImportCandidate
  problems: string[]
  onChange: (patch: ImportCandidatePatch) => void
}) {
  const updateCuePoint = (index: number, value: string) => {
    const cuePoints = [...candidate.cuePoints]
    cuePoints[index] = value
    onChange({ cuePoints })
  }

  return (
    <div className={styles.editor}>
      <fieldset>
        <legend>IELTS Speaking 部分</legend>
        <div className={styles.partChoices}>
          {([1, 2, 3] as const).map((part) => (
            <label key={part}>
              <input
                type="radio"
                name={`part-${candidate.id}`}
                checked={candidate.part === part}
                onChange={() => onChange({ part })}
              />
              <span>Part {part}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className={styles.field}>
        <span>主题</span>
        <input
          value={candidate.topic}
          maxLength={80}
          placeholder="例如：Home"
          onChange={(event) => onChange({ topic: event.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span>题目</span>
        <textarea
          value={candidate.prompt}
          maxLength={500}
          rows={4}
          onChange={(event) => onChange({ prompt: event.target.value })}
        />
      </label>
      {candidate.part === 2 ? (
        <div className={styles.cueEditor}>
          <div className={styles.fieldHeading}>
            <span>提示点（2–5 条）</span>
            <button
              type="button"
              className={styles.smallButton}
              disabled={candidate.cuePoints.length >= 5}
              onClick={() => onChange({ cuePoints: [...candidate.cuePoints, ''] })}
            >
              添加提示点
            </button>
          </div>
          {candidate.cuePoints.map((point, index) => (
            <div className={styles.cueRow} key={`${candidate.id}-cue-${index}`}>
              <input
                value={point}
                maxLength={160}
                aria-label={`提示点 ${index + 1}`}
                onChange={(event) => updateCuePoint(index, event.target.value)}
              />
              <button
                type="button"
                aria-label={`删除提示点 ${index + 1}`}
                onClick={() => onChange({
                  cuePoints: candidate.cuePoints.filter((_, itemIndex) => itemIndex !== index),
                })}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {problems.length ? (
        <div className={styles.problemList} role="alert">
          {problems.map((problem) => <p key={problem}>{problem}</p>)}
        </div>
      ) : null}
      {candidate.issues.filter((issue) => issue.severity === 'warning').map((issue) => (
        <p className={styles.warning} key={`${issue.code}-${issue.message}`}>{issue.message}</p>
      ))}
    </div>
  )
}

function CandidateCard({
  candidate,
  editing,
  onToggleEdit,
  props,
}: {
  candidate: ImportCandidate
  editing: boolean
  onToggleEdit: () => void
  props: ImportWorkspaceProps
}) {
  const problems = candidateProblems(candidate)
  const needsReview = problems.length > 0

  return (
    <article className={`${styles.candidateCard} ${needsReview ? styles.needsReview : ''}`}>
      <div className={styles.candidateHeader}>
        <label className={styles.checkTarget}>
          <input
            type="checkbox"
            checked={candidate.selected}
            onChange={(event) => props.onCandidateSelectionChange(candidate.id, event.target.checked)}
          />
          <span className={styles.srOnly}>选择这道题</span>
        </label>
        <div className={styles.candidateSummary}>
          <div className={styles.badges}>
            <span>{candidate.part === null ? 'Part 待确认' : `Part ${candidate.part}`}</span>
            {candidate.topic.trim() ? <span>{candidate.topic}</span> : null}
            {candidate.duplicate ? <span className={styles.duplicateBadge}>重复</span> : null}
            {needsReview ? <span className={styles.reviewBadge}>待完善</span> : null}
          </div>
          <strong>{candidate.prompt.trim() || '题目文字待补充'}</strong>
        </div>
        <button
          type="button"
          className={styles.editButton}
          aria-expanded={editing}
          onClick={onToggleEdit}
        >
          {editing ? '收起' : '编辑'}
        </button>
      </div>

      {candidate.duplicate ? (
        <div className={styles.duplicateNotice}>
          <p>
            {candidate.duplicate.scope === 'library' ? '题库中已有相同题目。' : '本次文件中有相同题目。'}
            默认跳过，不会覆盖原题。
          </p>
          <button
            type="button"
            onClick={() => props.onDuplicateDecision(candidate.id, !candidate.includeDuplicate)}
          >
            {candidate.includeDuplicate ? '改为跳过' : '仍然导入'}
          </button>
        </div>
      ) : null}

      {editing ? (
        <CandidateEditor
          candidate={candidate}
          problems={problems}
          onChange={(patch) => props.onCandidateChange(candidate.id, patch)}
        />
      ) : needsReview ? (
        <p className={styles.compactProblem}>{problems[0]}</p>
      ) : null}
    </article>
  )
}

function ReviewStep({ props }: { props: ImportWorkspaceProps }) {
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const stats = useMemo(() => {
    const selected = props.candidates.filter((candidate) => candidate.selected)
    const invalidSelected = selected.filter((candidate) => candidateProblems(candidate).length > 0)
    return {
      selected,
      invalidSelected,
      needsReview: props.candidates.filter((candidate) => candidateProblems(candidate).length > 0),
      duplicates: props.candidates.filter((candidate) => candidate.duplicate !== null),
    }
  }, [props.candidates])

  const visible = props.candidates.filter((candidate) => {
    if (filter === 'needs-review') return candidateProblems(candidate).length > 0
    if (filter === 'duplicates') return candidate.duplicate !== null
    return true
  })
  const canImport = stats.selected.length > 0 && stats.invalidSelected.length === 0

  return (
    <div className={styles.reviewLayout}>
      <section className={styles.reviewIntro}>
        <p className={styles.eyebrow}>人工确认</p>
        <h1>确认后再加入题库</h1>
        <p>
          找到 {props.candidates.length} 道候选题。请检查 Part、主题和题目；Part 2 还需要 2–5 条提示点。
        </p>
        {props.file ? <FileSummary file={props.file} /> : null}
        {props.onOrganizeWithTextAi ? (
          <div className={styles.aiOrganizeRow}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={!props.textAiAvailable}
              onClick={props.onOrganizeWithTextAi}
            >
              用 DeepSeek 智能整理
            </button>
            <small>
              {props.textAiAvailable
                ? '仅点击后才会把提取文字发送到 DeepSeek；失败时本地候选题不丢失。'
                : '需要已配置的云端 Text AI；当前仍可继续使用本地候选题。'}
            </small>
          </div>
        ) : null}
      </section>

      <div className={styles.filterTabs} role="tablist" aria-label="筛选候选题">
        {([
          ['all', `全部 ${props.candidates.length}`],
          ['needs-review', `待确认 ${stats.needsReview.length}`],
          ['duplicates', `重复 ${stats.duplicates.length}`],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={filter === value ? styles.activeTab : ''}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.bulkActions}>
        <button
          type="button"
          onClick={() => props.candidates.forEach((candidate) => {
            const canSelect = candidateProblems({ ...candidate, selected: true }).length === 0
            props.onCandidateSelectionChange(candidate.id, canSelect)
          })}
        >
          选择全部可导入题目
        </button>
        <button
          type="button"
          onClick={() => props.candidates.forEach((candidate) => {
            props.onCandidateSelectionChange(candidate.id, false)
          })}
        >
          全部取消
        </button>
      </div>

      <div className={styles.candidateList}>
        {visible.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            editing={editingId === candidate.id}
            onToggleEdit={() => setEditingId((current) => current === candidate.id ? null : candidate.id)}
            props={props}
          />
        ))}
        {visible.length === 0 ? (
          <div className={styles.emptyFilter}>这个筛选下没有候选题。</div>
        ) : null}
      </div>

      <div className={styles.reviewFooter}>
        <div>
          <strong>已选择 {stats.selected.length} 道</strong>
          <small>
            {stats.invalidSelected.length
              ? `还有 ${stats.invalidSelected.length} 道需要完善`
              : '导入时不会覆盖已有题目'}
          </small>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!canImport}
          onClick={() => props.onImport(stats.selected.map((candidate) => candidate.id))}
        >
          导入 {stats.selected.length} 道题
        </button>
      </div>

      <button type="button" className={styles.textButton} onClick={props.onChooseAnother}>
        放弃本次预览并换一个文件
      </button>
    </div>
  )
}

function ErrorStep({ props }: { props: ImportWorkspaceProps }) {
  const copy = props.failure ? failureCopy[props.failure.code] : {
    title: '导入没有完成',
    body: '没有创建任何题目。你可以重试或换一个文件。',
  }

  return (
    <div className={styles.stack}>
      <section className={styles.errorCard} role="alert">
        <p className={styles.eyebrow}>导入未完成</p>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        {props.failure?.detail ? <small>{props.failure.detail}</small> : null}
        {props.file ? <FileSummary file={props.file} /> : null}
        <p className={styles.safeResult}>源文件仍在原位置；本地题库没有写入半成品。</p>
        <div className={styles.actionRow}>
          {props.failure?.code === 'ai-failed' &&
          props.candidates.length > 0 &&
          props.onContinueLocalCandidates ? (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={props.onContinueLocalCandidates}
            >
              继续使用本地候选题
            </button>
          ) : null}
          <button type="button" className={styles.primaryButton} onClick={props.onRetry}>
            重试
          </button>
          <button type="button" className={styles.secondaryButton} onClick={props.onChooseAnother}>
            换一个文件
          </button>
        </div>
        {props.failure?.code === 'no-questions' &&
        props.textAiAvailable &&
        props.onOrganizeWithTextAi ? (
          <div className={styles.aiOrganizeRow}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={props.onOrganizeWithTextAi}
            >
              用 DeepSeek 智能整理
            </button>
            <small>这是一次明确上传操作；原文件和图片不会上传。</small>
          </div>
        ) : null}
      </section>
      <ManualPaste
        value={props.manualText}
        onChange={props.onManualTextChange}
        onExtract={props.onExtractManualText}
      />
    </div>
  )
}

function SuccessStep({ props }: { props: ImportWorkspaceProps }) {
  const success = props.success ?? { importedCount: 0, skippedDuplicateCount: 0 }

  return (
    <section className={styles.successCard} role="status">
      <p className={styles.eyebrow}>导入完成</p>
      <h1>已加入 {success.importedCount} 道题</h1>
      <p>
        题目已保存在本机，会和内置题一起出现在 Part 筛选中。
        {success.skippedDuplicateCount > 0
          ? ` 已跳过 ${success.skippedDuplicateCount} 道重复题。`
          : ''}
      </p>
      <div className={styles.actionRow}>
        <button type="button" className={styles.primaryButton} onClick={props.onStartFirstQuestion}>
          开始练第一题
        </button>
        <button type="button" className={styles.secondaryButton} onClick={props.onBackToLibrary}>
          回到题库
        </button>
      </div>
    </section>
  )
}

export function ImportWorkspace(props: ImportWorkspaceProps) {
  if (props.phase === 'select') return <SelectStep props={props} />
  if (props.phase === 'extracting' || props.phase === 'saving') return <BusyStep props={props} />
  if (props.phase === 'review') return <ReviewStep props={props} />
  if (props.phase === 'error') return <ErrorStep props={props} />
  return <SuccessStep props={props} />
}
