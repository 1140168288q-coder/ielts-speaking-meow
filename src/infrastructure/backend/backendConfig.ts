/**
 * Backend 地址解析。构建期通过 VITE_BACKEND_URL 注入:
 * - Android 模拟器开发:默认 http://10.0.2.2:8000(宿主机的 localhost)
 * - 生产构建:VITE_BACKEND_URL=https://your-backend.example.com npm run build
 */
const DEFAULT_BACKEND_URL = 'http://10.0.2.2:8000'

export function resolveBackendUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_URL as string | undefined
  return (configured ?? DEFAULT_BACKEND_URL).trim().replace(/\/+$/, '')
}
