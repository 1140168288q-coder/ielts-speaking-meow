import { z } from 'zod'
import {
  accountProfileSchema,
  importedQuestionRecordSchema,
  importSourceSchema,
  isoDateTimeSchema,
  personalMaterialSchema,
  savedExpressionSchema,
  trainingSessionSchema,
  LOCAL_DEFAULT_USER_ID,
  type PersonalMaterial,
  type SavedExpression,
  type TrainingSession,
} from '../domain'
import type { AccountStorage } from '../ports/accounts'
import type { ImportStorage } from '../ports/imports'
import type { AudioStorage, LocalStorage } from '../ports/storage'

const backupAudioSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    mimeType: z.string().trim().min(1).max(120),
    dataBase64: z.string().min(1).max(400_000_000),
  })
  .strict()

const localBackupSchema = z
  .object({
    format: z.literal('ielts-speaking-meow-backup'),
    formatVersion: z.union([z.literal(1), z.literal(2)]),
    exportedAt: isoDateTimeSchema,
    sessions: z.array(trainingSessionSchema).max(20_000),
    expressions: z.array(savedExpressionSchema).max(50_000),
    audio: z.array(backupAudioSchema).max(40_000),
    /** V2 fields are optional so V1 backups remain importable. */
    accounts: z.array(accountProfileSchema).max(1_000).optional(),
    currentAccountId: z.string().max(160).nullable().optional(),
    personalMaterials: z.array(personalMaterialSchema).max(50_000).optional(),
    importSources: z.array(importSourceSchema).max(5_000).optional(),
    importedQuestions: z.array(importedQuestionRecordSchema).max(20_000).optional(),
    importedFiles: z.array(backupAudioSchema).max(5_000).optional(),
  })
  .strict()

export interface BackupImportResult {
  sessions: number
  expressions: number
  recordings: number
  personalMaterials: number
  importedQuestions: number
  accounts: number
  skippedNewer: number
}

