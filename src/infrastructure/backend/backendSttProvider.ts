import { z } from 'zod'
import type {
  RecordedAudioSTTProvider,
  RecordedAudioSTTRequest,
} from '../../ports/speech'
import { ApiProviderError } from '../ai/providerErrors'
import { blobToWav16kMono } from '../speech/audioToWav'
import type { BackendClient } from './backendClient'

const transcriptionResponseSchema = z
  .object({
    text: z.string().max(20_000),
  })
  .passthrough()

const STT_TIMEOUT_MS = 180_000

/**
 * 录音转写通过自建 Backend 调用(Backend 内部再调火山流式语音识别)。
 * 上传前先把 webm/mp4 录音转成 16kHz WAV;失败时原录音已保存在本机。
 */
export class BackendSttProvider implements RecordedAudioSTTProvider {
  readonly id = 'backend-stt'

  constructor(
    private readonly client: BackendClient,
    private readonly toWav: (blob: Blob) => Promise<Blob> = blobToWav16kMono,
  ) {}

  isConfigured(): boolean {
    return true
  }

  async transcribe(request: RecordedAudioSTTRequest): Promise<string> {
    const wav = await this.toWav(request.audio)
    const data = await this.client.postMultipartJson<unknown>(
      '/v1/stt',
      request.language === undefined ? {} : { language: request.language },
      {
        fieldName: 'file',
        fileName: 'audio.wav',
        mimeType: 'audio/wav',
        data: wav,
      },
      STT_TIMEOUT_MS,
    )
    const parsed = transcriptionResponseSchema.safeParse(data)
    if (!parsed.success || parsed.data.text.trim().length === 0) {
      throw new ApiProviderError(
        'invalid-response',
        '云端转写返回内容无效,原录音已保留,可重试或手动输入。',
        true,
      )
    }
    return parsed.data.text
  }
}
