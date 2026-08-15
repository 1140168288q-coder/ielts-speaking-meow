import { z } from 'zod'
import {
  isoDateTimeSchema,
  savedExpressionSchema,
  trainingSessionSchema,
  type SavedExpression,
  type TrainingSession,
} from '../domain/models'
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
    formatVersion: z.literal(1),
    exportedAt: isoDateTimeSchema,
    sessions: z.array(trainingSessionSchema).max(20_000),
    expressions: z.array(savedExpressionSchema).max(50_000),
    audio: z.array(backupAudioSchema).max(40_000),
  })
  .strict()

export interface BackupImportResult {
  sessions: number
  expressions: number
  recordings: number
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
    const audioIds = [...new Set(
      sessions.flatMap((session) =>
        session.attempts.map((attempt) => attempt.audio.id),
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
      formatVersion: 1,
      exportedAt: this.now().toISOString(),
      sessions,
      expressions,
      audio,
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
        if (!audioById.has(attempt.audio.id)) {
          throw new Error(`备份缺少练习所需录音：${attempt.audio.id}`)
        }
      }
    }

    // Durability order mirrors PracticeService: audio first, metadata second.
    for (const item of parsed.data.audio) {
      await this.audioStorage.saveAudio(
        item.id,
        base64ToBlob(item.dataBase64, item.mimeType),
      )
    }
    for (const session of parsed.data.sessions) {
      await this.localStorage.upsertSession(session)
    }
    for (const expression of parsed.data.expressions) {
      await this.localStorage.upsertExpression(expression)
    }

    return {
      sessions: parsed.data.sessions.length,
      expressions: parsed.data.expressions.length,
      recordings: parsed.data.audio.length,
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

export type LocalBackupSession = TrainingSession
export type LocalBackupExpression = SavedExpression
