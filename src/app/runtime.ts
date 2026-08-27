import { Capacitor } from '@capacitor/core'
import {
  TTS_VOICE_CONFIG_VERSION,
  resolveTtsVoicePlaybackSettings,
  type UserPreferences,
} from '../domain'
import { AccountService } from '../application/accountService'
import { ImportMaterialService } from '../application/imports/importMaterialService'
import { PracticeService } from '../application/practiceService'
import { PersonalMaterialService } from '../application/personalMaterialService'
import { StorageBackupService } from '../application/storageBackupService'
import {
  BackendClient,
  BackendConfigStore,
  BackendHealthCache,
  BackendTextProvider,
  BackendTtsProvider,
  BrowserSessionAuthTokenStore,
  CloudAuthClient,
  CloudSyncClient,
} from '../infrastructure/backend'
import { CapacitorDocumentOcr, CapacitorSecureAuthTokenStore } from '../infrastructure/platform'
import {
  AudioCoordinator,
  type TtsPlaybackPreferences,
} from '../infrastructure/speech/audioCoordinator'
import { CapacitorSystemTTS } from '../infrastructure/speech/capacitorSystemTts'
import { FallbackTTSProvider } from '../infrastructure/speech/fallbackTtsProvider'
import { HTMLAudioPlayback } from '../infrastructure/speech/htmlAudioPlayback'
import { SystemWebSpeechTTS } from '../infrastructure/speech/systemWebSpeechTts'
import { IndexedDbStorage } from '../infrastructure/storage'

/**
 * 组合根。所有第三方 AI 能力(Text AI / AI 语音)一律经由自建 Backend;
 * 客户端不持有任何第三方 API Key。系统 TTS 保留作为本地降级能力。
 * Backend 地址可运行时配置,各 provider 的配置状态由
 * BackendHealthCache(启动时拉取 /health)驱动。
 */
export const createBrowserRuntime = () => {
  const storage = new IndexedDbStorage()
  const accountService = new AccountService({ storage })
  const systemTts = Capacitor.getPlatform() === 'android'
    ? new CapacitorSystemTTS()
    : new SystemWebSpeechTTS()
  const configStore = new BackendConfigStore(storage)
  const authTokenStore = Capacitor.getPlatform() === 'android'
    ? new CapacitorSecureAuthTokenStore()
    : new BrowserSessionAuthTokenStore()
  const backendClient = new BackendClient({
    getBaseUrl: () => configStore.getBaseUrl(),
    getAccessToken: () => authTokenStore.getToken(),
    onUnauthorized: () => authTokenStore.clearToken(),
  })
  const healthCache = new BackendHealthCache(backendClient)
  const cloudAuthClient = new CloudAuthClient({
    getBaseUrl: () => configStore.getBaseUrl(),
  })
  const cloudSyncClient = new CloudSyncClient({
    getBaseUrl: () => configStore.getBaseUrl(),
    getAccessToken: () => authTokenStore.getToken(),
    onUnauthorized: () => authTokenStore.clearToken(),
  })
  const textAi = new BackendTextProvider(backendClient, healthCache)
  const voicePlayback = new HTMLAudioPlayback()
  const voiceAi = new BackendTtsProvider(
    backendClient,
    storage,
    voicePlayback,
    healthCache,
  )
  const tts = new FallbackTTSProvider(voiceAi, systemTts)
  const playback = new HTMLAudioPlayback()
  let playbackPreferences: TtsPlaybackPreferences = {
    voiceMode: 'natural-first',
    rate: 0.92,
    pitch: 1,
  }
  const audioFocus = new AudioCoordinator(tts, playback, {
    systemTts,
    getPlaybackPreferences: () => ({
      voiceMode: playbackPreferences.voiceMode,
      rate: playbackPreferences.rate,
      pitch: playbackPreferences.pitch,
      ...(playbackPreferences.voice
        ? { voice: playbackPreferences.voice }
        : {}),
    }),
  })
  const documentOcr = Capacitor.getPlatform() === 'android'
    ? new CapacitorDocumentOcr()
    : null
  const importService = new ImportMaterialService({
    storage,
    extractor: {
      async extract(file) {
        const { MaterialExtractor } = await import(
          '../application/imports/materialExtractor'
        )
        return new MaterialExtractor(documentOcr).extract(file)
      },
    },
    getCurrentUserId: () => accountService.getCurrentUserId(),
  })
  const practiceService = new PracticeService({
    localStorage: storage,
    getCurrentUserId: () => accountService.getCurrentUserId(),
  })
  const personalMaterialService = new PersonalMaterialService({
    localStorage: storage,
    getCurrentUserId: () => accountService.getCurrentUserId(),
  })
  const backupService = new StorageBackupService(storage, storage)

  return {
    setUserPreferences: (preferences: UserPreferences) => {
      playbackPreferences = {
        voiceMode: preferences.ttsVoiceMode,
        ...resolveTtsVoicePlaybackSettings(
          preferences.ttsVoicePreset,
          preferences.ttsRate,
          preferences.ttsPitch,
        ),
      }
    },
    /** 载入账号、运行时配置并做一次非阻塞的云端健康检查。 */
    initialize: async () => {
      await accountService.initialize()
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
    accountService,
    configStore,
    healthCache,
    audioFocus,
    textAi,
    voiceAi,
    systemTts,
    backendClient,
    cloudAuthClient,
    cloudSyncClient,
    authTokenStore,
    importService,
    practiceService,
    personalMaterialService,
    backupService,
  }
}

export type BrowserRuntime = ReturnType<typeof createBrowserRuntime>