/** Portable user-controlled backup. The JSON contains private audio in base64. */
export class StorageBackupService {
  constructor(
    private readonly localStorage: LocalStorage,
    private readonly audioStorage: AudioStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async exportBackup(): Promise<Blob> {
    const [sessions, expressions] = await Promise.all([
      this.localStorage.listSessions(),
      this.localStorage.listExpressions(),
    ])
    const accountStorage = this.localStorage as LocalStorage & Partial<AccountStorage>
    const importStorage = this.localStorage as LocalStorage & Partial<ImportStorage>
    const accounts = accountStorage.listAccounts === undefined
      ? []
      : await accountStorage.listAccounts()
    const currentAccountId = accountStorage.getCurrentAccountId === undefined
      ? null
      : await accountStorage.getCurrentAccountId()
    const ownerIds = new Set(accounts.map((account) => account.userId))
    if (ownerIds.size === 0) ownerIds.add(LOCAL_DEFAULT_USER_ID)
    const personalMaterials = accountStorage.listPersonalMaterials === undefined
      ? []
      : (await Promise.all(
          [...ownerIds].map((ownerId) => accountStorage.listPersonalMaterials(ownerId, { includeDeleted: true })),
        )).flat()
    const importSources = importStorage.listImportSources === undefined
      ? []
      : await importStorage.listImportSources()
    const importedQuestions = importStorage.listImportedQuestions === undefined
      ? []
      : (await Promise.all(
          [...ownerIds].map((ownerId) => importStorage.listImportedQuestions!(ownerId)),
        )).flat()
    const importedFiles = []
    if (importStorage.getImportedFile !== undefined) {
      for (const source of importSources) {
        const file = await importStorage.getImportedFile(source.originalFileId)
        if (file !== null) {
          importedFiles.push({
            id: source.originalFileId,
            mimeType: file.type || source.mimeType || 'application/octet-stream',
            dataBase64: await blobToBase64(file),
          })
        }
      }
    }
    const audioIds = [...new Set(
      sessions.flatMap((session) =>
        session.attempts.flatMap((attempt) =>
          attempt.audio ? [attempt.audio.id] : [],
        ),
      ),
    )]
    const audio = []
    for (const audioId of audioIds) {
      const blob = await this.audioStorage.getAudio(audioId)
      if (blob === null) {
        throw new Error(`备份失败：练习引用的录音 ${audioId} 已不存在。`)
      }
      audio.push({
        id: audioId,
        mimeType: blob.type || 'application/octet-stream',
        dataBase64: await blobToBase64(blob),
      })
    }

    const backup = localBackupSchema.parse({
      format: 'ielts-speaking-meow-backup',
      formatVersion: 2,
      exportedAt: this.now().toISOString(),
      sessions,
      expressions,
      audio,
      accounts,
      currentAccountId,
      personalMaterials,
      importSources,
      importedQuestions,
      importedFiles,
    })
    return new Blob([JSON.stringify(backup)], {
      type: 'application/json',
    })
  }

  async importBackup(file: Blob): Promise<BackupImportResult> {
    if (file.size > 300 * 1024 * 1024) {
      throw new Error('备份文件超过 300MB，已拒绝导入。')
    }
    let raw: unknown
    try {
      raw = JSON.parse(await file.text()) as unknown
    } catch {
      throw new Error('备份文件不是有效 JSON。')
    }
    const parsed = localBackupSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error('备份结构无效或版本不受支持。')
    }

    const audioById = new Map(parsed.data.audio.map((item) => [item.id, item]))
    for (const session of parsed.data.sessions) {
      for (const attempt of session.attempts) {
        if (attempt.audio && !audioById.has(attempt.audio.id)) {
          throw new Error(`备份缺少练习所需录音：${attempt.audio.id}`)
        }
      }
    }

    const accountStorage = this.localStorage as LocalStorage & Partial<AccountStorage>
    const importStorage = this.localStorage as LocalStorage & Partial<ImportStorage>
    const v2 = parsed.data.formatVersion === 2
    if (v2 && (parsed.data.accounts?.length ?? 0) > 0 && accountStorage.upsertAccount === undefined) {
      throw new Error('当前存储不支持恢复本地账号，请在原设备或新版 App 中导入。')
    }
    if (v2 && (parsed.data.personalMaterials?.length ?? 0) > 0 && accountStorage.upsertPersonalMaterial === undefined) {
      throw new Error('当前存储不支持恢复个人素材，请升级 App 后再试。')
    }
    if (
      v2 &&
      ((parsed.data.importSources?.length ?? 0) > 0 || (parsed.data.importedQuestions?.length ?? 0) > 0) &&
      importStorage.saveImportBundle === undefined
    ) {
      throw new Error('当前存储不支持恢复导入材料，请升级 App 后再试。')
    }

    const existingAccounts = accountStorage.listAccounts === undefined
      ? []
      : await accountStorage.listAccounts()
    const existingAccountById = new Map(existingAccounts.map((account) => [account.id, account]))
    for (const account of parsed.data.accounts ?? []) {
      const existing = existingAccountById.get(account.id)
      if (existing !== undefined && existing.userId !== account.userId) {
        throw new Error(`备份中的本地账号 ${account.displayName} 与当前设备身份冲突，未写入任何账号。`)
      }
    }
    const newerAccountIds = new Set<string>()
    for (const account of parsed.data.accounts ?? []) {
      const existing = existingAccountById.get(account.id)
      if (existing !== undefined && isTimestampNewer(existing.lastLoginAt, account.lastLoginAt)) {
        newerAccountIds.add(account.id)
      }
    }

    const newerSessionIds = new Set<string>()
    for (const session of parsed.data.sessions) {
      const existing = await this.localStorage.getSession(session.id)
      if (existing !== null && isTimestampNewer(existing.updatedAt, session.updatedAt)) {
        newerSessionIds.add(session.id)
      }
    }
    const newerExpressionIds = new Set<string>()
    for (const expression of parsed.data.expressions) {
      const existing = await this.localStorage.getExpression(expression.id)
      if (existing !== null && isTimestampNewer(
        existing.updatedAt ?? existing.createdAt,
        expression.updatedAt ?? expression.createdAt,
      )) {
        newerExpressionIds.add(expression.id)
      }
    }

    const newerMaterialIds = new Set<string>()
    if (accountStorage.listPersonalMaterials !== undefined) {
      const existingMaterials = new Map<string, PersonalMaterial>()
      const materialOwners = new Set(
        (parsed.data.personalMaterials ?? []).map((material) => material.ownerId),
      )
      for (const ownerId of materialOwners) {
        const materials = await accountStorage.listPersonalMaterials(ownerId, { includeDeleted: true })
        for (const material of materials) existingMaterials.set(material.id, material)
      }
      for (const material of parsed.data.personalMaterials ?? []) {
        const existing = existingMaterials.get(material.id)
        if (existing !== undefined && isTimestampNewer(existing.updatedAt, material.updatedAt)) {
          newerMaterialIds.add(material.id)
        }
      }
    }

    const importSources = parsed.data.importSources ?? []
    const importedQuestions = parsed.data.importedQuestions ?? []
    const importedFiles = new Map(
      (parsed.data.importedFiles ?? []).map((item) => [item.id, base64ToBlob(item.dataBase64, item.mimeType)]),
    )
    const sourceIds = new Set(importSources.map((source) => source.id))
    for (const question of importedQuestions) {
      if (!sourceIds.has(question.sourceId)) {
        throw new Error(`备份中的导入题 ${question.id} 缺少来源材料。`)
      }
    }
    for (const source of importSources) {
      const file = importedFiles.get(source.originalFileId)
      if (file === undefined) {
        throw new Error(`备份缺少导入材料文件：${source.originalFileId}`)
      }
      if (file.size !== source.fileSize) {
        throw new Error(`导入材料文件大小与备份元数据不一致：${source.fileName}`)
      }
    }
    const newerImportSourceIds = new Set<string>()
    if (importStorage.listImportSources !== undefined) {
      const existingSources = await importStorage.listImportSources()
      const existingById = new Map(existingSources.map((source) => [source.id, source]))
      for (const source of importSources) {
        const existing = existingById.get(source.id)
        if (existing !== undefined && isTimestampNewer(existing.importedAt, source.importedAt)) {
          newerImportSourceIds.add(source.id)
        }
      }
    }
    const newerImportedQuestionIds = new Set<string>()
    if (importStorage.listImportedQuestions !== undefined) {
      const existingQuestions = new Map<string, typeof importedQuestions[number]>()
      const owners = new Set(
        importedQuestions.map((question) => question.ownerId ?? LOCAL_DEFAULT_USER_ID),
      )
      for (const ownerId of owners) {
        const questions = await importStorage.listImportedQuestions(ownerId)
        for (const question of questions) existingQuestions.set(question.id, question)
      }
      for (const question of importedQuestions) {
        const existing = existingQuestions.get(question.id)
        if (existing !== undefined && isTimestampNewer(existing.createdAt, question.createdAt)) {
          newerImportedQuestionIds.add(question.id)
        }
      }
    }

    // Durability order mirrors PracticeService: binary data first, metadata second.
    for (const item of parsed.data.audio) {
      await this.audioStorage.saveAudio(
        item.id,
        base64ToBlob(item.dataBase64, item.mimeType),
      )
    }
    for (const session of parsed.data.sessions) {
      if (!newerSessionIds.has(session.id)) await this.localStorage.upsertSession(session)
    }
    for (const expression of parsed.data.expressions) {
      if (!newerExpressionIds.has(expression.id)) await this.localStorage.upsertExpression(expression)
    }

    let restoredMaterials = 0
    if (accountStorage.upsertAccount !== undefined) {
      for (const account of parsed.data.accounts ?? []) {
        if (!newerAccountIds.has(account.id)) await accountStorage.upsertAccount(account)
      }
      if (
        parsed.data.currentAccountId !== undefined &&
        parsed.data.currentAccountId !== null &&
        (parsed.data.accounts ?? []).some((account) => account.id === parsed.data.currentAccountId) &&
        accountStorage.setCurrentAccountId !== undefined
      ) {
        await accountStorage.setCurrentAccountId(parsed.data.currentAccountId)
      }
    }
    if (accountStorage.upsertPersonalMaterial !== undefined) {
      for (const material of parsed.data.personalMaterials ?? []) {
        if (newerMaterialIds.has(material.id)) continue
        await accountStorage.upsertPersonalMaterial(material)
        restoredMaterials += 1
      }
    }
    let restoredQuestions = 0
    if (
      importStorage.saveImportBundle !== undefined &&
      parsed.data.importSources !== undefined &&
      parsed.data.importedQuestions !== undefined
    ) {
      for (const source of importSources) {
        if (newerImportSourceIds.has(source.id)) continue
        const file = importedFiles.get(source.originalFileId)
        if (file === undefined) continue
        const questions = importedQuestions.filter(
          (question) => question.sourceId === source.id && !newerImportedQuestionIds.has(question.id),
        )
        await importStorage.saveImportBundle({
          source,
          originalFile: file,
          questions,
        })
        restoredQuestions += questions.length
      }
    }

    return {
      sessions: parsed.data.sessions.length - newerSessionIds.size,
      expressions: parsed.data.expressions.length - newerExpressionIds.size,
      recordings: parsed.data.audio.length,
      personalMaterials: restoredMaterials,
      importedQuestions: restoredQuestions,
      accounts: (parsed.data.accounts?.length ?? 0) - newerAccountIds.size,
      skippedNewer:
        newerSessionIds.size +
        newerExpressionIds.size +
        newerAccountIds.size +
        newerMaterialIds.size +
        newerImportSourceIds.size +
        newerImportedQuestionIds.size,
    }
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    chunks.push(String.fromCharCode(...chunk))
  }
  return globalThis.btoa(chunks.join(''))
}

function base64ToBlob(value: string, mimeType: string): Blob {
  try {
    const binary = globalThis.atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new Blob([bytes], { type: mimeType })
  } catch {
    throw new Error('备份中的录音编码无效。')
  }
}

function isTimestampNewer(existing: string, incoming: string): boolean {
  return Date.parse(existing) > Date.parse(incoming)
}

export type LocalBackupSession = TrainingSession
export type LocalBackupExpression = SavedExpression
