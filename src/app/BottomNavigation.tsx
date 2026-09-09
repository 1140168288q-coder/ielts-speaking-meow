import type { LucideIcon } from 'lucide-react'
import {
  ChartNoAxesColumnIncreasing,
  Home,
  LibraryBig,
  UserRound,
} from 'lucide-react'
import type { AppView } from './navigation'

export function BottomNavigation({
  view,
  onChange,
}: {
  view: AppView
  onChange: (view: Exclude<AppView, 'practice'>) => void
}) {
  const items: Array<{
    view: Exclude<AppView, 'practice' | 'expressions' | 'imports' | 'settings'>
    label: string
    icon: LucideIcon
  }> = [
    { view: 'home', label: '首页', icon: Home },
    { view: 'questions', label: '题库', icon: LibraryBig },
    { view: 'history', label: '复盘', icon: ChartNoAxesColumnIncreasing },
    { view: 'accounts', label: '我的', icon: UserRound },
  ]

  return (
    <nav className="bottom-nav" aria-label="主导航">
      {items.map((item) => {
        const Icon = item.icon
        const active = view === item.view ||
          (item.view === 'history' && (view === 'expressions' || view === 'materials' || view === 'knowledge')) ||
          (item.view === 'accounts' && view === 'settings')
        return (
          <button
            type="button"
            key={item.view}
            className={active ? 'active' : ''}
            onClick={() => onChange(item.view)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon aria-hidden="true" size={21} strokeWidth={active ? 2.4 : 2} />
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}
