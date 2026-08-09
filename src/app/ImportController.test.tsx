import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  ImportDraft,
  ImportMaterialService,
} from '../application/imports'
import type { MaterialQuestionOrganizer } from '../ports/ai'
import { ImportController } from './ImportController'

const extractedText = 'Part 1\nTopic: Home\nWhat do you like most about your home?'

function createDraft(file: File): ImportDraft {
  return {
    file,
    source: {
      id: 'import-local-source',
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      format: 'txt',
      extractionMode: 'plain-text',
      extractedText,
      originalFileId: 'import-file-local-source',
      importedAt: '2026-08-10T10:00:00.000Z',
    },
    extraction: {
      format: 'txt',
      mode: 'plain-text',
      text: extractedText,
      pages: [{ pageNumber: null, text: extractedText, usedOcr: false }],
      warnings: [],
    },
    candidates: [
      {
        id: 'local-candidate-1',
        part: 1,
        topic: 'Home',
        prompt: 'What do you like most about your home?',
        cuePoints: [],
        sourcePage: null,
      },
    ],
  }
}

describe('ImportController AI failure recovery', () => {
  it('returns to review with the preserved local candidates', async () => {
    const user = userEvent.setup()
    const service = {
      prepare: vi.fn((file: File) => Promise.resolve(createDraft(file))),
      commit: vi.fn(),
    } as unknown as ImportMaterialService
    const extractQuestions = vi.fn(() =>
      Promise.reject(new Error('network unavailable')),
    )
    const organizer: MaterialQuestionOrganizer = {
      isConfigured: () => true,
      extractQuestions,
    }
    const { container } = render(
      <ImportController
        service={service}
        organizer={organizer}
        existingQuestions={[]}
        onImported={vi.fn()}
        onStartQuestion={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()

    await user.upload(
      input as HTMLInputElement,
      new File([extractedText], 'questions.txt', { type: 'text/plain' }),
    )
    expect(
      await screen.findByRole('heading', { name: '确认后再加入题库' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '用 Text AI 重新整理' }))
    expect(
      await screen.findByRole('heading', { name: 'Text AI 没有完成整理' }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: '继续使用本地候选题' }),
    )

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '确认后再加入题库' }),
      ).toBeInTheDocument()
    })
    expect(
      screen.getByText('What do you like most about your home?'),
    ).toBeInTheDocument()
    expect(extractQuestions).toHaveBeenCalledOnce()
  })
})
