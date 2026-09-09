import { useRef, useState } from 'react'
import type {
  ImportDraft,
  ImportMaterialService,
} from '../application/imports'
import { detectImportFormat } from '../application/imports'
import type {
  ImportQuestionCandidate,
  ImportedQuestionRecord,
  Question,
} from '../domain'
import type { ImportQuestionBankReplacement } from '../ports/imports'
import {
  ImportWorkspace,
  type ImportCandidate,
  type ImportCandidatePatch,
  type ImportFailure,
  type ImportFileSummary,
  type ImportProgress,
  type ImportSuccess,
  type ImportWorkspacePhase,
} from '../features/imports'
import type { MaterialQuestionOrganizer } from '../ports/ai'

export interface ImportControllerProps {
  service: ImportMaterialService
  organizer: MaterialQuestionOrganizer
  existingQuestions: Question[]
  replacement?: ImportQuestionBankReplacement
  onImported: (records: ImportedQuestionRecord[]) => void
  onStartQuestion: (question: Question) => void
  onBack: () => void
}

export function ImportController({
  service,
  organizer,
  existingQuestions,
  replacement,
  onImported,
  onStartQuestion,
  onBack,
}: ImportControllerProps) {
  const [phase, setPhase] = useState<ImportWorkspacePhase>('select')
  const [fileSummary, setFileSummary] = useState<ImportFileSummary | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [candidates, setCandidates] = useState<ImportCandidate[]>([])
  const [failure, setFailure] = useState<ImportFailure | null>(null)
  const [success, setSuccess] = useState<ImportSuccess | null>(null)
  const [manualText, setManualText] = useState('')
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [imported, setImported] = useState<ImportedQuestionRecord[]>([])
  const sourcePages = useRef(new Map<string, number | null>())
  const operation = useRef(0)
  const lastFile = useRef<File | null>(null)

  const prepareFile = async (file: File) => {
    const token = ++operation.current
    lastFile.current = file
    setFailure(null)
    setSuccess(null)
    let initialSummary: ImportFileSummary
    try {
      initialSummary = createFileSummary(file)
    } catch (error) {
      setFileSummary(null)
      setFailure({
        code: 'unsupported',
        detail: error instanceof Error ? error.message : '不支持这个文件。',
      })
      setPhase('error')
      return
    }
    setFileSummary(initialSummary)
    setProgress({ stage: 'reading', percent: 10, detail: '先在本机读取文件。' })
    setPhase('extracting')

    try {
      setProgress({
        stage: isImageFile(file) ? 'ocr' : 'extracting-text',
        percent: 38,
        detail: isImageFile(file)
          ? '图片只交给 Android 本机 OCR。'
          : '正在提取文字，不上传原文件。',
      })
      const nextDraft = await service.prepare(file)
      if (token !== operation.current) return

      setProgress({
        stage: 'finding-questions',
        percent: 78,
        detail: '正在用本地规则寻找题目。',
      })
      const nextCandidates = toViewCandidates(
        nextDraft.candidates,
        existingQuestions,
        sourcePages.current,
      )
      setDraft(nextDraft)
      setFileSummary({
        ...createFileSummary(file),
        pageCount:
          nextDraft.extraction.pages[0]?.pageNumber === null
            ? null
            : nextDraft.extraction.pages.length,
      })
      setCandidates(nextCandidates)

      if (nextCandidates.length === 0) {
        setFailure({
          code: 'no-questions',
          detail: organizer.isConfigured()
            ? '可明确选择用 Text AI 整理，或手工粘贴。'
            : '可手工粘贴，或先在设置中配置 Text AI。',
        })
        setPhase('error')
      } else {
        setPhase('review')
      }
    } catch (error) {
      if (token !== operation.current) return
      setFailure(mapImportFailure(error, file))
      setPhase('error')
    }
  }

  const organizeWithTextAi = async () => {
    if (draft === null) return
    const token = ++operation.current
    setPhase('extracting')
    setProgress({
      stage: 'finding-questions',
      percent: null,
      detail: '仅将提取后的文字发送给 DeepSeek；原文件和图片不会上传。',
    })
    try {
      const organized = await organizer.extractQuestions({
        fileName: draft.source.fileName,
        extractedText: draft.extraction.text,
      })
      if (token !== operation.current) return
      // DeepSeek 失败或没整理出题目时,本地候选题必须原样保留
      if (organized.length === 0) {
        setFailure({
          code: 'ai-failed',
          detail: 'DeepSeek 没有整理出题目；本地候选题仍保留在预览中。',
        })
        setPhase('error')
        return
      }
      const nextCandidates = toViewCandidates(
        organized,
        existingQuestions,
        sourcePages.current,
      )
      setCandidates(nextCandidates)
      setFailure(null)
      setPhase('review')
    } catch (error) {
      if (token !== operation.current) return
      setFailure({
        code: 'ai-failed',
        detail: error instanceof Error ? error.message : 'DeepSeek 请求失败。',
      })
      setPhase('error')
    }
  }

  const commit = async (candidateIds: string[]) => {
    if (draft === null) return
    setPhase('saving')
    setProgress({
      stage: 'saving',
      percent: 90,
      detail: '题目、提取文字和原文件正在同一事务中保存。',
    })
    try {
      const selected = new Set(candidateIds)
      const domainCandidates: ImportQuestionCandidate[] = candidates
        .filter((candidate) => selected.has(candidate.id))
        .map((candidate) => ({
          id: candidate.id,
          part: candidate.part ?? 1,
          topic: candidate.topic,
          prompt: candidate.prompt,
          cuePoints: candidate.cuePoints,
          sourcePage: sourcePages.current.get(candidate.id) ?? null,
        }))
      const records = await service.commit(draft, domainCandidates, replacement)
      const skippedDuplicateCount = candidates.filter(
        (candidate) => candidate.duplicate !== null && !selected.has(candidate.id),
      ).length
      setImported(records)
      setSuccess({ importedCount: records.length, skippedDuplicateCount })
      setPhase('success')
      onImported(records)
    } catch (error) {
      setFailure({
        code: 'decode-failed',
        detail: error instanceof Error ? error.message : '本地保存失败。',
      })
      setPhase('error')
    }
  }

  const reset = () => {
    operation.current += 1
    lastFile.current = null
    sourcePages.current.clear()
    setPhase('select')
    setFileSummary(null)
    setProgress(null)
    setCandidates([])
    setDraft(null)
    setFailure(null)
    setSuccess(null)
    setImported([])
  }

  return (
    <ImportWorkspace
      phase={phase}
      file={fileSummary}
      progress={progress}
      candidates={candidates}
      failure={failure}
      success={success}
      manualText={manualText}
      textAiAvailable={organizer.isConfigured()}
      onFileSelected={(file) => void prepareFile(file)}
      onManualTextChange={setManualText}
      onExtractManualText={() => {
        const file = new File([manualText], 'pasted-questions.txt', {
          type: 'text/plain',
        })
        void prepareFile(file)
      }}
      onCancel={() => {
        operation.current += 1
        reset()
      }}
      onRetry={() => {
        if (failure?.code === 'ai-failed' && draft !== null) {
          void organizeWithTextAi()
        } else if (lastFile.current !== null) {
          void prepareFile(lastFile.current)
        }
      }}
      onChooseAnother={reset}
      onCandidateChange={(id, patch) => {
        setCandidates((current) => updateCandidate(current, id, patch))
      }}
      onCandidateSelectionChange={(id, selected) => {
        setCandidates((current) =>
          current.map((candidate) =>
            candidate.id === id ? { ...candidate, selected } : candidate,
          ),
        )
      }}
      onDuplicateDecision={(id, include) => {
        setCandidates((current) =>
          current.map((candidate) =>
            candidate.id === id
              ? { ...candidate, includeDuplicate: include, selected: include }
              : candidate,
          ),
        )
      }}
      onImport={(ids) => void commit(ids)}
      onOrganizeWithTextAi={() => void organizeWithTextAi()}
      onContinueLocalCandidates={() => {
        setFailure(null)
        setPhase('review')
      }}
      onStartFirstQuestion={() => {
        const first = imported[0]?.question
        if (first !== undefined) onStartQuestion(first)
      }}
      onBackToLibrary={onBack}
    />
  )
}

