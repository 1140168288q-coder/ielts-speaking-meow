import type { ImportFileFormat } from '../../domain'
import type { DocumentOcr } from '../../ports/document'
import {
  createCorruptImportFileFixture,
  createFile,
  createImportFileFixture,
  SYNTHETIC_QUESTION,
} from '../../test/fixtures/importFiles'
import { MaterialExtractor } from './materialExtractor'

afterEach(() => vi.unstubAllGlobals())

function createOcr(text = `Part 1\nTopic: Home\n${SYNTHETIC_QUESTION}`) {
  const recognise = vi.fn(() => Promise.resolve(text))
  const ocr: DocumentOcr = {
    isAvailable: () => true,
    recognise,
  }
  return { ocr, recognise }
}

describe('MaterialExtractor supported formats', () => {
  it.each([
    ['txt', 'plain-text'],
    ['md', 'plain-text'],
    ['docx', 'docx'],
    ['pdf', 'pdf-text'],
    ['jpg', 'image-ocr'],
    ['png', 'image-ocr'],
  ] as const)(
    'extracts a synthetic %s fixture through the %s path',
    async (format, expectedMode) => {
      const { ocr, recognise } = createOcr()
      const file = createImportFileFixture(format)

      const extraction = await new MaterialExtractor(ocr).extract(file)

      expect(extraction).toMatchObject({
        format,
        mode: expectedMode,
      })
      expect(extraction.text).toContain(SYNTHETIC_QUESTION)
      expect(extraction.pages).toHaveLength(1)
      expect(extraction.pages[0]?.usedOcr).toBe(
        format === 'jpg' || format === 'png',
      )
      if (format === 'jpg' || format === 'png') {
        expect(recognise).toHaveBeenCalledOnce()
        expect(recognise).toHaveBeenCalledWith(file)
      } else {
        expect(recognise).not.toHaveBeenCalled()
      }
    },
  )

  it('normalises Windows newlines and repeated horizontal whitespace', async () => {
    const file = createFile(
      ['Part 1\r\nTopic:\tHome\r\nWhat  do  you like about your home?'],
      'windows.txt',
      'text/plain',
    )

    const extraction = await new MaterialExtractor(null).extract(file)

    expect(extraction.text).toBe(
      'Part 1\nTopic: Home\nWhat do you like about your home?',
    )
  })

  it('never uploads an image while local OCR is running', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { ocr } = createOcr()

    await new MaterialExtractor(ocr).extract(createImportFileFixture('png'))

    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires the Android local OCR capability for image inputs', async () => {
    await expect(
      new MaterialExtractor(null).extract(createImportFileFixture('jpg')),
    ).rejects.toThrow('图片 OCR 需要在 Android 设备上使用')
  })
})

describe('MaterialExtractor damaged input isolation', () => {
  it.each([
    ['docx', 'Word 文件无法读取'],
    ['pdf', 'PDF 无法读取'],
  ] as const)('rejects a corrupt %s container', async (format, message) => {
    await expect(
      new MaterialExtractor(null).extract(
        createCorruptImportFileFixture(format),
      ),
    ).rejects.toThrow(message)
  })

  it.each(['jpg', 'png'] as const)(
    'surfaces local OCR failure for a damaged %s without a network fallback',
    async (format) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      const ocr: DocumentOcr = {
        isAvailable: () => true,
        recognise: () => Promise.reject(new Error('Local OCR decode failed.')),
      }

      await expect(
        new MaterialExtractor(ocr).extract(
          createCorruptImportFileFixture(format),
        ),
      ).rejects.toThrow('Local OCR decode failed.')
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['txt', 'md'] as const)(
    'rejects a whitespace-only %s document as having no importable text',
    async (format) => {
      const file = createFile(
        [' \r\n\t '],
        `blank.${format}`,
        format === 'txt' ? 'text/plain' : 'text/markdown',
      )

      await expect(new MaterialExtractor(null).extract(file)).rejects.toThrow(
        '文件中没有可导入的文字',
      )
    },
  )

  it('does not treat a JPEG alias as a seventh storage format', async () => {
    const { ocr } = createOcr()
    const jpg = createImportFileFixture('jpg')
    const jpeg = Object.assign(jpg, { name: 'questions.jpeg' })

    await expect(new MaterialExtractor(ocr).extract(jpeg)).resolves.toMatchObject(
      { format: 'jpg', mode: 'image-ocr' },
    )
  })

  it('caps extracted text at the persisted schema limit', async () => {
    const text = `Part 1\n${'a'.repeat(1_000_100)}`
    const extraction = await new MaterialExtractor(null).extract(
      createFile([text], 'large-but-valid.txt', 'text/plain'),
    )

    expect(extraction.text).toHaveLength(1_000_000)
  })
})

const _allFormatsAreCovered: Record<ImportFileFormat, true> = {
  txt: true,
  md: true,
  docx: true,
  pdf: true,
  jpg: true,
  png: true,
}

void _allFormatsAreCovered
