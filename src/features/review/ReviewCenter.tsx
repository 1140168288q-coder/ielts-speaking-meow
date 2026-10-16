import type { ReactNode } from 'react'
import {
  BookOpenText,
  ChartNoAxesColumnIncreasing,
  Lightbulb,
  LibraryBig,
} from 'lucide-react'
import type { AppView } from '../../app/navigation'

export function ReviewCenter({
  active,
  onChange,
  children,
}: {
  active: 'history' | 'expressions' | 'materials' | 'knowledge'
  onChange: (view: Exclude<AppView, 'practice'>) => void
  children: ReactNode
}) {
  return (
    <section className="review-center">
      <div className="review-center-heading">
        <div>
          <p className="eyebrow">Review & reuse</p>
          <h1>复盘中心</h1>
          <p>说过的话不会白白流走——回听一遍，把最好的那句留下来。</p>
        </div>
      </div>
      <nav className="review-tabs" aria-label="复盘内容">
        <button
          type="button"
          className={active === 'history' ? 'active' : ''}
          aria-current={active === 'history' ? 'page' : undefined}
          onClick={() => onChange('history')}
        >
          <ChartNoAxesColumnIncreasing aria-hidden="true" size={17} />
          练习记录
        </button>
        <button
          type="button"
          className={active === 'expressions' ? 'active' : ''}
          aria-current={active === 'expressions' ? 'page' : undefined}
          onClick={() => onChange('expressions')}
        >
          <BookOpenText aria-hidden="true" size={17} />
          个人语料
        </button>
        <button
          type="button"
          className={active === 'materials' ? 'active' : ''}
          onClick={() => onChange('materials')}
        >
          <Lightbulb aria-hidden="true" size={17} />
          个人素材
        </button>
        <button
          type="button"
          className={active === 'knowledge' ? 'active' : ''}
          aria-current={active === 'knowledge' ? 'page' : undefined}
          onClick={() => onChange('knowledge')}
        >
          <LibraryBig aria-hidden="true" size={17} />
          我的语料库
        </button>
      </nav>
      <p className="review-tab-definition">
        {active === 'history'
          ? '今天说出口的别扭，都是明天脱口而出的前奏。'
          : active === 'expressions'
            ? '下次紧张时，伸手就能拿到的句子。'
            : active === 'materials'
              ? '你的故事库：人、地方、和你站在哪一边。'
              : '教学资料与表达资料，确认后才会加入你的本地资料库。'}
      </p>
      {children}
    </section>
  )
}
