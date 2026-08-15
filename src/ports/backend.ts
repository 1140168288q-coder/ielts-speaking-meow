import type { BackendConfig } from '../domain'

/** 用户自建 Backend 地址的本地存储。 */
export interface BackendConfigStorage {
  getBackendConfig(): Promise<BackendConfig | null>
  saveBackendConfig(config: BackendConfig): Promise<void>
  /** 删除用户保存的运行时地址(正式版本地址被锁定时用于清理旧设备数据)。 */
  clearBackendConfig(): Promise<void>
}
