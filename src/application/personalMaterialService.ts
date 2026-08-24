import {
  personalMaterialSchema,
  type PersonalMaterial,
  type PersonalMaterialKind,
} from '../domain/personalMaterials'
import type { LocalStorage } from '../ports/storage'

export interface PersonalMaterialServiceOptions {
  localStorage: LocalStorage
  getCurrentUserId: () => string
  now?: () => Date
  createId?: () => string
}

export interface PersonalMaterialInput {
  title: string
  content: string
  kind: PersonalMaterialKind
  topicTags: string[]
  questionIds?: string[]
  sourceSessionId?: string | null
}

/**
 * AI 可以在内存中提出候选素材，但候选项不是持久化记录。只有用户明确确认后，
 * PersonalMaterialService.confirmCandidate 才会把它写入个人素材库。
 */
export interface PersonalMaterialCandidate extends PersonalMaterialInput {
  candidateId: string
  status: 'candidate'
}

export interface ListPersonalMaterialOptions {
  includeArchived?: boolean
}

const defaultCreateId = () => {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid !== undefined) return uuid
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * 管理回答“说什么”的个人素材。可复用英文句式等“怎么说”的内容仍归
 * SavedExpression/个人语料管理，两者不会互相写入。
 */
export class PersonalMaterialService {
  private readonly localStorage: LocalStorage
  private readonly getCurrentUserId: () => string
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(options: PersonalMaterialServiceOptions) {
    this.localStorage = options.localStorage
    this.getCurrentUserId = options.getCurrentUserId
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? defaultCreateId
  }

  async list(
    options: ListPersonalMaterialOptions = {},
  ): Promise<PersonalMaterial[]> {
    const ownerId = this.getCurrentUserId()
    const materials = await this.localStorage.listPersonalMaterials(ownerId)
    return materials
      .filter(
        (material) =>
          material.ownerId === ownerId &&
          material.deletedAt === null &&
          material.status !== 'candidate' &&
          (options.includeArchived === true || material.status !== 'archived'),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async create(input: PersonalMaterialInput): Promise<PersonalMaterial> {
    return this.persistNew(input)
  }

  async confirmCandidate(
    candidate: PersonalMaterialCandidate,
    confirmation: { userConfirmed: boolean },
  ): Promise<PersonalMaterial> {
    if (!confirmation.userConfirmed) {
      throw new Error('请先确认这条候选素材，再收录到个人素材库。')
    }
    return this.persistNew(candidate)
  }

  async update(
    materialId: string,
    input: PersonalMaterialInput,
  ): Promise<PersonalMaterial> {
    const existing = await this.requireOwnedMaterial(materialId)
    const updated = personalMaterialSchema.parse({
      ...existing,
      ...normalizeInput(input),
      updatedAt: this.now().toISOString(),
      version: existing.version + 1,
    })
    await this.localStorage.upsertPersonalMaterial(updated)
    return updated
  }

  async archive(materialId: string): Promise<PersonalMaterial> {
    return this.setStatus(materialId, 'archived')
  }

  async restore(materialId: string): Promise<PersonalMaterial> {
    return this.setStatus(materialId, 'confirmed')
  }

  async delete(materialId: string): Promise<void> {
    const ownerId = this.getCurrentUserId()
    await this.requireOwnedMaterial(materialId, ownerId)
    await this.localStorage.deletePersonalMaterial(
      materialId,
      ownerId,
      this.now().toISOString(),
    )
  }

  private async persistNew(
    input: PersonalMaterialInput,
  ): Promise<PersonalMaterial> {
    const timestamp = this.now().toISOString()
    const material = personalMaterialSchema.parse({
      id: this.createId(),
      ownerId: this.getCurrentUserId(),
      ...normalizeInput(input),
      status: 'confirmed',
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      deletedAt: null,
    })
    await this.localStorage.upsertPersonalMaterial(material)
    return material
  }

  private async setStatus(
    materialId: string,
    status: 'confirmed' | 'archived',
  ): Promise<PersonalMaterial> {
    const existing = await this.requireOwnedMaterial(materialId)
    const updated = personalMaterialSchema.parse({
      ...existing,
      status,
      updatedAt: this.now().toISOString(),
      version: existing.version + 1,
    })
    await this.localStorage.upsertPersonalMaterial(updated)
    return updated
  }

  private async requireOwnedMaterial(
    materialId: string,
    ownerId = this.getCurrentUserId(),
  ): Promise<PersonalMaterial> {
    const material = await this.localStorage.getPersonalMaterial(
      materialId,
      ownerId,
    )
    if (
      material === null ||
      material.ownerId !== ownerId ||
      material.deletedAt !== null
    ) {
      throw new Error('个人素材不存在，或不属于当前账号。')
    }
    return material
  }
}

function normalizeInput(input: PersonalMaterialInput) {
  return {
    title: input.title.trim(),
    content: input.content.trim(),
    kind: input.kind,
    topicTags: normalizeTextList(input.topicTags),
    questionIds: normalizeTextList(input.questionIds ?? []),
    sourceSessionId: input.sourceSessionId?.trim() || null,
  }
}

function normalizeTextList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
