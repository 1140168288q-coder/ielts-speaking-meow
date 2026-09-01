import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SavedExpression } from '../../domain'
import type { AudioFocus } from '../../ports/speech'
import { ExpressionLibrary } from './LibraryViews'

const expression: SavedExpression = {
  id: 'expression-1',
  text: 'It helps me unwind after a busy day.',
  topic: 'Home',
  questionId: 'p1-home-001',
  sessionId: 'session-1',
  sourceAttempt: 2,
  sourcePart: 1,
  createdAt: '2026-08-01T08:00:00.000Z',
  reviewCount: 0,
  lastReviewedAt: null,
}

const audioFocus = {
  speak: vi.fn(() => Promise.resolve()),
  stopTTS: vi.fn(() => Promise.resolve()),
  subscribe: vi.fn(() => () => undefined),
} as unknown as AudioFocus

describe('ExpressionLibrary', () => {
  it('searches and connects edit, review, delete, and original-question actions', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn(() => Promise.resolve())
    const onDelete = vi.fn(() => Promise.resolve())
    const onReviewed = vi.fn(() => Promise.resolve())
    const onPractice = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <ExpressionLibrary
        expressions={[expression]}
        audioFocus={audioFocus}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onReviewed={onReviewed}
        onPractice={onPractice}
      />,
    )

    expect(screen.getByText('有 1 句在等你回头')).toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: '搜索个人表达' })
    await user.type(search, 'travel')
    expect(screen.getByText('没有找到匹配表达')).toBeInTheDocument()
    await user.clear(search)

    await user.click(screen.getByRole('button', { name: '编辑' }))
    const text = screen.getByRole('textbox', { name: '表达' })
    const topic = screen.getByRole('textbox', { name: '主题' })
    await user.clear(text)
    await user.type(text, 'It helps me recharge after work.')
    await user.clear(topic)
    await user.type(topic, 'Daily life')
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(
      expression.id,
      'It helps me recharge after work.',
      'Daily life',
      1,
    ))

    await user.click(screen.getByRole('button', { name: '已听读' }))
    await waitFor(() => expect(onReviewed).toHaveBeenCalledWith(expression.id))

    await user.click(screen.getByRole('button', { name: '用原题再练' }))
    expect(onPractice).toHaveBeenCalledWith('p1-home-001')

    await user.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expression.id))
    expect(confirm).toHaveBeenCalledOnce()
  })
})
