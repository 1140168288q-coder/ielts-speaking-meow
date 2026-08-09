import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  SpeechCapabilityUnavailableError,
  type TTSCapabilities,
  type TTSProvider,
  type TTSRequest,
} from '../../ports/speech'

interface NativeSystemTTSPlugin {
  speak(options: {
    text: string
    language: string
    rate: number
    pitch: number
  }): Promise<void>
  stop(): Promise<void>
}

const NativeSystemTTS = registerPlugin<NativeSystemTTSPlugin>('SystemTTS')

const capabilities: TTSCapabilities = {
  language: true,
  voice: false,
  rate: true,
  pitch: true,
  style: false,
}

/** Android's local TextToSpeech engine exposed through a tiny app-local plugin. */
export class CapacitorSystemTTS implements TTSProvider {
  readonly id = 'android-system-tts'
  readonly capabilities = capabilities

  constructor(
    private readonly plugin: NativeSystemTTSPlugin = NativeSystemTTS,
    private readonly isAndroid: () => boolean = () =>
      Capacitor.getPlatform() === 'android',
  ) {}

  isAvailable(): boolean {
    return this.isAndroid()
  }

  async speak(request: TTSRequest): Promise<void> {
    if (!this.isAvailable()) {
      throw new SpeechCapabilityUnavailableError(
        'tts',
        'Android System TTS is unavailable on this platform',
      )
    }

    const text = request.text.trim()
    if (!text) {
      throw new TypeError('TTS text must not be empty')
    }

    await this.plugin.speak({
      text,
      language: request.language ?? 'en-US',
      rate: Math.min(2, Math.max(0.1, request.rate ?? 1)),
      pitch: Math.min(2, Math.max(0.1, request.pitch ?? 1)),
    })
  }

  async stop(): Promise<void> {
    if (this.isAvailable()) {
      await this.plugin.stop()
    }
  }
}
