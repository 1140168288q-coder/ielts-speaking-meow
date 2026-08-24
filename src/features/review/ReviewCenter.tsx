import type { ReactNode } from 'react'
import {
  BookOpenText,
  ChartNoAxesColumnIncreasing,
  Lightbulb,
} from 'lucide-react'
import type { AppView } from '../../app/navigation'

export function ReviewCenter({
  active,
  onChange,
  children,
}: {
  active: 'history' | 'expressions' | 'materials'
  onChange: (view: Exclude<AppView, 'practice'>) => void
  children: ReactNode
}) {
  return (
    <section className="review-center">
      <div className="review-center-heading">
        <div>
          <p className="eyebrow">Review & reuse</p>
          <h1>复盘中心</h1>
          <p>回看练习，也把真正能复用的英语留下来。</p>
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
      </nav>
      <p className="review-tab-definition">
        {active === 'history'
          ? '回看每次回答、反馈与第二遍进步。'
          : active === 'expressions'
            ? '下次可以直接说出口的句子和表达'
            : '你的经历、观点和例子，用来支撑答案内容'}
      </p>
      {children}
    </section>
  )
}
