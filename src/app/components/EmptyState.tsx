import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'

export function EmptyState({
  icon,
  title,
  body,
  action,
  role,
}: {
  icon?: ReactNode
  title: string
  body: string
  action?: ReactNode
  role?: 'alert' | 'status'
}) {
  return (
    <div className="empty-state" role={role}>
      {icon ?? <Inbox aria-hidden="true" size={28} />}
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  )
}
