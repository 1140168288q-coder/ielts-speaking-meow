import type { ImportFileFormat } from '../../domain'

const FORMAT_BY_EXTENSION: Readonly<Record<string, ImportFileFormat>> = {
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  docx: 'docx',
  pdf: 'pdf',
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
}

export const ACCEPTED_IMPORT_EXTENSIONS =
  '.txt,.md,.markdown,.docx,.pdf,.jpg,.jpeg,.png'

export const MAX_IMPORT_FILE_SIZE = 25 * 1024 * 1024

export function detectImportFormat(fileName: string): ImportFileFormat {
  const extension = fileName.trim().toLowerCase().split('.').pop() ?? ''

  if (extension === 'doc') {
    throw new Error('暂不支持旧版 .doc，请先另存为 .docx 或 PDF 后再导入。')
  }

  const format = FORMAT_BY_EXTENSION[extension]
  if (format === undefined) {
    throw new Error('仅支持 TXT、MD、DOCX、PDF、JPG 和 PNG 文件。')
  }

  return format
}

export function validateImportFile(file: Blob & { name: string }): void {
  detectImportFormat(file.name)
  if (file.size === 0) {
    throw new Error('文件内容为空，无法导入。')
  }
  if (file.size > MAX_IMPORT_FILE_SIZE) {
    throw new Error('文件超过 25 MB，请压缩或拆分后重试。')
  }
}
