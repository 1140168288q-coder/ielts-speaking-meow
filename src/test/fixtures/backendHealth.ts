import type {
  BackendHealth,
  BackendProviderHealth,
} from '../../infrastructure/backend/backendClient'

/** 构造新 /health 结构里的单供应商信息,默认"已配置但尚未验证"。 */
export function makeProviderHealth(
  overrides: Partial<BackendProviderHealth> = {},
): BackendProviderHealth {
  return {
    configured: true,
    model: 'test-model',
    verification: {
      status: 'unverified',
      checkedAt: null,
      latencyMs: null,
      lastError: null,
      lastResult: null,
    },
    ...overrides,
  }
}

export function makeBackendHealth(
  providers: Record<string, BackendProviderHealth | boolean>,
  version = '1.5.0',
): BackendHealth {
  const entries = Object.entries(providers).map(([name, value]) => {
    if (value === true) return [name, makeProviderHealth()]
    if (value === false) {
      return [name, makeProviderHealth({ configured: false })]
    }
    return [name, value]
  })
  return {
    status: 'ok',
    version,
    providers: Object.fromEntries(entries) as Record<
      string,
      BackendProviderHealth
    >,
  }
}
