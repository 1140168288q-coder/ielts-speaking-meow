import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ImportWorkspace,
  IMPORT_FILE_ACCEPT,
  type ImportWorkspaceProps,
} from './ImportWorkspace'
import type { ImportCandidate } from './types'

const validCandidate = (overrides: Partial<ImportCandidate> = {}): ImportCandidate => ({
  id: 'candidate-1',
  selected: true,
  part: 1,
  topic: 'Home',
  prompt: 'What do you like most about your home?',
  cuePoints: [],
  duplicate: null,
  includeDuplicate: false,
  issues: [],
  ...overrides,
})

const createProps = (
  overrides: Partial<ImportWorkspaceProps> = {},
): ImportWorkspaceProps => ({
  phase: 'select',
  file: null,
  progress: null,
  candidates: [],
  failure: null,
  success: null,
  manualText: '',
  onFileSelected: vi.fn(),
  onManualTextChange: vi.fn(),
  onExtractManualText: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
  onChooseAnother: vi.fn(),
  onCandidateChange: vi.fn(),
  onCandidateSelectionChange: vi.fn(),
  onDuplicateDecision: vi.fn(),
  onImport: vi.fn(),
  onStartFirstQuestion: vi.fn(),
  onBackToLibrary: vi.fn(),
  ...overrides,
})

describe('ImportWorkspace', () => {
  it('selects one of the six supported file classes without reading it in the component', async () => {
    const user = userEvent.setup()
    const onFileSelected = vi.fn()
    const { container } = render(
      <ImportWorkspace {...createProps({ onFileSelected })} />,
    )
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    const file = new File(['# Questions'], 'practice.md', { type: 'text/markdown' })

    expect(IMPORT_FILE_ACCEPT).toContain('.txt')
    expect(IMPORT_FILE_ACCEPT).toContain('.md')
    expect(IMPORT_FILE_ACCEPT).toContain('.docx')
    expect(IMPORT_FILE_ACCEPT).toContain('.pdf')
    expect(IMPORT_FILE_ACCEPT).toContain('.jpg')
    expect(IMPORT_FILE_ACCEPT).toContain('.png')
    expect(IMPORT_FILE_ACCEPT).not.toContain('.doc,')
    expect(fileInput).not.toBeNull()
    expect(fileInput).toHaveAttribute('aria-hidden', 'true')
    expect(fileInput).toHaveAttribute('tabindex', '-1')

    await user.upload(fileInput as HTMLInputElement, file)

    expect(onFileSelected).toHaveBeenCalledWith(file)
    expect(screen.getByText(/Android 本机 OCR/)).toBeInTheDocument()
  })

  it('shows local OCR progress and lets the parent cancel extraction', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ImportWorkspace
        {...createProps({
          phase: 'extracting',
          file: { name: 'scan.pdf', sizeBytes: 2_048, format: 'pdf', pageCount: 4 },
          progress: { stage: 'ocr', percent: 50, detail: '正在识别第 2/4 页' },
          onCancel,
        })}
      />,
    )

    expect(screen.getByRole('progressbar', { name: '导入进度' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
    expect(screen.getByText('正在用本机识别图片文字')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消导入' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('requires invalid selected candidates to be fixed before atomic import', async () => {
    const user = userEvent.setup()
    const onCandidateChange = vi.fn()
    const onImport = vi.fn()
    render(
      <ImportWorkspace
        {...createProps({
          phase: 'review',
          candidates: [validCandidate({ part: 2, cuePoints: ['only one'] })],
          onCandidateChange,
          onImport,
        })}
      />,
    )

    expect(screen.getByRole('button', { name: '导入 1 道题' })).toBeDisabled()
    expect(screen.getByText('Part 2 需要 2–5 条提示点')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '编辑' }))
    await user.click(screen.getByRole('button', { name: '添加提示点' }))

    expect(onCandidateChange).toHaveBeenCalledWith('candidate-1', {
      cuePoints: ['only one', ''],
    })
    expect(onImport).not.toHaveBeenCalled()
  })

  it('never silently overwrites an existing duplicate', async () => {
    const user = userEvent.setup()
    const onDuplicateDecision = vi.fn()
    render(
      <ImportWorkspace
        {...createProps({
          phase: 'review',
          candidates: [validCandidate({
            selected: false,
            duplicate: { scope: 'library', matchedPrompt: 'Existing question' },
          })],
          onDuplicateDecision,
        })}
      />,
    )

    expect(screen.getByText(/默认跳过，不会覆盖原题/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '仍然导入' }))
    expect(onDuplicateDecision).toHaveBeenCalledWith('candidate-1', true)
  })

  it('passes only selected valid ids to the atomic import callback', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    render(
      <ImportWorkspace
        {...createProps({
          phase: 'review',
          candidates: [
            validCandidate(),
            validCandidate({ id: 'candidate-2', selected: false, prompt: 'Do you like music?' }),
          ],
          onImport,
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: '导入 1 道题' }))
    expect(onImport).toHaveBeenCalledWith(['candidate-1'])
  })

  it('maps damaged and OCR failures to recoverable copy without partial-save claims', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const onExtractManualText = vi.fn()
    render(
      <ImportWorkspace
        {...createProps({
          phase: 'error',
          failure: { code: 'ocr-failed', detail: '设备识别服务暂不可用' },
          manualText: 'What do you do on weekends?',
          onRetry,
          onExtractManualText,
        })}
      />,
    )

    expect(screen.getByText('本机图片文字识别没有完成')).toBeInTheDocument()
    expect(screen.getByText(/没有写入半成品/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    await user.click(screen.getByRole('button', { name: '从粘贴内容提取' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onExtractManualText).toHaveBeenCalledOnce()
  })

  it('lets an AI organizer failure return to already extracted local candidates', async () => {
    const user = userEvent.setup()
    const onContinueLocalCandidates = vi.fn()
    render(
      <ImportWorkspace
        {...createProps({
          phase: 'error',
          candidates: [validCandidate()],
          failure: { code: 'ai-failed', detail: 'network unavailable' },
          onContinueLocalCandidates,
        })}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: '继续使用本地候选题' }),
    )
    expect(onContinueLocalCandidates).toHaveBeenCalledOnce()
  })

  it('does not offer local continuation when an AI failure has no candidates', () => {
    render(
      <ImportWorkspace
        {...createProps({
          phase: 'error',
          candidates: [],
          failure: { code: 'ai-failed', detail: 'network unavailable' },
          onContinueLocalCandidates: vi.fn(),
        })}
      />,
    )

    expect(
      screen.queryByRole('button', { name: '继续使用本地候选题' }),
    ).not.toBeInTheDocument()
  })

  it('connects successful imports back to practice or the question library', async () => {
    const user = userEvent.setup()
    const onStartFirstQuestion = vi.fn()
    const onBackToLibrary = vi.fn()
    render(
      <ImportWorkspace
        {...createProps({
          phase: 'success',
          success: { importedCount: 8, skippedDuplicateCount: 2 },
          onStartFirstQuestion,
          onBackToLibrary,
        })}
      />,
    )

    expect(screen.getByText('已加入 8 道题')).toBeInTheDocument()
    expect(screen.getByText(/已跳过 2 道重复题/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '开始练第一题' }))
    await user.click(screen.getByRole('button', { name: '回到题库' }))
    expect(onStartFirstQuestion).toHaveBeenCalledOnce()
    expect(onBackToLibrary).toHaveBeenCalledOnce()
  })
})
