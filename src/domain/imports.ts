import { z } from 'zod'
import {
  ieltsPartSchema,
  isoDateTimeSchema,
  questionSchema,
  type IeltsPart,
  type Question,
} from './models'

const nonEmptyText = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength)

export const importFileFormatSchema = z.enum([
  'txt',
  'md',
  'docx',
  'pdf',
  'jpg',
  'png',
])

export const importExtractionModeSchema = z.enum([
  'plain-text',
  'docx',
  'pdf-text',
  'pdf-ocr',
  'pdf-mixed',
  'image-ocr',
])

export const importSourceSchema = z
  .object({
    id: nonEmptyText(120),
    fileName: nonEmptyText(255),
    mimeType: z.string().trim().max(160),
    fileSize: z.number().int().nonnegative().max(25 * 1024 * 1024),
    format: importFileFormatSchema,
    extractionMode: importExtractionModeSchema,
    extractedText: z.string().max(1_000_000),
    originalFileId: nonEmptyText(120),
    importedAt: isoDateTimeSchema,
  })
  .strict()

export const importedQuestionRecordSchema = z
  .object({
    id: z.string().regex(/^p[123]-[a-z0-9-]+$/),
    sourceId: nonEmptyText(120),
    question: questionSchema,
    sourcePage: z.number().int().positive().nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.id !== record.question.id) {
      context.addIssue({
        code: 'custom',
        message: 'Imported question record id must match its question id.',
        path: ['id'],
      })
    }
  })

export const importQuestionCandidateSchema = z
  .object({
    id: nonEmptyText(120),
    part: ieltsPartSchema,
    topic: nonEmptyText(80),
    prompt: nonEmptyText(500),
    cuePoints: z.array(nonEmptyText(160)).max(5),
    sourcePage: z.number().int().positive().nullable(),
  })
  .strict()

export const importQuestionCandidateListSchema = z
  .array(importQuestionCandidateSchema)
  .max(300)

export type ImportFileFormat = z.infer<typeof importFileFormatSchema>
export type ImportExtractionMode = z.infer<
  typeof importExtractionModeSchema
>
export type ImportSource = z.infer<typeof importSourceSchema>
export type ImportedQuestionRecord = z.infer<
  typeof importedQuestionRecordSchema
>
export type ImportQuestionCandidate = z.infer<
  typeof importQuestionCandidateSchema
>

export function candidateToQuestion(
  candidate: ImportQuestionCandidate,
  questionId: string,
): Question {
  const common = {
    id: questionId,
    part: candidate.part,
    topic: candidate.topic,
    prompt: candidate.prompt,
    difficulty:
      candidate.part === 1
        ? ('foundation' as const)
        : candidate.part === 2
          ? ('developing' as const)
          : ('stretch' as const),
    source: '用户导入材料',
  }

  if (candidate.part === 2) {
    return questionSchema.parse({
      ...common,
      part: 2,
      cuePoints: normaliseCuePoints(candidate.cuePoints),
    })
  }

  return questionSchema.parse(common)
}

function normaliseCuePoints(cuePoints: string[]): string[] {
  const cleaned = cuePoints.map((item) => item.trim()).filter(Boolean)
  if (cleaned.length >= 2) {
    return cleaned.slice(0, 5)
  }

  return [
    ...cleaned,
    'Explain the main details.',
    'Say why this is meaningful to you.',
  ].slice(0, Math.max(2, cleaned.length + 2))
}

export interface EditableQuestionCandidate {
  id: string
  part: IeltsPart
  topic: string
  prompt: string
  cuePoints: string[]
  sourcePage: number | null
  selected: boolean
}
