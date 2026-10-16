import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { StorageBackupService } from '../../src/application/storageBackupService'
import { IndexedDbStorage } from '../../src/infrastructure/storage/indexedDbStorage'
import { trainingSessionSchema, recordBelongsToAccount } from '../../src/domain'

const json = readFileSync('artifacts/demo-history/ielts-meow-demo-history-v2.2.2.json', 'utf8')
const data = JSON.parse(json)

describe('录屏演示备份实际导入路径', () => {
  it('导入、重开、重复导入、导出再恢复，保留其他账号原记录与当前账号', async () => {
    const name = 'demo-backup-verification-' + Date.now()
    let db = new IndexedDbStorage({ databaseName: name })
    const otherOwner = 'cc971de7-2c56-48e5-912a-33d9f0c11455'
    const otherAccount = { ...data.accounts[0], id: 'verification-other-account', userId: otherOwner, displayName: '原有账号' }
    const existing = trainingSessionSchema.parse({ ...data.sessions[0], id: 'verification-existing-session', ownerId: otherOwner })
    let restored: IndexedDbStorage | undefined
    try {
      await db.upsertAccount(otherAccount)
      await db.setCurrentAccountId(otherAccount.id)
      await db.upsertSession(existing)
      const importer = new StorageBackupService(db, db)
      const result = await importer.importBackup(new Blob([json], { type: 'application/json' }))
      expect(result).toMatchObject({ sessions: 8, expressions: 16, personalMaterials: 8, accounts: 1, recordings: 0, knowledgeEntries: 4 })
      expect(await db.getCurrentAccountId()).toBe(otherAccount.id)
      expect(await db.getSession(existing.id)).toEqual(existing)
      expect((await db.listSessions()).filter(s => recordBelongsToAccount(s.ownerId, otherOwner))).toHaveLength(1)
      await importer.importBackup(new Blob([json]))
      expect(await db.listSessions()).toHaveLength(9)
      expect(await db.listExpressions()).toHaveLength(16)
      expect(await db.listAccounts()).toHaveLength(2)
      await db.close()
      db = new IndexedDbStorage({ databaseName: name })
      const demoSessions = (await db.listSessions()).filter(s => recordBelongsToAccount(s.ownerId, data.accounts[0].userId))
      expect(demoSessions).toHaveLength(8)
      expect(demoSessions.every(s => s.status === 'completed' && s.attempts.length === 2)).toBe(true)
      expect(demoSessions.every(s => s.aiFeedback?.summary.includes('虚构演示'))).toBe(true)
      for (const session of demoSessions) {
        const second = session.attempts[1].transcript.text
        for (const fact of session.confirmedMemoryFacts) expect(second).toContain(fact.sourceSentence)
      }
      expect(await db.listUserKnowledgeEntries(data.accounts[0].userId)).toHaveLength(4)
      expect(await db.listPersonalMaterials(data.accounts[0].userId)).toHaveLength(8)
      const exported = await new StorageBackupService(db, db).exportBackup()
      restored = new IndexedDbStorage({ databaseName: name + '-roundtrip' })
      await new StorageBackupService(restored, restored).importBackup(exported)
      expect(await restored.listSessions()).toHaveLength(9)
      expect(await restored.listExpressions()).toHaveLength(16)
      expect(await restored.listUserKnowledgeEntries(data.accounts[0].userId)).toHaveLength(4)
    } finally {
      await db.close()
      await restored?.close()
    }
  })
})
