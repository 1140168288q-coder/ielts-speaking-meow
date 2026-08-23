import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PersonalMaterial } from '../../domain/personalMaterials'
import type { PersonalMaterialCandidate } from '../../application/personalMaterialService'
import { PersonalMaterialLibrary } from './PersonalMaterialLibrary'

const materials: PersonalMaterial[] = [
  {
    id: 'material-person',
    ownerId: 'owner-a',
    title: 'My grandmother',
    content: 'She taught me to cook and always tells funny family stories.',
    kind: 'person',
    topicTags: ['family', 'cooking'],
    questionIds: [],
    sourceSessionId: null,
    status: 'confirmed',
    createdAt: '2026-08-20T08:00:00.000Z',
    updatedAt: '2026-08-20T08:00:00.000Z',
    version: 1,
    deletedAt: null,
  },
  {
    id: 'material-place',
    ownerId: 'owner-a',
    title: 'Riverside park',
    content: 'A quiet park where I used to ride my bike after school.',
    kind: 'place',
    topicTags: ['hometown', 'outdoors'],
    questionIds: [],
    sourceSessionId: null,
    status: 'archived',
    createdAt: '2026-08-18T08:00:00.000Z',
    updatedAt: '2026-08-19T08:00:00.000Z',
    version: 2,
    deletedAt: null,
  },
]

const candidate: PersonalMaterialCandidate = {
  candidateId: 'candidate-1',
  status: 'candidate',
  title: 'A delayed train journey',
  content: 'My friends and I played cards while the train was delayed.',
  kind: 'experience',
  topicTags: ['travel'],
}

function renderLibrary(
  overrides: Partial<React.ComponentProps<typeof PersonalMaterialLibrary>> = {},
) {
  const props: React.ComponentProps<typeof PersonalMaterialLibrary> = {
    materials,
    candidates: [candidate],
    onCreate: vi.fn(() => Promise.resolve()),
    onUpdate: vi.fn(() => Promise.resolve()),
    onArchive: vi.fn(() => Promise.resolve()),
    onRestore: vi.fn(() => Promise.resolve()),
    onDelete: vi.fn(() => Promise.resolve()),
    onConfirmCandidate: vi.fn(() => Promise.resolve()),
    onDismissCandidate: vi.fn(),
    ...overrides,
  }
  render(<PersonalMaterialLibrary {...props} />)
  return props
}

describe('PersonalMaterialLibrary', () => {
  it('explains the content boundary and supports search, type, and archive filters', async () => {
    const user = userEvent.setup()
    renderLibrary()

    expect(screen.getByText(/素材库保存“说什么”/)).toBeInTheDocument()
    expect(screen.getByText(/个人语料保存/)).toBeInTheDocument()
    expect(screen.getByText('My grandmother')).toBeInTheDocument()
    expect(screen.queryByText('Riverside park')).not.toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: '搜索个人素材' }), 'park')
    expect(screen.getByText('没有找到匹配素材')).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox', { name: '搜索个人素材' }))

    await user.click(screen.getByRole('button', { name: '已归档' }))
    expect(screen.getByText('Riverside park')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '地点' }))
    expect(screen.getByText('Riverside park')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '人物' }))
    expect(screen.getByText('没有找到匹配素材')).toBeInTheDocument()
  })

  it('creates and edits material with structured fields', async () => {
    const user = userEvent.setup()
    const props = renderLibrary({ candidates: [] })

    await user.click(screen.getByRole('button', { name: '新建素材' }))
    const createForm = screen.getByRole('heading', { name: '新建个人素材' }).closest('form')
    expect(createForm).not.toBeNull()
    const create = within(createForm as HTMLFormElement)
    await user.click(create.getByRole('button', { name: '人物' }))
    await user.type(create.getByRole('textbox', { name: '标题' }), 'My uncle')
    await user.type(
      create.getByRole('textbox', { name: '内容' }),
      'He repairs old cameras and taught me to be patient.',
    )
    await user.type(create.getByRole('textbox', { name: '主题标签' }), 'family，hobbies，family')
    await user.click(create.getByRole('button', { name: '保存素材' }))

    await waitFor(() => expect(props.onCreate).toHaveBeenCalledWith({
      title: 'My uncle',
      content: 'He repairs old cameras and taught me to be patient.',
      kind: 'person',
      topicTags: ['family', 'hobbies'],
      questionIds: [],
      sourceSessionId: null,
    }))

    await user.click(screen.getByRole('button', { name: '编辑' }))
    const editForm = screen.getByRole('heading', { name: '编辑个人素材' }).closest('form')
    expect(editForm).not.toBeNull()
    const edit = within(editForm as HTMLFormElement)
    const title = edit.getByRole('textbox', { name: '标题' })
    await user.clear(title)
    await user.type(title, 'My patient grandmother')
    await user.click(edit.getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(
      'material-person',
      expect.objectContaining({ title: 'My patient grandmother', kind: 'person' }),
    ))
  })

  it('requires confirmations for archive/delete and keeps AI candidates user-controlled', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const props = renderLibrary()

    await user.click(screen.getByRole('button', { name: '确认收录' }))
    await waitFor(() => expect(props.onConfirmCandidate).toHaveBeenCalledWith(candidate))
    await user.click(screen.getByRole('button', { name: '忽略' }))
    expect(props.onDismissCandidate).toHaveBeenCalledWith(candidate.candidateId)

    await user.click(screen.getByRole('button', { name: '归档' }))
    await waitFor(() => expect(props.onArchive).toHaveBeenCalledWith('material-person'))
    await user.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith('material-person'))
    expect(confirm).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: '已归档' }))
    await user.click(screen.getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(props.onRestore).toHaveBeenCalledWith('material-place'))
  })
})
