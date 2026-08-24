import { UserRound, Wifi, WifiOff } from 'lucide-react'

export function AppHeader({
  accountLabel,
  apiConnected,
  onBrandClick,
  onAccountClick,
}: {
  accountLabel: string
  apiConnected: boolean
  onBrandClick: () => void
  onAccountClick: () => void
}) {
  return (
    <header className="app-header">
      <button
        className="brand"
        type="button"
        onClick={onBrandClick}
        aria-label="回到首页"
      >
        <span className="brand-mark" aria-hidden="true">
          喵
        </span>
        <span>
          <strong>雅思口语喵</strong>
          <small>说出来，再改一遍</small>
        </span>
      </button>
      <span className="header-tools">
        <button
          type="button"
          className="account-chip"
          onClick={onAccountClick}
          aria-label="打开账号页"
        >
          <UserRound aria-hidden="true" size={15} />
          {accountLabel}
        </button>
        <span className={apiConnected ? 'api-badge ok' : 'api-badge down'}>
          {apiConnected ? <Wifi aria-hidden="true" size={13} /> : <WifiOff aria-hidden="true" size={13} />}
          {apiConnected ? '云端可用' : '离线可练'}
        </span>
      </span>
    </header>
  )
}
