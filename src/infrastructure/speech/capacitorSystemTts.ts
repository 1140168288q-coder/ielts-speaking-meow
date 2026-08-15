import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  SpeechCapabilityUnavailableError,
  type SystemTTSProvider,
  type SystemTtsStatus,
  type TTSCapabilities,
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
  status(): Promise<{
    available: boolean
    engine: string | null
    engines: Array<{ name: string; label: string | null }>
    englishAvailable: boolean
  }>
}

const NativeSystemTTS = registerPlugin<NativeSystemTTSPlugin>('SystemTTS')

const capabilities: TTSCapabilities = {
  language: true,
  voice: false,
  rate: true,
  pitch: true,
  style: false,
}

const UNAVAILABLE_STATUS: SystemTtsStatus = {
  available: false,
  engine: null,
  engines: [],
  englishAvailable: false,
}

/** Android's local TextToSpeech engine exposed through a tiny app-local plugin. */
export class CapacitorSystemTTS implements SystemTTSProvider {
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

  /**
   * 读取本机 TTS 引擎与英语语音包状态,用于设置页展示与测试。
   * 插件不可用时返回全 false,绝不抛出。
   */
  async getStatus(): Promise<SystemTtsStatus> {
    if (!this.isAvailable()) {
      return UNAVAILABLE_STATUS
    }
    try {
      const status = await this.plugin.status()
      return {
        available: status.available === true,
        engine: status.engine ?? null,
        engines: Array.isArray(status.engines) ? status.engines : [],
        englishAvailable: status.englishAvailable === true,
      }
    } catch {
      return UNAVAILABLE_STATUS
    }
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
