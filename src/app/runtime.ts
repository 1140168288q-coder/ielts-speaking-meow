import { Capacitor } from '@capacitor/core'
import { PracticeService } from '../application/practiceService'
import { AudioCoordinator } from '../infrastructure/speech/audioCoordinator'
import { CapacitorSystemTTS } from '../infrastructure/speech/capacitorSystemTts'
import { HTMLAudioPlayback } from '../infrastructure/speech/htmlAudioPlayback'
import { MediaRecorderAdapter } from '../infrastructure/speech/mediaRecorderAdapter'
import { SystemWebSpeechTTS } from '../infrastructure/speech/systemWebSpeechTts'
import { WebSpeechSTT } from '../infrastructure/speech/webSpeechStt'
import { IndexedDbStorage } from '../infrastructure/storage'

export const createBrowserRuntime = () => {
  const storage = new IndexedDbStorage()
  const systemTts = Capacitor.getPlatform() === 'android'
    ? new CapacitorSystemTTS()
    : new SystemWebSpeechTTS()
  const recorder = new MediaRecorderAdapter()
  const playback = new HTMLAudioPlayback()
  const audioFocus = new AudioCoordinator(systemTts, recorder, playback)
  const stt = new WebSpeechSTT()
  const practiceService = new PracticeService({
    localStorage: storage,
    audioStorage: storage,
  })

  return {
    storage,
    audioFocus,
    stt,
    practiceService,
  }
}

export type BrowserRuntime = ReturnType<typeof createBrowserRuntime>
