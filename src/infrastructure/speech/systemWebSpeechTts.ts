import {
  SpeechCapabilityUnavailableError,
  type SystemTTSProvider,
  type SystemTtsStatus,
  type TTSCapabilities,
  type TTSRequest,
} from '../../ports/speech'

export interface WebSpeechVoice {
  readonly name: string
  readonly lang: string
}

export interface WebSpeechUtterance {
  text: string
  lang: string
  voice: WebSpeechVoice | null
  rate: number
  pitch: number
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
}

export interface WebSpeechSynthesis {
  speak(utterance: WebSpeechUtterance): void
  cancel(): void
  getVoices(): readonly WebSpeechVoice[]
}

export interface SystemWebSpeechTTSDependencies {
  /** Pass null to explicitly disable browser auto-detection (useful in tests). */
  synthesis?: WebSpeechSynthesis | null
  createUtterance?: ((text: string) => WebSpeechUtterance) | null
}

interface ActiveUtterance {
  utterance: WebSpeechUtterance
  resolve: () => void
  reject: (reason: unknown) => void
}

const capabilities: TTSCapabilities = {
  language: true,
  voice: true,
  rate: true,
  pitch: true,
  style: false,
}

function findBrowserDependencies(): Required<SystemWebSpeechTTSDependencies> | null {
  const browser = globalThis as typeof globalThis & {
    speechSynthesis?: SpeechSynthesis
    SpeechSynthesisUtterance?: new (text?: string) => SpeechSynthesisUtterance
  }

  if (!browser.speechSynthesis || !browser.SpeechSynthesisUtterance) {
    return null
  }

  const synthesis = browser.speechSynthesis
  const Utterance = browser.SpeechSynthesisUtterance

  return {
    synthesis: {
      speak: (utterance) => {
        synthesis.speak(utterance as SpeechSynthesisUtterance)
      },
      cancel: () => {
        synthesis.cancel()
      },
      getVoices: () => synthesis.getVoices(),
    },
    createUtterance: (text) =>
      new Utterance(text) as unknown as WebSpeechUtterance,
  }
}

export class SystemWebSpeechTTS implements SystemTTSProvider {
  readonly id = 'system-web-speech'
  readonly capabilities = capabilities

  private readonly synthesis: WebSpeechSynthesis | undefined
  private readonly createUtterance:
    | ((text: string) => WebSpeechUtterance)
    | undefined
  private active: ActiveUtterance | null = null

  constructor(dependencies: SystemWebSpeechTTSDependencies = {}) {
    const browserDependencies = findBrowserDependencies()
    const configuredSynthesis = dependencies.synthesis
    const configuredUtteranceFactory = dependencies.createUtterance
    this.synthesis =
      configuredSynthesis === null
        ? undefined
        : (configuredSynthesis ?? browserDependencies?.synthesis ?? undefined)
    this.createUtterance =
      configuredUtteranceFactory === null
        ? undefined
        : (configuredUtteranceFactory ??
          browserDependencies?.createUtterance ??
          undefined)
  }

  isAvailable(): boolean {
    return Boolean(this.synthesis && this.createUtterance)
  }

  /** 浏览器端没有独立引擎概念:可用即视为内置英文语音可用。 */
  getStatus(): Promise<SystemTtsStatus> {
    const available = this.isAvailable()
    return Promise.resolve({
      available,
      engine: available ? 'Web Speech API' : null,
      engines: [],
      englishAvailable: available,
    })
  }

  async speak(request: TTSRequest): Promise<void> {
    const synthesis = this.synthesis
    const createUtterance = this.createUtterance

    if (!synthesis || !createUtterance) {
      throw new SpeechCapabilityUnavailableError(
        'tts',
        'System speech synthesis is unavailable',
      )
    }

    if (!request.text.trim()) {
      throw new TypeError('TTS text must not be empty')
    }

    await this.stop()

    const utterance = createUtterance(request.text)
    if (request.language) {
      utterance.lang = request.language
    }
    if (request.rate !== undefined) {
      utterance.rate = Math.min(10, Math.max(0.1, request.rate))
    }
    if (request.pitch !== undefined) {
      utterance.pitch = Math.min(2, Math.max(0, request.pitch))
    }

    const voices = synthesis.getVoices()
    const requestedVoice = request.voice
      ? voices.find((voice) => voice.name === request.voice)
      : undefined
    const languageVoice =
      !requestedVoice && request.language
        ? voices.find((voice) =>
            voice.lang.toLowerCase().startsWith(request.language!.toLowerCase()),
          )
        : undefined
    const selectedVoice = requestedVoice ?? languageVoice
    if (selectedVoice) {
      utterance.voice = selectedVoice
    }

    return new Promise<void>((resolve, reject) => {
      const active: ActiveUtterance = { utterance, resolve, reject }
      this.active = active

      utterance.onend = () => {
        this.settle(active, 'resolve')
      }
      utterance.onerror = (event) => {
        const code = event.error ?? 'unknown'
        if (code === 'canceled' || code === 'interrupted') {
          this.settle(active, 'resolve')
          return
        }
        this.settle(active, 'reject', new Error(`System TTS failed: ${code}`))
      }

      try {
        synthesis.speak(utterance)
      } catch (error) {
        this.settle(active, 'reject', error)
      }
    })
  }

  stop(): Promise<void> {
    const active = this.active
    if (!active) {
      return Promise.resolve()
    }

    this.synthesis?.cancel()
    this.settle(active, 'resolve')
    return Promise.resolve()
  }

  private settle(
    active: ActiveUtterance,
    outcome: 'resolve' | 'reject',
    reason?: unknown,
  ): void {
    if (this.active !== active) {
      return
    }

    active.utterance.onend = null
    active.utterance.onerror = null
    this.active = null

    if (outcome === 'resolve') {
      active.resolve()
    } else {
      active.reject(reason)
    }
  }
}
