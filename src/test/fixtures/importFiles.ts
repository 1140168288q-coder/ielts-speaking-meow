import type { ImportFileFormat } from '../../domain'

export const SYNTHETIC_QUESTION = 'What do you like about your home?'

const DOCX_BASE64 =
  'UEsDBBQAAAAIAMkCCl2V+AsdyQAAAEgBAAARAAAAd29yZC9kb2N1bWVudC54bWyFkD9rAzEMxb+K8N740qGE4/5spWOGlM6OreZMz5aRdb3et4+dDIFS6PKkJz1+CHXjT5jhGzl7ir3a7xoFGC05Hy+9ej+9Ph0UZDHRmZki9mrDrMahW1tHdgkYBQog5nbt1SSSWq2znTCYvKOEsew+iYORYvmiV2KXmCzmXPhh1s9N86KD8VFV5JncVmuqwlVkOBoW2He69lX5pul37ETJ2xbeKOC/2Y/JCDiCjRaY/ReCOdMi1TJMBTD+Scho5cj6Nrgfqh9PGK5QSwMEFAAAAAgAyQIKXXluM9foAAAArQEAABMAAABbQ29udGVudF9UeXBlc10ueG1sfVDJTsMwEP0Va64oceCAEIrTA8sROJQPGNmTxKo3edzS/j1OW3pAhePMW/X61d47saPMNgYFt20HgoKOxoZJwef6tXkAwQWDQRcDKTgQw2ro14dELKo2sIK5lPQoJeuZPHIbE4WKjDF7LPXMk0yoNziRvOu6e6ljKBRKUxYPGPpnGnHrinjZ1/epRybHIJ5OxCVLAabkrMZScbkL5ldKc05oq/LI4dkmvqkEkFcTFuTvgLPuvQ6TrSHxgbm8oa8s+RWzkSbqra/K9n+bKz3jOFpNF/3ilnLUxFwX9669IB5t+Okvj3MP31BLAwQUAAAACADJAgpdm/036q0AAAApAQAACwAAAF9yZWxzLy5yZWxzjc87DsIwDAbgq0TeaVoGhFDTLgipKyoHsBI3rWgeSsKjtycDA0UMjLZ/f5br9mlmdqcQJ2cFVEUJjKx0arJawKU/bfbAYkKrcHaWBCwUoW3qM82Y8kocJx9ZNmwUMKbkD5xHOZLBWDhPNk8GFwymXAbNPcorauLbstzx8GnA2mSdEhA6VQHrF0//2G4YJklHJ2+GbPpx4iuRZQyakoCHC4qrd7vILPCm5qsXmxdQSwECFAAUAAAACADJAgpdlfgLHckAAABIAQAAEQAAAAAAAAAAAAAAAAAAAAAAd29yZC9kb2N1bWVudC54bWxQSwECFAAUAAAACADJAgpdeW4z1+gAAACtAQAAEwAAAAAAAAAAAAAAAAD4AAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUABQAAAAIAMkCCl2b/TfqrQAAACkBAAALAAAAAAAAAAAAAAAAABECAABfcmVscy8ucmVsc1BLBQYAAAAAAwADALkAAADnAgAAAAA='

const PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMTExID4+CnN0cmVhbQpCVAovRjEgMTQgVGYKNzIgNzQwIFRkCihQYXJ0IDEpIFRqCjAgLTI0IFRkCihUb3BpYzogSG9tZSkgVGoKMCAtMjQgVGQKKFdoYXQgZG8geW91IGxpa2UgYWJvdXQgeW91ciBob21lPykgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQ3MwolJUVPRgo='

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nXQAAAAASUVORK5CYII='

const JPG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q=='

const MIME_TYPES: Record<ImportFileFormat, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
}

export function createImportFileFixture(format: ImportFileFormat): File {
  switch (format) {
    case 'txt':
      return createFile(
        ['Part 1\r\nTopic: Home\r\n', SYNTHETIC_QUESTION],
        'questions.txt',
        MIME_TYPES.txt,
      )
    case 'md':
      return createFile(
        [`# Part 1\n## Topic: Home\n- ${SYNTHETIC_QUESTION}`],
        'questions.md',
        MIME_TYPES.md,
      )
    case 'docx':
      return createFile(
        [decodeBase64(DOCX_BASE64)],
        'questions.docx',
        MIME_TYPES.docx,
      )
    case 'pdf':
      return createFile(
        [decodeBase64(PDF_BASE64)],
        'questions.pdf',
        MIME_TYPES.pdf,
      )
    case 'jpg':
      return createFile(
        [decodeBase64(JPG_BASE64)],
        'questions.jpg',
        MIME_TYPES.jpg,
      )
    case 'png':
      return createFile(
        [decodeBase64(PNG_BASE64)],
        'questions.png',
        MIME_TYPES.png,
      )
  }
}

export function createCorruptImportFileFixture(
  format: Exclude<ImportFileFormat, 'txt' | 'md'>,
): File {
  return createFile(
    [`not a valid ${format} container`],
    `corrupt.${format}`,
    MIME_TYPES[format],
  )
}

export function createFile(
  parts: BlobPart[],
  name: string,
  type: string,
): File {
  const blob = new Blob(parts, { type })
  return Object.assign(blob, { name, lastModified: 0 }) as File
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = globalThis.atob(value)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return bytes
}
