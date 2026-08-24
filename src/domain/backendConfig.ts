import { z } from 'zod'

function parseIpv4(hostname: string): readonly number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null

  const bytes = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN
    const value = Number(part)
    return value >= 0 && value <= 255 ? value : Number.NaN
  })
  return bytes.every(Number.isFinite) ? bytes : null
}

export function isPrivateLanHost(value: string): boolean {
  const host = value.toLowerCase()
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.local')
  ) {
    return true
  }

  const ipv4 = parseIpv4(host)
  if (!ipv4) return false
  const [first, second] = ipv4
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 168) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31)
  )
}

export function normalizeBackendBaseUrl(value: string): string {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const supportedPath = path === '/' || path.toLowerCase() === '/health'
    if (
      !supportedPath ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return trimmed
    }
    return url.origin
  } catch {
    return trimmed
  }
}

export function isSafeBackendBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      return false
    }

    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && isPrivateLanHost(url.hostname)
  } catch {
    return false
  }
}

const backendBaseUrl = z
  .string()
  .trim()
  .max(500)
  .transform(normalizeBackendBaseUrl)
  .refine(isSafeBackendBaseUrl, {
    message:
      '公网地址必须使用 HTTPS；HTTP 仅允许 localhost、.local 或完整的私有局域网 IP。地址不能包含账号、查询参数、片段或路径前缀。',
  })

/** 用户自建 Backend 的连接地址。第三方凭证始终只存在于 Backend。 */
export const backendConfigSchema = z
  .object({
    id: z.literal('backend'),
    baseUrl: backendBaseUrl,
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export type BackendConfig = z.infer<typeof backendConfigSchema>
