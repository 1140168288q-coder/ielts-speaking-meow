import { SpeechCapabilityUnavailableError } from '../../ports/speech'
import {
  MediaRecorderAdapter,
  type MediaRecorderLike,
  type MediaStreamLike,
} from './mediaRecorderAdapter'

class FakeMediaRecorder implements MediaRecorderLike {
  readonly mimeType = 'audio/webm;codecs=opus'
  state = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: { error?: unknown }) => void) | null = null

  readonly start = vi.fn(() => {
    this.state = 'recording'
  })

  readonly stop = vi.fn(() => {
    this.ondataavailable?.({ data: new Blob(['original audio']) })
    this.state = 'inactive'
    this.onstop?.()
  })
}

describe('MediaRecorderAdapter', () => {
  it('returns the original captured audio and always releases the microphone', async () => {
    const stopTrack = vi.fn()
    const stream: MediaStreamLike = { getTracks: () => [{ stop: stopTrack }] }
    const mediaRecorder = new FakeMediaRecorder()
    const createRecorder = vi.fn(() => mediaRecorder)
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_450)
    const recorder = new MediaRecorderAdapter({
      getUserMedia: () => Promise.resolve(stream),
      createRecorder,
      isTypeSupported: (mimeType) => mimeType.startsWith('audio/webm'),
      now,
    })

    await recorder.start()
    expect(recorder.state).toBe('recording')
    expect(createRecorder).toHaveBeenCalledWith(stream, {
      mimeType: 'audio/webm;codecs=opus',
    })

    const result = await recorder.stop()

    expect(result).toMatchObject({
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 1_450,
      startedAt: 1_000,
      endedAt: 2_450,
    })
    expect(await result.blob.text()).toBe('original audio')
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(recorder.state).toBe('idle')
  })

  it('releases a granted microphone stream if recorder creation fails', async () => {
    const stopTrack = vi.fn()
    const stream: MediaStreamLike = { getTracks: () => [{ stop: stopTrack }] }
    const recorder = new MediaRecorderAdapter({
      getUserMedia: () => Promise.resolve(stream),
      createRecorder: () => {
        throw new Error('Recorder construction failed')
      },
    })

    await expect(recorder.start()).rejects.toThrow('Recorder construction failed')
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(recorder.state).toBe('idle')
  })

  it('fails cleanly on platforms without microphone capture', async () => {
    const recorder = new MediaRecorderAdapter({
      getUserMedia: null,
      createRecorder: null,
    })

    await expect(recorder.start()).rejects.toBeInstanceOf(
      SpeechCapabilityUnavailableError,
    )
  })
})
