import { ChevronLeft } from 'lucide-react'
import type { Question } from '../../../domain'
import { partLabel } from '../format'

export function PracticeTopBar({
  part,
  step,
  onBack,
  backLabel = '返回题库',
}: {
  part: Question['part']
  step: number
  onBack: () => void
  backLabel?: string
}) {
  return (
    <div className="practice-topbar">
      <button type="button" className="icon-button" onClick={onBack} aria-label={backLabel}>
        <ChevronLeft aria-hidden="true" size={21} />
      </button>
      <div className="practice-topbar-center">
        <span className="practice-topbar-part">{partLabel(part)}</span>
        <div className="step-track" role="group" aria-label={`当前第 ${step} 步，共 4 步`}>
          {[1, 2, 3, 4].map((value) => (
            <span key={value} className={value <= step ? 'active' : ''} />
          ))}
        </div>
        <span className="step-count">{step}/4</span>
      </div>
      <span className="practice-topbar-slot" aria-hidden="true" />
    </div>
  )
}
