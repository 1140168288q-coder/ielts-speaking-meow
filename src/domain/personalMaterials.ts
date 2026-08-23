import { z } from 'zod'

import { isoDateTimeSchema } from './models'

const nonEmptyText = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength)

export const personalMaterialKindSchema = z.enum([
  'person',
  'place',
  'experience',
  'object',
  'opinion',
])

export const personalMaterialStatusSchema = z.enum([
  'candidate',
  'confirmed',
  'archived',
])

/**
 * 用户生活内容素材，回答“说什么”。SavedExpression 继续独立承担
 * “怎么说”的个人语料职责。
 */
export const personalMaterialSchema = z
  .object({
    id: nonEmptyText(120),
    ownerId: nonEmptyText(120),
    title: nonEmptyText(160),
    content: nonEmptyText(5_000),
    kind: personalMaterialKindSchema,
    topicTags: z.array(nonEmptyText(80)).max(20),
    questionIds: z.array(nonEmptyText(120)).max(100),
    sourceSessionId: nonEmptyText(120).nullable(),
    status: personalMaterialStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    version: z.number().int().positive(),
    deletedAt: isoDateTimeSchema.nullable(),
  })
  .strict()

export type PersonalMaterialKind = z.infer<
  typeof personalMaterialKindSchema
>
export type PersonalMaterialStatus = z.infer<
  typeof personalMaterialStatusSchema
>
export type PersonalMaterial = z.infer<typeof personalMaterialSchema>
