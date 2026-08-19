import { z } from 'zod'
import { isoDateTimeSchema } from './models'

/**
 * 简易本地账号。
 *
 * V1.8 第一版只解决三件事:
 * 1. 用户身份(昵称 + 稳定 userId,未来云同步用 userId 对齐远端账号);
 * 2. 个人数据隔离(练习、表达、导入题都写 ownerId);
 * 3. 本地切换(可选 4-6 位 PIN,只用于防止误切换,不是加密)。
 *
 * 不做注册/找回密码/社交/会员。PIN 只做 SHA-256 摘要后保存,明文不落盘;
 * 但它不能替代系统锁屏,卸载应用也会清除所有账号数据。
 */

export const LOCAL_DEFAULT_ACCOUNT_ID = 'account-local-default'
/** 稳定 UUID:V1.8 之前的旧数据(无 ownerId)都视为本机用户所有。 */
export const LOCAL_DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001'

/**
 * 判断一条 V1.8 记录是否属于当前账号。
 * undefined ownerId 是 V1.8 前的历史数据,只对默认账号可见。
 */
export function recordBelongsToAccount(
  ownerId: string | undefined,
  currentUserId: string,
): boolean {
  if (ownerId === undefined) {
    return currentUserId === LOCAL_DEFAULT_USER_ID
  }
  return ownerId === currentUserId
}

const nonEmptyText = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength)

export const accountProfileSchema = z
  .object({
    /** 本地存储 key,固定用于默认账号。 */
    id: nonEmptyText(120),
    /** 跨设备/未来云同步使用的稳定身份。 */
    userId: z.string().uuid(),
    displayName: nonEmptyText(40),
    pinHash: z.string().trim().max(128).nullable(),
    cloudAccountId: nonEmptyText(160).nullable().optional(),
    createdAt: isoDateTimeSchema,
    lastLoginAt: isoDateTimeSchema,
  })
  .strict()

export const accountPinSchema = z
  .string()
  .trim()
  .regex(/^\d{4,6}$/)

export type AccountProfile = z.infer<typeof accountProfileSchema>

export const DEFAULT_DISPLAY_NAME = '本机用户'
