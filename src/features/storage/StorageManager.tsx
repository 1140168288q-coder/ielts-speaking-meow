import { useEffect, useState, type ChangeEvent } from 'react'
import type { StorageBackupService } from '../../application/storageBackupService'
import type {
  LocalDataMaintenance,
  StorageUsageSummary,
} from '../../ports/storage'

export function StorageManager({
  maintenance,
  backupService,
  onChanged,
}: {
  maintenance: LocalDataMaintenance
  backupService: StorageBackupService
  onChanged: () => Promise<void>
}) {
  const [summary, setSummary] = useState<StorageUsageSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = async () => {
    const next = await maintenance.getStorageUsage()
    setSummary(next)
  }

  useEffect(() => {
    let active = true
    void maintenance.getStorageUsage()
      .then((next) => {
        if (active) setSummary(next)
      })
      .catch(() => {
        if (active) setMessage('暂时无法统计本地存储占用。')
      })
    return () => {
      active = false
    }
  }, [maintenance])

  const exportBackup = async () => {
    if (busy) return
    setBusy(true)
    setMessage('正在整理练习、表达和原始录音…')
    try {
      const blob = await backupService.exportBackup()
      const date = new Date().toISOString().slice(0, 10)
      downloadBlob(blob, `ielts-speaking-meow-backup-${date}.json`)
      setMessage('备份已生成。文件含私密录音，请妥善保存。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '备份导出失败。')
    } finally {
      setBusy(false)
    }
  }

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    setBusy(true)
    setMessage('正在校验并恢复本地备份…')
    try {
      const result = await backupService.importBackup(file)
      await onChanged()
      await refresh()
      setMessage(
        `恢复完成：${result.sessions} 次练习、${result.recordings} 段录音、${result.expressions} 条表达。`,
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '备份恢复失败。')
    } finally {
      setBusy(false)
    }
  }

  const clearTts = async () => {
    if (busy) return
    setBusy(true)
    try {
      const count = await maintenance.clearTtsCache()
      await refresh()
      setMessage(`已清理 ${count} 条 AI 语音缓存；系统朗读和练习数据不受影响。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '缓存清理失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-card storage-card">
      <h2 className="section-heading">本地数据与备份</h2>
      <p className="settings-note">
        练习和录音默认只在本机。备份文件包含原始录音和转写，属于私密数据；导入
        会合并记录，并覆盖相同 ID 的旧版本。
      </p>
      {summary ? (
        <div className="storage-summary" aria-label="本地存储概览">
          <div><small>练习</small><strong>{summary.sessions}</strong></div>
          <div><small>原始录音</small><strong>{summary.recordings}</strong></div>
          <div><small>个人表达</small><strong>{summary.expressions}</strong></div>
          <div><small>约占用</small><strong>{formatBytes(summary.estimatedTotalBytes)}</strong></div>
        </div>
      ) : null}
      <div className="settings-actions storage-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void exportBackup()}
        >
          导出完整本地备份
        </button>
        <label className={busy ? 'file-button disabled' : 'file-button'}>
          恢复备份
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => void importBackup(event)}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || (summary?.ttsCacheEntries ?? 0) === 0}
          onClick={() => void clearTts()}
        >
          清理 AI 语音缓存
        </button>
      </div>
      {message ? <div className="inline-note" role="status">{message}</div> : null}
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
