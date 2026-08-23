import { personalMaterialSchema, type PersonalMaterial } from './personalMaterials'

const material: PersonalMaterial = {
  id: 'material-visit-grandmother',
  ownerId: 'user-alice',
  title: '周末去外婆家',
  content: 'I visit my grandmother on weekends and help her cook dinner.',
  kind: 'experience',
  topicTags: ['family', 'weekend'],
  questionIds: ['p1-weekends', 'p2-important-person'],
  sourceSessionId: 'session-weekend-1',
  status: 'confirmed',
  createdAt: '2026-08-21T10:00:00.000+08:00',
  updatedAt: '2026-08-21T10:05:00.000+08:00',
  version: 1,
  deletedAt: null,
}

describe('personalMaterialSchema', () => {
  it('strictly validates a complete personal material', () => {
    expect(personalMaterialSchema.parse(material)).toEqual(material)
  })

  it('rejects unknown fields and invalid lifecycle values', () => {
    expect(
      personalMaterialSchema.safeParse({ ...material, expressionText: 'no' })
        .success,
    ).toBe(false)
    expect(
      personalMaterialSchema.safeParse({ ...material, kind: 'phrase' }).success,
    ).toBe(false)
    expect(
      personalMaterialSchema.safeParse({ ...material, status: 'saved' }).success,
    ).toBe(false)
    expect(
      personalMaterialSchema.safeParse({ ...material, version: 0 }).success,
    ).toBe(false)
    expect(
      personalMaterialSchema.safeParse({ ...material, deletedAt: 'yesterday' })
        .success,
    ).toBe(false)
  })
})
