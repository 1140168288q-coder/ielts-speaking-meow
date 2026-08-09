import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ieltsspeakingmeow.app',
  appName: '雅思口语喵',
  webDir: 'dist',
  loggingBehavior: 'none',
  android: {
    allowMixedContent: false,
  },
}

export default config