function createFileSummary(file: File): ImportFileSummary {
  return {
    name: file.name,
    sizeBytes: file.size,
    format: detectImportFormat(file.name),
    pageCount: null,
  }
}

function isImageFile(file: File): boolean {
  const format = detectImportFormat(file.name)
  return format === 'jpg' || format === 'png'
}

function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/[\s?？.!。]+/g, ' ').trim()
}

function toViewCandidates(
  values: ImportQuestionCandidate[],
  existingQuestions: Question[],
  sourcePages: Map<string, number | null>,
): ImportCandidate[] {
  sourcePages.clear()
  const known = new Map(
    existingQuestions.map((question) => [normalizePrompt(question.prompt), question.prompt]),
  )
  const inFile = new Map<string, string>()

  return values.map((value) => {
    sourcePages.set(value.id, value.sourcePage)
    const normalized = normalizePrompt(value.prompt)
    const libraryMatch = known.get(normalized)
    const fileMatch = inFile.get(normalized)
    const duplicate = libraryMatch !== undefined
      ? { scope: 'library' as const, matchedPrompt: libraryMatch }
      : fileMatch !== undefined
        ? { scope: 'file' as const, matchedPrompt: fileMatch }
        : null
    inFile.set(normalized, value.prompt)
    return {
      id: value.id,
      selected: duplicate === null,
      part: value.part,
      topic: value.topic,
      prompt: value.prompt,
      cuePoints: value.cuePoints,
      duplicate,
      includeDuplicate: false,
      issues: [],
    }
  })
}

function updateCandidate(
  candidates: ImportCandidate[],
  id: string,
  patch: ImportCandidatePatch,
): ImportCandidate[] {
  return candidates.map((candidate) =>
    candidate.id === id ? { ...candidate, ...patch } : candidate,
  )
}

function mapImportFailure(error: unknown, file: File): ImportFailure {
  const detail = error instanceof Error ? error.message : '导入失败。'
  if (/仅支持|旧版 \.doc/i.test(detail)) {
    return { code: 'unsupported', detail }
  }
  if (/25 MB|超过/i.test(detail)) {
    return { code: 'too-large', detail }
  }
  const imageInput = (() => {
    try {
      return isImageFile(file)
    } catch {
      return false
    }
  })()
  if (/OCR|图片/i.test(detail) || imageInput) {
    return { code: 'ocr-failed', detail }
  }
  return { code: 'decode-failed', detail }
}
