import { z } from 'zod'

const PRIVATE_IPV4_PATTERNS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
] as const

function isLocalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false

    const host = url.hostname.toLowerCase()
    return host === 'localhost' ||
      host === '::1' ||
      host.endsWith('.local') ||
      PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host))
  } catch {
    return false
  }
}

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine(isLocalHttpUrl, {
    message: '公网地址必须使用 HTTPS；HTTP 仅允许 localhost、.local 或私有局域网地址。',
  })

/** 用户自建 Backend 的连接地址。第三方凭证始终只存在于 Backend。 */
export const backendConfigSchema = z
  .object({
    id: z.literal('backend'),
    baseUrl: httpUrl,
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export type BackendConfig = z.infer<typeof backendConfigSchema>
