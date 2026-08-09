import type { ApiProviderOptions } from './types'

export const DEFAULT_API_PROVIDER_OPTIONS: ApiProviderOptions = {
  'text-ai': [
    {
      value: '',
      label: '未配置（使用本地反馈）',
      mode: 'disabled',
      description: '不调用外部 Text AI，练习仍会显示本地分析。',
    },
    {
      value: 'openai-compatible',
      label: 'OpenAI-compatible API',
      mode: 'remote',
      description: '使用独立 Endpoint、模型和密钥获取有限语言反馈。',
    },
  ],
  stt: [
    {
      value: '',
      label: '未配置（保留系统降级）',
      mode: 'disabled',
      description: '设备识别不可用时，录音照常保存并允许手工输入转写。',
    },
    {
      value: 'openai-compatible',
      label: 'OpenAI-compatible API',
      mode: 'remote',
      description: '使用与 Text AI、Voice AI 完全独立的转写配置。',
    },
  ],
  'voice-ai': [
    {
      value: '',
      label: '未配置（使用 Android 系统 TTS）',
      mode: 'disabled',
      description: '无需密钥；题目和表达继续使用 Android 系统语音。',
    },
    {
      value: 'openai-compatible',
      label: 'OpenAI-compatible API',
      mode: 'remote',
      description: '使用独立的 Voice AI Endpoint、模型、声音和密钥。',
    },
  ],
}
