import {
  SpeechCapabilityUnavailableError,
  STTError,
  type STTErrorCode,
  type STTListener,
  type STTProvider,
  type STTRequest,
  type STTResult,
  type STTSession,
} from '../../ports/speech'

export interface WebSpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

export interface WebSpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: WebSpeechRecognitionAlternative
}

export interface WebSpeechRecognitionResultList {
  readonly length: number
  readonly [index: number]: WebSpeechRecognitionResult
}

export interface WebSpeechRecognitionEvent {
  readonly resultIndex: number
  readonly results: WebSpeechRecognitionResultList
}

export interface WebSpeechRecognitionErrorEvent {
  readonly error: string
  readonly message?: string
}

export interface WebSpeechRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null
  onerror: ((event: WebSpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export type WebSpeechRecognitionFactory = () => WebSpeechRecognition

function findRecognitionFactory(): WebSpeechRecognitionFactory | undefined {
  const browser = globalThis as typeof globalThis & {
    SpeechRecognition?: new () => WebSpeechRecognition
    webkitSpeechRecognition?: new () => WebSpeechRecognition
  }
  const Recognition =
    browser.SpeechRecognition ?? browser.webkitSpeechRecognition

  return Recognition ? () => new Recognition() : undefined
}

function normalizeErrorCode(code: string): STTErrorCode {
  switch (code) {
    case 'aborted':
    case 'audio-capture':
    case 'network':
    case 'no-speech':
    case 'not-allowed':
    case 'service-not-allowed':
      return code
    default:
      return 'unknown'
  }
}

function toSTTError(event: WebSpeechRecognitionErrorEvent): STTError {
  const code = normalizeErrorCode(event.error)
  const retryable = code !== 'not-allowed' && code !== 'service-not-allowed'
  return new STTError(
    code,
    event.message?.trim() || `Live transcription failed: ${event.error}`,
    retryable,
  )
}

export class WebSpeechSTT implements STTProvider {
  readonly id = 'web-speech-live'

  private readonly createRecognition: WebSpeechRecognitionFactory | undefined
  private active: WebSpeechRecognition | null = null

  constructor(
    createRecognition: WebSpeechRecognitionFactory | null =
      findRecognitionFactory() ?? null,
  ) {
    this.createRecognition = createRecognition ?? undefined
  }

  isAvailable(): boolean {
    return Boolean(this.createRecognition)
  }

  start(request: STTRequest, listener: STTListener): Promise<STTSession> {
    const createRecognition = this.createRecognition
    if (!createRecognition) {
      return Promise.reject(
        new SpeechCapabilityUnavailableError(
          'stt',
          'Live transcription is unavailable; the transcript can be entered manually',
        ),
      )
    }

    if (this.active) {
      return Promise.reject(
        new STTError('unknown', 'Live transcription is already running'),
      )
    }

    const recognition = createRecognition()
    recognition.lang = request.language ?? 'en-US'
    recognition.continuous = request.continuous ?? true
    recognition.interimResults = request.interimResults ?? true
    recognition.maxAlternatives = 1
    this.active = recognition

    let ended = false
    let startSettled = false

    const finish = () => {
      if (ended) {
        return
      }
      ended = true
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      if (this.active === recognition) {
        this.active = null
      }
      listener.onEnd?.()
    }

    const session: STTSession = {
      stop: () =>
        Promise.resolve().then(() => {
          if (!ended && this.active === recognition) {
            recognition.stop()
          }
        }),
      abort: () =>
        Promise.resolve().then(() => {
          if (!ended && this.active === recognition) {
            recognition.abort()
          }
        }),
    }

    return new Promise<STTSession>((resolve, reject) => {
      recognition.onstart = () => {
        if (startSettled) {
          return
        }
        startSettled = true
        resolve(session)
      }

      recognition.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const alternative = result?.[0]
          if (!result || !alternative) {
            continue
          }

          const transcript = alternative.transcript
          if (!transcript) {
            continue
          }

          const sttResult: STTResult = {
            transcript,
            isFinal: result.isFinal,
          }
          if (Number.isFinite(alternative.confidence)) {
            sttResult.confidence = alternative.confidence
          }
          listener.onResult(sttResult)
        }
      }

      recognition.onerror = (event) => {
        const error = toSTTError(event)
        listener.onError?.(error)
        if (!startSettled) {
          startSettled = true
          reject(error)
        }
      }

      recognition.onend = () => {
        if (!startSettled) {
          startSettled = true
          reject(new STTError('unknown', 'Live transcription ended before starting'))
        }
        finish()
      }

      try {
        recognition.start()
      } catch (error) {
        startSettled = true
        finish()
        reject(
          error instanceof Error
            ? error
            : new Error('Unable to start live transcription', { cause: error }),
        )
      }
    })
  }
}
