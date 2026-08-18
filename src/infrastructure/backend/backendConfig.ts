import { Capacitor } from '@capacitor/core'
import {
  backendConfigSchema,
  type BackendConfig,
} from '../../domain'
import type { BackendConfigStorage } from '../../ports/backend'

/**
 * Backend 地址解析。构建期通过 VITE_BACKEND_URL 注入:
 * - Android 模拟器开发:默认 http://10.0.2.2:8000(宿主机的 localhost)
 * - 网页开发(桌面浏览器直接打开):默认 http://127.0.0.1:8000(与后端同机)
 * - 正式构建:VITE_LOCK_BACKEND_URL=true 且 VITE_BACKEND_URL=https://...
 *   构建脚本会在缺少或非 HTTPS 地址时直接失败(见 vite.config.ts)。
 *
 * 正式构建锁定地址后,设置页只展示状态、不允许编辑;升级时旧版本
 * 保存在设备上的地址会被忽略并清除,不可能覆盖内置地址。
 */
const ANDROID_EMULATOR_DEFAULT_BACKEND_URL = 'http://10.0.2.2:8000'
const WEB_DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000'

/** 正式构建是否锁定 Backend 地址(设置页只读)。 */
export function isBackendUrlLocked(): boolean {
  return import.meta.env.VITE_LOCK_BACKEND_URL === 'true'
}

/**
 * 正式构建是否显式允许私有局域网 HTTP(家庭 Backend 的过渡方案)。
 * 默认关闭:正式构建必须 HTTPS,只有构建脚本同时打开此开关才放行私网 HTTP。
 */
export function allowsLanHttp(): boolean {
  return import.meta.env.VITE_ALLOW_LAN_HTTP === 'true'
}

/**
 * 用户经常会把浏览器测试用的 /health 地址直接粘贴到设置页。BackendClient
 * 自己还会追加 /health，因此这里统一还原为服务基地址。
 */
export function normalizeBackendBaseUrl(value: string): string {
  return value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/health$/i, '')
}

export function resolveBackendUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_URL as string | undefined
  const hasConfigured = (configured ?? '').trim().length > 0
  const platformDefault =
    Capacitor.getPlatform() === 'android'
      ? ANDROID_EMULATOR_DEFAULT_BACKEND_URL
      : WEB_DEFAULT_BACKEND_URL
  const resolved = normalizeBackendBaseUrl(
    hasConfigured ? (configured as string) : platformDefault,
  )
  if (isBackendUrlLocked()) {
    assertLockedBackendUrl(resolved)
  }
  return resolved
}

function assertLockedBackendUrl(value: string): void {
  const valid = backendConfigSchema.safeParse({
    id: 'backend',
    baseUrl: value,
    updatedAt: new Date(0).toISOString(),
  })
  const isHttps = (() => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  })()
  // 正式构建默认强制 HTTPS;只有构建脚本显式打开私网 HTTP 例外时,
  // 才允许 schema 已校验过的私有局域网 HTTP(schema 本身拒绝公网 HTTP)。
  if (!valid.success || (!isHttps && !allowsLanHttp())) {
    throw new Error(
      '正式构建的 Backend 地址无效:必须提供 HTTPS 地址(构建时注入 VITE_BACKEND_URL)。',
    )
  }
}

/**
 * 运行时 Backend 连接配置:构建期默认值 + 用户在设置页保存的覆盖值。
 * load() 必须在 App 启动时调用一次;BackendClient 通过 getter 实时读取,
 * 因此保存新配置后无需重建任何对象。
 */
export class BackendConfigStore {
  private current: BackendConfig | null = null

  constructor(
    private readonly storage: BackendConfigStorage,
    private readonly defaultBaseUrl: string = resolveBackendUrl(),
    private readonly locked: boolean = isBackendUrlLocked(),
  ) {}

  async load(): Promise<void> {
    if (this.locked) {
      // 正式版本:清掉旧版本保存的运行时地址,内置地址永远生效。
      // 清除失败也不阻塞启动:getBaseUrl() 已保证不使用保存值。
      await this.storage.clearBackendConfig().catch(() => undefined)
      this.current = null
      return
    }
    const stored = await this.storage.getBackendConfig()
    // 损坏的本地配置绝不能阻塞 App 启动:校验失败时回退到构建期默认值
    const parsed = stored === null ? null : backendConfigSchema.safeParse(stored)
    this.current = parsed?.success === true
      ? {
          ...parsed.data,
          baseUrl: normalizeBackendBaseUrl(parsed.data.baseUrl),
        }
      : null
  }

  isLocked(): boolean {
    return this.locked
  }

  getBaseUrl(): string {
    if (this.locked) {
      return this.defaultBaseUrl
    }
    return this.current?.baseUrl ?? this.defaultBaseUrl
  }

  /** 用户当前保存的配置;未保存过时返回 null(使用构建期默认地址)。 */
  getSavedConfig(): BackendConfig | null {
    return this.locked ? null : this.current
  }

  async save(baseUrl: string): Promise<BackendConfig> {
    if (this.locked) {
      throw new Error('正式版本的 Backend 地址已固定,不能在设置页修改。')
    }
    const config = backendConfigSchema.parse({
      id: 'backend',
      baseUrl: normalizeBackendBaseUrl(baseUrl),
      updatedAt: new Date().toISOString(),
    })
    await this.storage.saveBackendConfig(config)
    this.current = config
    return config
  }
}
