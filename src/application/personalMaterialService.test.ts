import { describe, expect, it } from 'vitest'

import type { PersonalMaterial } from '../domain/personalMaterials'
import type { LocalStorage } from '../ports/storage'
import {
  PersonalMaterialService,
  type PersonalMaterialCandidate,
} from './personalMaterialService'

class MemoryMaterialStorage {
  readonly materials = new Map<string, PersonalMaterial>()

  async upsertPersonalMaterial(material: PersonalMaterial): Promise<void> {
    await Promise.resolve()
    this.materials.set(material.id, structuredClone(material))
  }

  async getPersonalMaterial(
    materialId: string,
    ownerId: string,
  ): Promise<PersonalMaterial | null> {
    await Promise.resolve()
    const material = this.materials.get(materialId)
    return material?.ownerId === ownerId ? structuredClone(material) : null
  }

  async listPersonalMaterials(ownerId: string): Promise<PersonalMaterial[]> {
    await Promise.resolve()
    return [...this.materials.values()]
      .filter((material) => material.ownerId === ownerId && material.deletedAt === null)
      .map((material) => structuredClone(material))
  }

  async deletePersonalMaterial(
    materialId: string,
    ownerId: string,
  ): Promise<void> {
    const material = await this.getPersonalMaterial(materialId, ownerId)
    if (material === null) return
    this.materials.set(materialId, {
      ...material,
      deletedAt: '2026-08-21T09:00:00.000Z',
      updatedAt: '2026-08-21T09:00:00.000Z',
      version: material.version + 1,
    })
  }
}

function createHarness() {
  const storage = new MemoryMaterialStorage()
  let ownerId = 'owner-a'
  let id = 0
  const service = new PersonalMaterialService({
    localStorage: storage as unknown as LocalStorage,
    getCurrentUserId: () => ownerId,
    now: () => new Date('2026-08-21T08:00:00.000Z'),
    createId: () => `material-${++id}`,
  })
  return { storage, service, switchOwner: (next: string) => { ownerId = next } }
}

const materialInput = {
  title: ' My grandmother ',
  content: ' She taught me how to cook. ',
  kind: 'person' as const,
  topicTags: [' family ', 'cooking', 'family'],
}

describe('PersonalMaterialService', () => {
  it('creates confirmed content material and normalizes topic tags', async () => {
    const { service } = createHarness()

    const material = await service.create(materialInput)

    expect(material).toMatchObject({
      ownerId: 'owner-a',
      title: 'My grandmother',
      content: 'She taught me how to cook.',
      kind: 'person',
      topicTags: ['family', 'cooking'],
      status: 'confirmed',
      version: 1,
      deletedAt: null,
    })
  })

  it('does not persist an AI candidate before explicit user confirmation', async () => {
    const { service, storage } = createHarness()
    const candidate: PersonalMaterialCandidate = {
      candidateId: 'candidate-1',
      status: 'candidate',
      ...materialInput,
    }

    await expect(
      service.confirmCandidate(candidate, { userConfirmed: false }),
    ).rejects.toThrow('确认')
    expect(storage.materials.size).toBe(0)

    const confirmed = await service.confirmCandidate(candidate, {
      userConfirmed: true,
    })
    expect(confirmed.status).toBe('confirmed')
    expect(storage.materials.size).toBe(1)
  })

  it('isolates list, update, archive, restore, and delete by current owner', async () => {
    const { service, storage, switchOwner } = createHarness()
    const aliceMaterial = await service.create(materialInput)

    switchOwner('owner-b')
    const bobMaterial = await service.create({
      title: 'A rainy trip',
      content: 'Our train stopped for two hours, so we played cards.',
      kind: 'experience',
      topicTags: ['travel'],
    })
    expect((await service.list()).map((item) => item.id)).toEqual([bobMaterial.id])
    await expect(
      service.update(aliceMaterial.id, materialInput),
    ).rejects.toThrow('当前账号')
    await expect(service.archive(aliceMaterial.id)).rejects.toThrow('当前账号')
    await expect(service.delete(aliceMaterial.id)).rejects.toThrow('当前账号')

    await service.archive(bobMaterial.id)
    expect(await service.list()).toHaveLength(0)
    expect(await service.list({ includeArchived: true })).toHaveLength(1)

    await service.restore(bobMaterial.id)
    const updated = await service.update(bobMaterial.id, {
      title: 'A delayed train',
      content: bobMaterial.content,
      kind: bobMaterial.kind,
      topicTags: ['travel', 'unexpected events'],
    })
    expect(updated.title).toBe('A delayed train')
    expect(updated.version).toBe(4)

    await service.delete(bobMaterial.id)
    expect(await service.list({ includeArchived: true })).toHaveLength(0)
    expect(storage.materials.get(bobMaterial.id)?.deletedAt).not.toBeNull()
  })
})
