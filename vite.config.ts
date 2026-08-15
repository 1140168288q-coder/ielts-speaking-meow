import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * 正式构建(VITE_LOCK_BACKEND_URL=true)会把 Backend 地址写死进安装包,
 * 设置页不再允许编辑。因此构建期必须校验:
 * 1. 必须提供 VITE_BACKEND_URL;
 * 2. 默认必须是 HTTPS;仅当构建脚本同时打开 VITE_ALLOW_LAN_HTTP=true
 *    时才允许私有局域网 HTTP(家庭 Backend 过渡方案),公网明文 HTTP
 *    与模拟器缺省地址永远不允许进入正式包。
 * 校验失败直接终止构建,避免产出看似正式、实际连不上正确后端的 APK。
 */
const PRIVATE_IPV4_PATTERNS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
]

function isPrivateLanHost(host: string): boolean {
  const hostname = host.toLowerCase()
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(hostname))
  )
}

function assertReleaseBackendUrl(env: Record<string, string>): void {
  if (env.VITE_LOCK_BACKEND_URL !== 'true') {
    return
  }
  const raw = (env.VITE_BACKEND_URL ?? '').trim()
  if (raw.length === 0) {
    throw new Error(
      '正式构建缺少 VITE_BACKEND_URL:请通过 android-build.ps1 -Release -BackendUrl https://... 构建。',
    )
  }
  let parsed: URL
  try {
    parsed = new URL(raw.replace(/\/health$/i, ''))
  } catch {
    throw new Error(`正式构建的 VITE_BACKEND_URL 不是合法地址:${raw}`)
  }
  const allowLanHttp = env.VITE_ALLOW_LAN_HTTP === 'true'
  if (parsed.protocol === 'https:') {
    return
  }
  if (parsed.protocol === 'http:' && allowLanHttp && isPrivateLanHost(parsed.hostname)) {
    return
  }
  throw new Error(
    `正式构建的 Backend 地址必须是 HTTPS(当前:${raw});私有局域网 HTTP 例外需显式开启 -AllowLanHttp。`,
  )
}

export default defineConfig(({ mode }) => {
  assertReleaseBackendUrl(loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      restoreMocks: true,
    },
  }
})
