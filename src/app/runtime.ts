import { Capacitor } from '@capacitor/core'
import {
  ImportMaterialService,
  MaterialExtractor,
} from '../application/imports'
import { PracticeService } from '../application/practiceService'
import {
  BackendClient,
  BackendSttProvider,
  BackendTextProvider,
  BackendTtsProvider,
} from '../infrastructure/backend'
import { CapacitorDocumentOcr } from '../infrastructure/platform'
import { AudioCoordinator } from '../infrastructure/speech/audioCoordinator'
import { CapacitorSystemTTS } from '../infrastructure/speech/capacitorSystemTts'
import { FallbackTTSProvider } from '../infrastructure/speech/fallbackTtsProvider'
import { HTMLAudioPlayback } from '../infrastructure/speech/htmlAudioPlayback'
import { MediaRecorderAdapter } from '../infrastructure/speech/mediaRecorderAdapter'
import { SystemWebSpeechTTS } from '../infrastructure/speech/systemWebSpeechTts'
import { WebSpeechSTT } from '../infrastructure/speech/webSpeechStt'
import { IndexedDbStorage } from '../infrastructure/storage'

/**
 * 组合根。所有第三方 AI 能力(Text AI / 远程 STT / AI 语音)一律经由自建
 * Backend;客户端不持有任何第三方 API Key。系统 TTS 与 Web Speech STT
 * 保留作为本地降级能力。
 */
export const createBrowserRuntime = () => {
  const storage = new IndexedDbStorage()
  const systemTts = Capacitor.getPlatform() === 'android'
    ? new CapacitorSystemTTS()
    : new SystemWebSpeechTTS()
  const backendClient = new BackendClient()
  const textAi = new BackendTextProvider(backendClient)
  const remoteStt = new BackendSttProvider(backendClient)
  const voicePlayback = new HTMLAudioPlayback()
  const voiceAi = new BackendTtsProvider(backendClient, storage, voicePlayback)
  const tts = new FallbackTTSProvider(voiceAi, systemTts)
  const recorder = new MediaRecorderAdapter()
  const playback = new HTMLAudioPlayback()
  const audioFocus = new AudioCoordinator(tts, recorder, playback)
  const stt = new WebSpeechSTT()
  const documentOcr = Capacitor.getPlatform() === 'android'
    ? new CapacitorDocumentOcr()
    : null
  const importService = new ImportMaterialService({
    storage,
    extractor: new MaterialExtractor(documentOcr),
  })
  const practiceService = new PracticeService({
    localStorage: storage,
    audioStorage: storage,
  })

  return {
    initialize: async () => {},
    storage,
    audioFocus,
    stt,
    remoteStt,
    textAi,
    voiceAi,
    backendClient,
    importService,
    practiceService,
  }
}

export type BrowserRuntime = ReturnType<typeof createBrowserRuntime>
