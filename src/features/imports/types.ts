export type ImportFormat = 'txt' | 'md' | 'docx' | 'pdf' | 'jpg' | 'png'

export type ImportWorkspacePhase =
  | 'select'
  | 'extracting'
  | 'review'
  | 'saving'
  | 'error'
  | 'success'

export type ImportFailureCode =
  | 'unsupported'
  | 'too-large'
  | 'decode-failed'
  | 'ocr-failed'
  | 'ai-failed'
  | 'no-questions'

export interface ImportFileSummary {
  name: string
  sizeBytes: number
  format: ImportFormat
  pageCount: number | null
}

export type ImportProgressStage =
  | 'reading'
  | 'extracting-text'
  | 'ocr'
  | 'finding-questions'
  | 'saving'

export interface ImportProgress {
  stage: ImportProgressStage
  percent: number | null
  detail: string | null
}

export interface ImportCandidateIssue {
  code: string
  message: string
  severity: 'warning' | 'error'
}

export interface DuplicateMatch {
  scope: 'library' | 'file'
  matchedPrompt: string | null
}

export interface ImportCandidate {
  id: string
  selected: boolean
  part: 1 | 2 | 3 | null
  topic: string
  prompt: string
  cuePoints: string[]
  duplicate: DuplicateMatch | null
  includeDuplicate: boolean
  issues: ImportCandidateIssue[]
}

export type ImportCandidatePatch = Partial<
  Pick<ImportCandidate, 'part' | 'topic' | 'prompt' | 'cuePoints'>
>

export interface ImportFailure {
  code: ImportFailureCode
  detail: string | null
}

export interface ImportSuccess {
  importedCount: number
  skippedDuplicateCount: number
}
