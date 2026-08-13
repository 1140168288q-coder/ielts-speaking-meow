import { ApiProviderError } from '../ai/providerErrors'

/**
 * 把 WebView 录制的 webm/mp4 转成火山 STT 支持的 WAV(16kHz 单声道 16bit PCM)。
 * 纯 Web Audio 实现,无额外依赖;转换失败时抛出可识别错误,原录音仍保留。
 */
export async function blobToWav16kMono(blob: Blob): Promise<Blob> {
  const AudioContextConstructor =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (AudioContextConstructor === undefined) {
    throw new ApiProviderError(
      'invalid-response',
      '当前设备不支持录音转码,原录音已保留,可手动输入转写。',
      false,
    )
  }

  const context = new AudioContextConstructor()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const decoded = await context.decodeAudioData(arrayBuffer)

    const sampleRate = 16_000
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * sampleRate) + 1,
      sampleRate,
    )
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()

    const samples = rendered.getChannelData(0)
    const bytes = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(bytes)
    writeAscii(view, 0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    writeAscii(view, 8, 'WAVEfmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeAscii(view, 36, 'data')
    view.setUint32(40, samples.length * 2, true)

    let offset = 44
    for (const sample of samples) {
      const clamped = Math.max(-1, Math.min(1, sample))
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
      offset += 2
    }
    return new Blob([bytes], { type: 'audio/wav' })
  } catch (error) {
    if (error instanceof ApiProviderError) {
      throw error
    }
    throw new ApiProviderError(
      'invalid-response',
      '录音转码失败,原录音已保留,可手动输入转写。',
      false,
    )
  } finally {
    void context.close().catch(() => undefined)
  }
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}
