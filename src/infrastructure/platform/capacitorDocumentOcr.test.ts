import { describe, expect, it, vi } from 'vitest'
import {
  CapacitorDocumentOcr,
  type DocumentOcrPluginContract,
} from './capacitorDocumentOcr'

describe('CapacitorDocumentOcr', () => {
  it('returns text from the native OCR result', async () => {
    const plugin: DocumentOcrPluginContract = {
      recognizeBase64: vi.fn().mockResolvedValue({ text: 'Part 1\nHome' }),
    }

    await expect(
      new CapacitorDocumentOcr(plugin).recognizeBase64(
        'data:image/png;base64,ZmFrZQ==',
      ),
    ).resolves.toBe('Part 1\nHome')
  })

  it('implements the Blob-based document OCR port', async () => {
    const recognizeBase64 = vi
      .fn()
      .mockResolvedValue({ text: 'Where do you live?' })
    const plugin: DocumentOcrPluginContract = { recognizeBase64 }
    const ocr = new CapacitorDocumentOcr(plugin)

    await expect(
      ocr.recognise(new window.Blob(['fake'], { type: 'image/png' })),
    ).resolves.toBe('Where do you live?')
    expect(recognizeBase64).toHaveBeenCalledWith({
      dataUrl: 'data:image/png;base64,ZmFrZQ==',
    })
  })

  it('rejects an invalid native response', async () => {
    const plugin = {
      recognizeBase64: vi.fn().mockResolvedValue({ text: 42 }),
    } as unknown as DocumentOcrPluginContract

    await expect(
      new CapacitorDocumentOcr(plugin).recognizeBase64('ZmFrZQ=='),
    ).rejects.toThrow('invalid response')
  })

  it('does not invoke native OCR for empty input', async () => {
    const recognizeBase64 = vi.fn()
    const plugin: DocumentOcrPluginContract = { recognizeBase64 }

    await expect(
      new CapacitorDocumentOcr(plugin).recognizeBase64('   '),
    ).rejects.toThrow('required')
    expect(recognizeBase64).not.toHaveBeenCalled()
  })

  it('rejects unsupported Blob types before crossing the native bridge', async () => {
    const recognizeBase64 = vi.fn()
    const plugin: DocumentOcrPluginContract = { recognizeBase64 }

    await expect(
      new CapacitorDocumentOcr(plugin).recognise(
        new window.Blob(['fake'], { type: 'application/pdf' }),
      ),
    ).rejects.toThrow('Only JPG and PNG')
    expect(recognizeBase64).not.toHaveBeenCalled()
  })
})
