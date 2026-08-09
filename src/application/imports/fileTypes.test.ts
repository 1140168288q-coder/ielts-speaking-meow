import {
  ACCEPTED_IMPORT_EXTENSIONS,
  MAX_IMPORT_FILE_SIZE,
  detectImportFormat,
  validateImportFile,
} from './fileTypes'

describe('import file type boundary', () => {
  it.each([
    ['questions.txt', 'txt'],
    ['questions.MD', 'md'],
    ['questions.markdown', 'md'],
    ['questions.docx', 'docx'],
    ['questions.pdf', 'pdf'],
    ['questions.jpg', 'jpg'],
    ['questions.jpeg', 'jpg'],
    ['questions.PNG', 'png'],
  ] as const)('normalises the supported file %s to %s', (fileName, format) => {
    expect(detectImportFormat(fileName)).toBe(format)
  })

  it('advertises exactly the six supported formats plus documented aliases', () => {
    expect(ACCEPTED_IMPORT_EXTENSIONS).toBe(
      '.txt,.md,.markdown,.docx,.pdf,.jpg,.jpeg,.png',
    )
  })

  it('gives legacy Word files a conversion path without attempting import', () => {
    expect(() => detectImportFormat('legacy-question-bank.doc')).toThrow(
      '请先另存为 .docx 或 PDF',
    )
  })

  it.each(['questions.rtf', 'questions.csv', 'questions.exe', 'no-extension'])(
    'rejects unsupported input %s',
    (fileName) => {
      expect(() => detectImportFormat(fileName)).toThrow(
        '仅支持 TXT、MD、DOCX、PDF、JPG 和 PNG',
      )
    },
  )

  it('rejects empty input and accepts the exact size limit', () => {
    const empty = { name: 'empty.txt', size: 0 } as Blob & { name: string }
    const exactLimit = {
      name: 'limit.pdf',
      size: MAX_IMPORT_FILE_SIZE,
    } as Blob & { name: string }

    expect(() => validateImportFile(empty)).toThrow('文件内容为空')
    expect(() => validateImportFile(exactLimit)).not.toThrow()
  })

  it('rejects one byte beyond the 25 MB limit before decoding', () => {
    const tooLarge = {
      name: 'too-large.pdf',
      size: MAX_IMPORT_FILE_SIZE + 1,
    } as Blob & { name: string }

    expect(() => validateImportFile(tooLarge)).toThrow('文件超过 25 MB')
  })
})
