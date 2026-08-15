import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PracticeAttempt } from './domain'
import { AttemptReview } from './App'

const BASE_TIME = '2026-08-10T10:00:00.000Z'

function attemptWithTranscript(
  transcript: PracticeAttempt['transcript'],
): PracticeAttempt {
  return {
    id: 'attempt-1',
    attemptNumber: 1,
    audio: {
      id: 'audio-1',
      relativePath: 'indexeddb://audio/audio-1',
      mimeType: 'audio/webm',
      durationMs: 30_000,
      createdAt: BASE_TIME,
    },
    transcript,
    metrics: {
      durationMs: 30_000,
      wordCount: 0,
      wordsPerMinute: null,
      fillerWords: [],
      fillerCount: 0,
      repeatedWords: [],
      repeatedWordCount: 0,
      caveats: ['Transcript is unavailable.'],
    },
    createdAt: BASE_TIME,
    updatedAt: transcript.updatedAt,
  }
}

const pendingTranscript: PracticeAttempt['transcript'] = {
  status: 'pending',
  text: '',
  originalText: null,
  source: null,
  errorCode: null,
  updatedAt: BASE_TIME,
}

function review(attempt: PracticeAttempt, retry = vi.fn()) {
  return (
    <AttemptReview
      attempt={attempt}
      label="第一次回答"
      busy={false}
      onPlay={vi.fn()}
      onSaveTranscript={vi.fn()}
      onRetryTranscription={retry}
    />
  )
}

describe('AttemptReview deferred transcription', () => {
  it('hydrates an untouched pending draft when remote STT completes', async () => {
    const pending = attemptWithTranscript(pendingTranscript)
    const { rerender } = render(review(pending))
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveValue('')

    const ready = attemptWithTranscript({
      status: 'ready',
      text: 'I enjoy reading at home.',
      originalText: 'I enjoy reading at home.',
      source: 'stt',
      errorCode: null,
      updatedAt: '2026-08-10T10:01:00.000Z',
    })
    rerender(review(ready))

    await waitFor(() => {
      expect(textarea).toHaveValue('I enjoy reading at home.')
    })
  })

  it('does not overwrite a user draft when a late STT result arrives', async () => {
    const user = userEvent.setup()
    const pending = attemptWithTranscript(pendingTranscript)
    const { rerender } = render(review(pending))
    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'My corrected words')

    rerender(
      review(
        attemptWithTranscript({
          status: 'ready',
          text: 'Late automatic transcript',
          originalText: 'Late automatic transcript',
          source: 'stt',
          errorCode: null,
          updatedAt: '2026-08-10T10:01:00.000Z',
        }),
      ),
    )

    await waitFor(() => {
      expect(textarea).toHaveValue('My corrected words')
    })
  })

  it('makes a persisted pending transcript retryable after reopening', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    render(review(attemptWithTranscript(pendingTranscript), retry))

    const button = screen.getByRole('button', {
      name: '重新发起云端 STT 转写',
    })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(retry).toHaveBeenCalledOnce()
  })
})
