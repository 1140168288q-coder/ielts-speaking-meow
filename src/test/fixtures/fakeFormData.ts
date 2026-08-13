import { vi } from 'vitest'

/**
 * jsdom 的 FormData.append 会拒绝 Blob(环境缺陷,真机浏览器无此问题)。
 * 测试里用这个兼容实现替换全局 FormData,保留 get() 语义以便断言。
 */
export class FakeFormData {
  private entries = new Map<string, unknown>()

  append(key: string, value: unknown): void {
    this.entries.set(key, value)
  }

  get(key: string): unknown {
    return this.entries.get(key) ?? null
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }
}

export function installFakeFormData(): void {
  vi.stubGlobal('FormData', FakeFormData)
}
