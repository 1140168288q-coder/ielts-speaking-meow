export function Notice({
  tone,
  text,
  onDismiss,
}: {
  tone: 'error' | 'info'
  text: string
  onDismiss: () => void
}) {
  return (
    <div className={tone === 'error' ? 'notice notice-error' : 'notice navigation-notice'} role="alert">
      <span>{text}</span>
      <button type="button" onClick={onDismiss}>
        知道了
      </button>
    </div>
  )
}
