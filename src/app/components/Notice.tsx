export function Notice({
  tone,
  text,
  onDismiss,
  action,
}: {
  tone: 'error' | 'info'
  text: string
  onDismiss: () => void
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className={tone === 'error' ? 'notice notice-error' : 'notice navigation-notice'} role="alert">
      <span>{text}</span>
      {action ? <button type="button" onClick={action.onClick}>{action.label}</button> : null}
      <button type="button" onClick={onDismiss}>
        知道了
      </button>
    </div>
  )
}
