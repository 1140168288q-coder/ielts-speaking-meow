import type {
  BackendClient,
  BackendHealth,
  BackendProviderHealth,
  BackendProviderVerification,
} from './backendClient'

export type BackendProviderName = 'deepseek' | 'volc_tts'

export type ProviderHealthStatus = 'configured' | 'unconfigured' | 'unknown'

export interface BackendHealthSnapshot {
  /** 最近一次检查的时间戳(ms)。 */
  checkedAt: number
  /** null 表示云端不可达;非 null 时 providers 为各供应商真实配置状态。 */
  health: BackendHealth | null
  /** 最近一次失败原因(health 为 null 时提供具体提示)。 */
  failure: string | null
}

const UNREACHABLE_SNAPSHOT: BackendHealthSnapshot = {
  checkedAt: 0,
  health: null,
  failure: '尚未检查云端服务。',
}

/**
 * 云端健康状态缓存。App 启动时 refresh() 一次,练习与设置页都以它为
 * 事实来源驱动各 Backend provider 的降级决策;绝不依赖 provider 自身的
 * 恒 true 判断。
 *
 * 并发 refresh() 合并为同一次请求;invalidate()(配置变更后调用)会使
 * 下一次 refresh() 强制发起新请求,且过期请求的结果不会覆盖新快照。
 */
export class BackendHealthCache {
  private snapshot: BackendHealthSnapshot = UNREACHABLE_SNAPSHOT
  private inFlight: Promise<BackendHealthSnapshot> | null = null
  private restartRequested = false
  private generation = 0

  constructor(
    private readonly client: BackendClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  getSnapshot(): BackendHealthSnapshot {
    return { ...this.snapshot }
  }

  statusOf(provider: BackendProviderName): ProviderHealthStatus {
    const info = this.providerInfo(provider)
    if (info === null) {
      return 'unknown'
    }
    return info.configured ? 'configured' : 'unconfigured'
  }

  /** 某供应商的完整健康信息(模型/资源 ID/音色/验证状态);云端不可达时为 null。 */
  providerInfo(provider: BackendProviderName): BackendProviderHealth | null {
    return this.snapshot.health?.providers[provider] ?? null
  }

  /** 某供应商最近一次真实调用/验证结果;未知时为 null。 */
  verificationOf(
    provider: BackendProviderName,
  ): BackendProviderVerification | null {
    return this.providerInfo(provider)?.verification ?? null
  }

  /** 拉取 /health 并更新缓存;并发调用合并为同一次请求;失败不抛出。 */
  refresh(): Promise<BackendHealthSnapshot> {
    if (this.inFlight === null || this.restartRequested) {
      this.restartRequested = false
      this.inFlight = this.fetchAndCache().finally(() => {
        this.inFlight = null
      })
    }
    return this.inFlight
  }

  /**
   * 请求 Backend 对 DeepSeek/TTS 做真实小规模验证,然后立即刷新健康
   * 快照,让设置页能看到最新的 verified/failed 状态。失败不抛出。
   */
  async verifyProviders(): Promise<BackendHealthSnapshot> {
    try {
      await this.client.verifyProviders()
    } catch {
      // 验证失败时仍刷新一次:getHealth 自身会带上失败原因
    }
    return this.refresh()
  }

  /** 地址变更后清空旧状态,避免用过期的健康信息做决策。 */
  invalidate(): void {
    this.generation += 1
    this.snapshot = UNREACHABLE_SNAPSHOT
    this.restartRequested = true
  }

  private async fetchAndCache(): Promise<BackendHealthSnapshot> {
    const generation = this.generation
    let snapshot: BackendHealthSnapshot
    try {
      const health = await this.client.getHealth()
      snapshot = { checkedAt: this.now(), health, failure: null }
    } catch (error) {
      snapshot = {
        checkedAt: this.now(),
        health: null,
        failure: error instanceof Error ? error.message : '云端服务不可用。',
      }
    }
    if (generation === this.generation) {
      this.snapshot = snapshot
    }
    return snapshot
  }
}
