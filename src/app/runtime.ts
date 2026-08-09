import { Capacitor } from '@capacitor/core'
import { ApiConfigurationService } from '../application/apiConfigurationService'
import {
  ImportMaterialService,
  MaterialExtractor,
} from '../application/imports'
import { PracticeService } from '../application/practiceService'
import { CapacitorApiTransport } from '../infrastructure/ai/apiTransport'
import { OpenAICompatibleSttProvider } from '../infrastructure/ai/openAiCompatibleSttProvider'
import { OpenAICompatibleTextProvider } from '../infrastructure/ai/openAiCompatibleTextProvider'
import {
  CapacitorDocumentOcr,
  CapacitorSecureSecretStorage,
  MemorySecureSecretStorage,
} from '../infrastructure/platform'
import { AudioCoordinator } from '../infrastructure/speech/audioCoordinator'
import { CapacitorSystemTTS } from '../infrastructure/speech/capacitorSystemTts'
import { FallbackTTSProvider } from '../infrastructure/speech/fallbackTtsProvider'
import { HTMLAudioPlayback } from '../infrastructure/speech/htmlAudioPlayback'
import { MediaRecorderAdapter } from '../infrastructure/speech/mediaRecorderAdapter'
import { OpenAICompatibleTtsProvider } from '../infrastructure/speech/openAiCompatibleTtsProvider'
import { SystemWebSpeechTTS } from '../infrastructure/speech/systemWebSpeechTts'
import { WebSpeechSTT } from '../infrastructure/speech/webSpeechStt'
import { IndexedDbStorage } from '../infrastructure/storage'

export const createBrowserRuntime = () => {
  const storage = new IndexedDbStorage()
  const systemTts = Capacitor.getPlatform() === 'android'
    ? new CapacitorSystemTTS()
    : new SystemWebSpeechTTS()
  const secureSecrets = Capacitor.getPlatform() === 'android'
    ? new CapacitorSecureSecretStorage()
    : new MemorySecureSecretStorage()
  const apiSettings = new ApiConfigurationService(storage, secureSecrets)
  const apiTransport = new CapacitorApiTransport()
  const textAi = new OpenAICompatibleTextProvider(apiSettings, apiTransport)
  const remoteStt = new OpenAICompatibleSttProvider(apiSettings, apiTransport)
  const voicePlayback = new HTMLAudioPlayback()
  const voiceAi = new OpenAICompatibleTtsProvider(
    apiSettings,
    apiTransport,
    storage,
    voicePlayback,
  )
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
    initialize: () => apiSettings.initialize(),
    storage,
    audioFocus,
    stt,
    remoteStt,
    textAi,
    voiceAi,
    apiSettings,
    importService,
    practiceService,
  }
}

export type BrowserRuntime = ReturnType<typeof createBrowserRuntime>
