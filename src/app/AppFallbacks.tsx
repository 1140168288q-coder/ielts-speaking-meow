import { LoaderCircle, SearchX } from 'lucide-react'
import { EmptyState } from './components/EmptyState'

export function LoadingView({ label = '正在打开本地练习记录…' }: { label?: string }) {
  return (
    <div className="loading-view" role="status">
      <LoaderCircle className="loading-paw" aria-hidden="true" size={20} />
      {label}
    </div>
  )
}

export function StartupFailureView() {
  return (
    <EmptyState
      role="alert"
      icon={<SearchX aria-hidden="true" size={24} />}
      title="应用数据没有完整载入"
      body="题库或本地记录校验失败。你的本机数据没有被删除，可以重新载入后再试。"
      action={
        <button
          type="button"
          className="primary-button"
          onClick={() => window.location.reload()}
        >
          重新载入
        </button>
      }
    />
  )
}
