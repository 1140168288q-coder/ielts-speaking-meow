export class DocumentOcrUnavailableError extends Error {
  constructor(message = 'Document OCR is unavailable on this device.') {
    super(message)
    this.name = 'DocumentOcrUnavailableError'
  }
}

/** Local OCR boundary. Imported images must not be uploaded implicitly. */
export interface DocumentOcr {
  isAvailable(): boolean
  recognise(image: Blob): Promise<string>
}
