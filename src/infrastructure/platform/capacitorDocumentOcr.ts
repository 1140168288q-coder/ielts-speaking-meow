import { Capacitor, registerPlugin } from '@capacitor/core'
import type { DocumentOcr } from '../../ports/document'

const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png'])

export interface DocumentOcrPluginContract {
  recognizeBase64(options: {
    dataUrl: string
  }): Promise<{ text: string }>
}

const nativeDocumentOcr = registerPlugin<DocumentOcrPluginContract>('DocumentOcr')

/** Android adapter for the bundled, offline Latin-script document OCR plugin. */
export class CapacitorDocumentOcr implements DocumentOcr {
  constructor(
    private readonly plugin: DocumentOcrPluginContract = nativeDocumentOcr,
  ) {}

  isAvailable(): boolean {
    return Capacitor.getPlatform() === 'android'
  }

  async recognise(image: Blob): Promise<string> {
    if (image.size === 0) {
      throw new Error('An image is required for OCR.')
    }
    if (image.size > MAX_IMAGE_BYTES) {
      throw new Error('The OCR image exceeds the 16 MB limit.')
    }
    if (!SUPPORTED_IMAGE_TYPES.has(image.type.toLowerCase())) {
      throw new Error('Only JPG and PNG images are supported for OCR.')
    }

    return this.recognizeBase64(await blobToDataUrl(image))
  }

  async recognizeBase64(dataUrl: string): Promise<string> {
    if (dataUrl.trim().length === 0) {
      throw new Error('An image is required for OCR.')
    }

    const result = await this.plugin.recognizeBase64({ dataUrl })
    if (typeof result.text !== 'string') {
      throw new Error('Document OCR returned an invalid response.')
    }
    return result.text
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    const chunks: string[] = []
    const chunkSize = 0x8000

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      chunks.push(
        String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
      )
    }

    return `data:${blob.type};base64,${btoa(chunks.join(''))}`
  })
}
