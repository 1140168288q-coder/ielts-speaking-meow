import { useState } from 'react'
import type { AccountProfile } from '../domain/accounts'
import type { CloudAccountSession } from '../domain/cloudAccount'
import { CloudSyncError } from '../domain/cloudSync'
import { AccountCloudSyncService } from '../application/accountCloudSyncService'
import type { CloudSyncStatus } from '../features/accounts/CloudSyncCard'
import type { BrowserRuntime } from './runtime'

export function formatSyncDestination(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || '当前云端服务'
  } catch {
    return '当前云端服务'
  }
}

export function useCloudSync({
  runtime,
  onAccountBound,
  refreshLibrary,
  onPreferencesChanged,
}: {
  runtime: BrowserRuntime
  onAccountBound: (account: AccountProfile) => void
  refreshLibrary: () => Promise<void>
  onPreferencesChanged?: () => Promise<void>
}) {
  const [cloudSession, setCloudSession] = useState<CloudAccountSession | null>(null)
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>('idle')
  const [cloudSyncMessage, setCloudSyncMessage] = useState('尚未同步。')

  const handleCloudSessionChange = (nextSession: CloudAccountSession | null) => {
    setCloudSession(nextSession)
    setCloudSyncStatus('idle')
    setCloudSyncMessage(nextSession ? '尚未同步。' : '')
  }

  const runCloudSync = async () => {
    if (!cloudSession?.user.emailVerified) {
      setCloudSyncStatus('error')
      setCloudSyncMessage('请先验证邮箱，再同步资料。')
      return
    }

    setCloudSyncStatus('syncing')
    setCloudSyncMessage('正在比较本机与云端版本，本机数据会在成功前保留。')
    try {
      const boundAccount = await runtime.accountService.bindCurrentAccountToCloud(
        cloudSession.user.id,
      )
      onAccountBound(boundAccount)
      const syncService = new AccountCloudSyncService({
        scopeId: cloudSession.user.id,
        ownerId: runtime.accountService.getCurrentUserId(),
        storage: runtime.storage,
        gateway: runtime.cloudSyncClient,
      })
      const summary = await syncService.synchronize()
      await refreshLibrary()
      await onPreferencesChanged?.()

      if (summary.status === 'conflict') {
        setCloudSyncStatus('conflict')
        setCloudSyncMessage(
          `${summary.conflicts[0]?.message ?? '发现同步冲突。'} 已停止覆盖；本机资料仍保留。`,
        )
        return
      }

      setCloudSyncStatus('success')
      setCloudSyncMessage(
        `同步完成：上传 ${summary.uploaded} 项，恢复或更新 ${summary.downloaded} 项。`,
      )
    } catch (error) {
      if (
        error instanceof CloudSyncError &&
        (error.code === 'unauthenticated' || error.code === 'session-expired')
      ) {
        handleCloudSessionChange(null)
        setCloudSyncStatus('error')
        setCloudSyncMessage('登录已失效，请重新登录后再试。本机资料没有丢失。')
        return
      }
      setCloudSyncStatus('error')
      setCloudSyncMessage(
        `${error instanceof Error ? error.message : '同步失败。'} 本机资料与待同步项目仍保留，可稍后重试。`,
      )
    }
  }

  return {
    cloudSession,
    cloudSyncStatus,
    cloudSyncMessage,
    handleCloudSessionChange,
    runCloudSync,
    setCloudSession,
  }
}
