import mammoth from 'mammoth/mammoth.browser.js'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFPageProxy } from 'pdfjs-dist'
import type {
  ImportExtractionMode,
  ImportFileFormat,
} from '../../domain'
import type { DocumentOcr } from '../../ports/document'
import { detectImportFormat, validateImportFile } from './fileTypes'

const MAX_PDF_PAGES = 80
const MIN_USEFUL_PAGE_CHARACTERS = 24
const MAX_EXTRACTED_CHARACTERS = 1_000_000
const OCR_RENDER_MAX_EDGE = 1_800

export interface ExtractedPage {
  pageNumber: number | null
  text: string
  usedOcr: boolean
}

export interface MaterialExtraction {
  format: ImportFileFormat
  mode: ImportExtractionMode
  text: string
  pages: ExtractedPage[]
  warnings: string[]
}

export class MaterialExtractor {
  constructor(private readonly ocr: DocumentOcr | null) {}

  async extract(file: File): Promise<MaterialExtraction> {
    validateImportFile(file)
    const format = detectImportFormat(file.name)

    switch (format) {
      case 'txt':
      case 'md':
        return this.extractPlainText(file, format)
      case 'docx':
        return this.extractDocx(file)
      case 'pdf':
        return this.extractPdf(file)
      case 'jpg':
      case 'png':
        return this.extractImage(file, format)
    }
  }

  private async extractPlainText(
    file: File,
    format: 'txt' | 'md',
  ): Promise<MaterialExtraction> {
    const text = normaliseExtractedText(await file.text())
    assertExtractedText(text)
    return {
      format,
      mode: 'plain-text',
      text,
      pages: [{ pageNumber: null, text, usedOcr: false }],
      warnings: [],
    }
  }

  private async extractDocx(file: File): Promise<MaterialExtraction> {
    let result: Awaited<ReturnType<typeof mammoth.extractRawText>>
    try {
      const arrayBuffer = await file.arrayBuffer()
      if (import.meta.env.MODE === 'test') {
        const [{ default: nodeMammoth }, { Buffer }] = await Promise.all([
          import('mammoth'),
          import('node:buffer'),
        ])
        result = await nodeMammoth.extractRawText({
          buffer: Buffer.from(arrayBuffer),
        })
      } else {
        result = await mammoth.extractRawText({ arrayBuffer })
      }
    } catch {
      throw new Error('Word 文件无法读取，请确认它是有效的 .docx 文件。')
    }

    const text = normaliseExtractedText(result.value)
    assertExtractedText(text)
    return {
      format: 'docx',
      mode: 'docx',
      text,
      pages: [{ pageNumber: null, text, usedOcr: false }],
      warnings: result.messages.map((message) => message.message).slice(0, 5),
    }
  }

  private async extractImage(
    file: File,
    format: 'jpg' | 'png',
  ): Promise<MaterialExtraction> {
    const ocr = this.requireOcr()
    const image = file.type.length > 0
      ? file
      : file.slice(0, file.size, format === 'png' ? 'image/png' : 'image/jpeg')
    const text = normaliseExtractedText(await ocr.recognise(image))
    assertExtractedText(text, '图片中没有识别到文字，请换一张更清晰的图片。')
    return {
      format,
      mode: 'image-ocr',
      text,
      pages: [{ pageNumber: 1, text, usedOcr: true }],
      warnings: [],
    }
  }

  private async extractPdf(file: File): Promise<MaterialExtraction> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (import.meta.env.MODE === 'test') {
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
      ;(
        globalThis as typeof globalThis & {
          pdfjsWorker?: typeof worker
        }
      ).pdfjsWorker = worker
    } else {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    }

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    })
    let pdfDocument
    try {
      pdfDocument = await loadingTask.promise
    } catch {
      await loadingTask.destroy()
      throw new Error('PDF 无法读取，可能已加密或文件已损坏。')
    }

    if (pdfDocument.numPages > MAX_PDF_PAGES) {
      await loadingTask.destroy()
      throw new Error(`PDF 超过 ${MAX_PDF_PAGES} 页，请拆分后再导入。`)
    }

    const pages: ExtractedPage[] = []
    const warnings: string[] = []

    try {
      for (
        let pageNumber = 1;
        pageNumber <= pdfDocument.numPages;
        pageNumber += 1
      ) {
        const page = await pdfDocument.getPage(pageNumber)
        const textContent = await page.getTextContent()
        let text = normaliseExtractedText(
          textContent.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' '),
        )
        let usedOcr = false

        if (countLettersAndNumbers(text) < MIN_USEFUL_PAGE_CHARACTERS) {
          if (this.ocr?.isAvailable() === true) {
            const image = await renderPdfPageToImage(page)
            text = normaliseExtractedText(await this.ocr.recognise(image))
            usedOcr = true
          } else if (text.length === 0) {
            warnings.push(`第 ${pageNumber} 页像是扫描页，但当前设备不支持本地 OCR。`)
          }
        }

        pages.push({ pageNumber, text, usedOcr })
        page.cleanup()
      }
    } finally {
      await loadingTask.destroy()
    }

    const text = normaliseExtractedText(
      pages
        .filter((page) => page.text.length > 0)
        .map((page) => `--- 第 ${page.pageNumber ?? 1} 页 ---\n${page.text}`)
        .join('\n\n'),
    )
    assertExtractedText(
      text,
      'PDF 中没有提取到文字；若它是扫描件，请在 Android 设备上重试 OCR。',
    )

    const ocrPageCount = pages.filter((page) => page.usedOcr).length
    const mode: ImportExtractionMode =
      ocrPageCount === 0
        ? 'pdf-text'
        : ocrPageCount === pages.length
          ? 'pdf-ocr'
          : 'pdf-mixed'

    return { format: 'pdf', mode, text, pages, warnings }
  }

  private requireOcr(): DocumentOcr {
    if (this.ocr === null || !this.ocr.isAvailable()) {
      throw new Error('图片 OCR 需要在 Android 设备上使用。')
    }
    return this.ocr
  }
}

async function renderPdfPageToImage(
  page: PDFPageProxy,
): Promise<Blob> {
  const initialViewport = page.getViewport({ scale: 1 })
  const scale = Math.min(
    2,
    OCR_RENDER_MAX_EDGE / Math.max(initialViewport.width, initialViewport.height),
  )
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))

  await page.render({ canvas, viewport }).promise
  const blob = await canvasToBlob(canvas)
  canvas.width = 1
  canvas.height = 1
  return blob
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('无法渲染 PDF 扫描页。'))
        return
      }
      resolve(blob)
    }, 'image/jpeg', 0.9)
  })
}

function normaliseExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, MAX_EXTRACTED_CHARACTERS)
}

function assertExtractedText(
  text: string,
  message = '文件中没有可导入的文字。',
): void {
  if (text.trim().length === 0) {
    throw new Error(message)
  }
}

function countLettersAndNumbers(text: string): number {
  return Array.from(text).filter((character) => /[\p{L}\p{N}]/u.test(character))
    .length
}
