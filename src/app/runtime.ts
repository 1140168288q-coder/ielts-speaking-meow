import { Capacitor } from '@capacitor/core'
import { TTS_VOICE_CONFIG_VERSION } from '../domain'
import {
  ImportMaterialService,
  MaterialExtractor,
} from '../application/imports'
import { PracticeService } from '../application/practiceService'
import { StorageBackupService } from '../application/storageBackupService'
import {
  BackendClient,
  BackendConfigStore,
  BackendHealthCache,
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
import { WebAudioSignalAnalyzer } from '../infrastructure/speech/webAudioSignalAnalyzer'
import { IndexedDbStorage } from '../infrastructure/storage'

/**
 * 组合根。所有第三方 AI 能力(Text AI / 远程 STT / AI 语音)一律经由自建
 * Backend;客户端不持有任何第三方 API Key。系统 TTS 与 Web Speech STT
 * 保留作为本地降级能力。Backend 地址可运行时配置,各 provider
 * 的配置状态由 BackendHealthCache(启动时拉取 /health)驱动。
 */
export const createBrowserRuntime = () => {
  const storage = new IndexedDbStorage()
  const systemTts = Capacitor.getPlatform() === 'android'
    ? new CapacitorSystemTTS()
    : new SystemWebSpeechTTS()
  const configStore = new BackendConfigStore(storage)
  const backendClient = new BackendClient({
    getBaseUrl: () => configStore.getBaseUrl(),
  })
  const healthCache = new BackendHealthCache(backendClient)
  const textAi = new BackendTextProvider(backendClient, healthCache)
  const remoteStt = new BackendSttProvider(backendClient, undefined, healthCache)
  const voicePlayback = new HTMLAudioPlayback()
  const voiceAi = new BackendTtsProvider(
    backendClient,
    storage,
    voicePlayback,
    healthCache,
  )
  const tts = new FallbackTTSProvider(voiceAi, systemTts)
  const recorder = new MediaRecorderAdapter()
  const audioAnalyzer = new WebAudioSignalAnalyzer()
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
    audioAnalyzer,
  })
  const backupService = new StorageBackupService(storage, storage)

  return {
    /** 载入运行时配置并做一次非阻塞的云端健康检查。 */
    initialize: async () => {
      await configStore.load()
      // V1.5 缓存键结构升级:清理一次旧 AI TTS 缓存,避免旧音色音频继续命中
      try {
        const storedVoiceConfigVersion = await storage.getVoiceConfigVersion()
        if (storedVoiceConfigVersion !== TTS_VOICE_CONFIG_VERSION) {
          await storage.clearTtsCache()
          await storage.setVoiceConfigVersion(TTS_VOICE_CONFIG_VERSION)
        }
      } catch {
        // 清理失败只影响缓存新鲜度,不阻塞启动
      }
      void healthCache.refresh()
    },
    storage,
    configStore,
    healthCache,
    audioFocus,
    stt,
    remoteStt,
    textAi,
    voiceAi,
    systemTts,
    backendClient,
    importService,
    practiceService,
    backupService,
  }
}

export type BrowserRuntime = ReturnType<typeof createBrowserRuntime>
