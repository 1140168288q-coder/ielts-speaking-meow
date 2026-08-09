import { z } from 'zod'
import type { ApiConfigurationService } from '../../application/apiConfigurationService'
import type {
  RecordedAudioSTTProvider,
  RecordedAudioSTTRequest,
} from '../../ports/speech'
import type { ApiTransport } from './apiTransport'
import { joinEndpoint } from './openAiCompatibleTextProvider'
import {
  ApiProviderError,
  assertSuccessfulStatus,
  mapTransportFailure,
} from './providerErrors'

const transcriptionResponseSchema = z
  .object({
    text: z.string().max(20_000),
  })
  .passthrough()

export class OpenAICompatibleSttProvider
  implements RecordedAudioSTTProvider
{
  readonly id = 'openai-compatible-stt'

  constructor(
    private readonly settings: ApiConfigurationService,
    private readonly transport: ApiTransport,
  ) {}

  isConfigured(): boolean {
    return this.settings.getStatus('stt').configured
  }

  async transcribe(request: RecordedAudioSTTRequest): Promise<string> {
    const status = this.settings.getStatus('stt')
    const configuration = status.configuration
    const key = await this.settings.getSecret('stt')
    if (!status.configured || configuration?.id !== 'stt' || key === null) {
      throw new ApiProviderError('not-configured', 'STT API 尚未配置。', false)
    }

    const response = await mapTransportFailure(() =>
      this.transport.postMultipart(
        joinEndpoint(configuration.endpoint, 'audio/transcriptions'),
        key,
        {
          model: configuration.model,
          ...(request.language === undefined
            ? {}
            : { language: request.language }),
          response_format: 'json',
        },
        {
          fieldName: 'file',
          fileName: request.fileName,
          mimeType: request.mimeType,
          data: request.audio,
        },
        90_000,
      ),
    )
    assertSuccessfulStatus(response.status)
    const parsed = transcriptionResponseSchema.safeParse(response.data)
    if (!parsed.success || parsed.data.text.trim().length === 0) {
      throw new ApiProviderError(
        'invalid-response',
        'STT 返回内容无效，原录音已保留，可重试或手动输入。',
        true,
      )
    }
    return parsed.data.text
  }

  async testConnection(): Promise<void> {
    try {
      await this.transcribe({
        audio: createSilentWav(),
        mimeType: 'audio/wav',
        fileName: 'connection-check.wav',
        language: 'en',
      })
    } catch (error) {
      if (error instanceof ApiProviderError && error.code === 'invalid-response') {
        return
      }
      throw error
    }
  }
}

function createSilentWav(): Blob {
  const sampleRate = 8_000
  const sampleCount = sampleRate / 2
  const bytes = new ArrayBuffer(44 + sampleCount * 2)
  const view = new DataView(bytes)
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + sampleCount * 2, true)
  writeAscii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, sampleCount * 2, true)
  return new Blob([bytes], { type: 'audio/wav' })
}
