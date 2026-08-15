import type { InitialTranscript } from '../../application/practiceService'

/**
 * A lifecycle interruption never starts a cloud request. The original audio is
 * persisted immediately; live text is kept and an empty transcript stays
 * explicitly retryable/manual-editable after reopening.
 */
export function createInterruptedTranscriptInput(
  transcript: string,
): InitialTranscript {
  const cleanTranscript = transcript.trim()
  return cleanTranscript.length > 0
    ? { text: cleanTranscript, status: 'ready', source: 'stt' }
    : {
        text: '',
        status: 'failed',
        source: null,
        errorCode: 'recording-interrupted',
      }
}
