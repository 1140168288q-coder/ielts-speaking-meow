import { describe, expect, it, vi } from 'vitest'
import type {
  CloudSyncGateway,
  CloudSyncEntityType,
  SyncChange,
  SyncOutboxOperation,
  SyncPullResponse,
  SyncPushItem,
  SyncPushResponse,
} from '../domain/cloudSync'
import type { CloudSyncStorage, SyncEntityState } from '../ports/storage'
import { CloudSyncService } from './cloudSyncService'

const CREATED_AT = '2026-08-21T10:00:00.000Z'

describe('CloudSyncService', () => {
  it('removes only applied operations and keeps conflicts and rejections', async () => {
    const storage = new MemorySyncStorage()
    const gateway = new StubGateway()
    const service = createService(storage, gateway)
    const applied = await enqueue(service, 'applied')
    const conflict = await enqueue(service, 'conflict')
    const rejected = await enqueue(service, 'rejected')
    gateway.pushResponse = {
      results: [
        resultFor(applied, 'applied'),
        resultFor(conflict, 'conflict'),
        resultFor(rejected, 'rejected'),
      ],
    }

    await expect(service.flush()).resolves.toMatchObject({
      attempted: 3,
      applied: 1,
      conflicts: 1,
      rejected: 1,
    })
    expect(await storage.listSyncOperations('cloud-user-1')).toEqual([
      conflict,
      rejected,
    ])
  })

  it('uses the last synced version and records the accepted cloud version', async () => {
    const storage = new MemorySyncStorage()
    await storage.setSyncEntityState('cloud-user-1', 'session', 'versioned', {
      version: 4,
      syncedUpdatedAt: '2026-08-20T10:00:00.000Z',
    })
    const gateway = new StubGateway()
    const service = createService(storage, gateway)
    const operation = await service.enqueue({
      entityType: 'session',
      entityId: 'versioned',
      payload: { id: 'versioned', updatedAt: CREATED_AT },
      deletedAt: null,
    })
    gateway.pushResponse = {
      results: [{ ...resultFor(operation, 'applied'), version: 5 }],
    }

    expect(operation.baseVersion).toBe(4)
    await expect(service.flush()).resolves.toMatchObject({ applied: 1 })
    await expect(
      storage.getSyncEntityState('cloud-user-1', 'session', 'versioned'),
    ).resolves.toEqual({ version: 5, syncedUpdatedAt: CREATED_AT })
  })

  it('retains the outbox across a network failure and retries the same operationId', async () => {
    const storage = new MemorySyncStorage()
    const gateway = new StubGateway()
    const service = createService(storage, gateway)
    const operation = await enqueue(service, 'retry')
    gateway.pushError = new TypeError('offline')

    await expect(service.flush()).rejects.toThrow('offline')
    expect(await storage.listSyncOperations('cloud-user-1')).toEqual([operation])

    gateway.pushError = null
    gateway.pushResponse = { results: [resultFor(operation, 'applied')] }
    await expect(service.flush()).resolves.toMatchObject({ applied: 1 })
    expect(gateway.pushed.map((batch) => batch[0]?.operationId)).toEqual([
      operation.operationId,
      operation.operationId,
    ])
    expect(await storage.listSyncOperations('cloud-user-1')).toEqual([])
  })

  it('rejects incomplete push responses without removing queued data', async () => {
    const storage = new MemorySyncStorage()
    const gateway = new StubGateway()
    const service = createService(storage, gateway)
    const operation = await enqueue(service, 'missing-result')
    gateway.pushResponse = { results: [] }

    await expect(service.flush()).rejects.toMatchObject({
      code: 'invalid-response',
    })
    expect(await storage.listSyncOperations('cloud-user-1')).toEqual([operation])
  })

  it('applies paged changes in order and resumes from the persisted cursor', async () => {
    const storage = new MemorySyncStorage()
    const gateway = new StubGateway()
    const applied: SyncChange[] = []
    const service = createService(storage, gateway, (change) => {
      applied.push(change)
      return Promise.resolve()
    })
    gateway.pullResponses = [
      {
        changes: [changeAt(1), changeAt(2)],
        nextCursor: 2,
        hasMore: true,
      },
      {
        changes: [changeAt(3)],
        nextCursor: 3,
        hasMore: false,
      },
    ]

    await expect(service.pull(2)).resolves.toEqual({ applied: 3, cursor: 3 })
    expect(applied.map((change) => change.cursor)).toEqual([1, 2, 3])
    expect(await storage.getSyncCursor('cloud-user-1')).toBe(3)
    expect(
      await storage.getSyncEntityState('cloud-user-1', 'session', 'session-3'),
    ).toEqual({ version: 1, syncedUpdatedAt: CREATED_AT })
    expect(gateway.pulledCursors).toEqual([0, 2])

    gateway.pullResponses = [{ changes: [], nextCursor: 3, hasMore: false }]
    await service.pull()
    expect(gateway.pulledCursors.at(-1)).toBe(3)
  })

  it('does not advance past a change that failed to apply', async () => {
    const storage = new MemorySyncStorage()
    const gateway = new StubGateway()
    const applyChange = vi.fn((change: SyncChange) => {
      return change.cursor === 2
        ? Promise.reject(new Error('local write failed'))
        : Promise.resolve()
    })
    const service = createService(storage, gateway, applyChange)
    gateway.pullResponses = [{
      changes: [changeAt(1), changeAt(2)],
      nextCursor: 2,
      hasMore: false,
    }]

    await expect(service.pull()).rejects.toThrow('local write failed')
    expect(await storage.getSyncCursor('cloud-user-1')).toBe(1)
  })
})

class MemorySyncStorage implements CloudSyncStorage {
  private readonly operations = new Map<string, SyncOutboxOperation>()
  private readonly cursors = new Map<string, number>()
  private readonly entityStates = new Map<string, SyncEntityState>()

  listLocalDeletionTombstones() {
    return Promise.resolve([])
  }

  removeLocalDeletionTombstone() {
    return Promise.resolve()
  }

  commitPulledSyncChange(
    scopeId: string,
    change: SyncChange,
    state: SyncEntityState,
  ): Promise<void> {
    this.entityStates.set(
      `${scopeId}:${change.entityType}:${change.entityId}`,
      state,
    )
    this.cursors.set(scopeId, change.cursor)
    return Promise.resolve()
  }

  async enqueueSyncOperation(
    scopeId: string,
    operation: SyncOutboxOperation,
  ): Promise<'created' | 'already-enqueued'> {
    await Promise.resolve()
    const key = `${scopeId}:${operation.operationId}`
    if (this.operations.has(key)) return 'already-enqueued'
    this.operations.set(key, operation)
    return 'created'
  }

  async listSyncOperations(
    scopeId: string,
    limit = 100,
  ): Promise<SyncOutboxOperation[]> {
    await Promise.resolve()
    return [...this.operations.entries()]
      .filter(([key]) => key.startsWith(`${scopeId}:`))
      .map(([, operation]) => operation)
      .slice(0, limit)
  }

  async removeSyncOperation(scopeId: string, operationId: string): Promise<void> {
    await Promise.resolve()
    this.operations.delete(`${scopeId}:${operationId}`)
  }

  async getSyncCursor(scopeId: string): Promise<number> {
    await Promise.resolve()
    return this.cursors.get(scopeId) ?? 0
  }

  async setSyncCursor(scopeId: string, cursor: number): Promise<void> {
    await Promise.resolve()
    this.cursors.set(scopeId, cursor)
  }

  async getSyncEntityState(
    scopeId: string,
    entityType: CloudSyncEntityType,
    entityId: string,
  ): Promise<SyncEntityState> {
    await Promise.resolve()
    return this.entityStates.get(`${scopeId}:${entityType}:${entityId}`) ?? {
      version: 0,
      syncedUpdatedAt: null,
    }
  }

  async setSyncEntityState(
    scopeId: string,
    entityType: CloudSyncEntityType,
    entityId: string,
    state: SyncEntityState,
  ): Promise<void> {
    await Promise.resolve()
    this.entityStates.set(`${scopeId}:${entityType}:${entityId}`, state)
  }
}

class StubGateway implements CloudSyncGateway {
  pushResponse: SyncPushResponse = { results: [] }
  pushError: Error | null = null
  pullResponses: SyncPullResponse[] = []
  pushed: SyncPushItem[][] = []
  pulledCursors: number[] = []

  async push(items: SyncPushItem[]): Promise<SyncPushResponse> {
    await Promise.resolve()
    this.pushed.push(items)
    if (this.pushError !== null) throw this.pushError
    return this.pushResponse
  }

  async pull(cursor: number): Promise<SyncPullResponse> {
    await Promise.resolve()
    this.pulledCursors.push(cursor)
    const response = this.pullResponses.shift()
    if (response === undefined) throw new Error('Missing pull response.')
    return response
  }
}

function createService(
  storage: CloudSyncStorage,
  gateway: CloudSyncGateway,
  applyChange: (change: SyncChange) => Promise<void> = () => Promise.resolve(),
): CloudSyncService {
  let sequence = 0
  return new CloudSyncService({
    scopeId: 'cloud-user-1',
    storage,
    gateway,
    applyChange,
    createOperationId: () => `operation-${++sequence}`,
    now: () => CREATED_AT,
  })
}

async function enqueue(
  service: CloudSyncService,
  entityId: string,
): Promise<SyncOutboxOperation> {
  return service.enqueue({
    entityType: 'session',
    entityId,
    baseVersion: 0,
    payload: { id: entityId },
    deletedAt: null,
  })
}

function resultFor(
  operation: SyncOutboxOperation,
  status: 'applied' | 'conflict' | 'rejected',
) {
  return {
    operationId: operation.operationId,
    entityType: operation.entityType,
    entityId: operation.entityId,
    status,
    version: status === 'applied' ? 1 : 0,
    cursor: status === 'applied' ? 1 : null,
    replayed: false,
    code: status === 'applied' ? null : 'test-result',
    message: null,
    current: null,
  } as const
}

function changeAt(cursor: number): SyncChange {
  return {
    cursor,
    entityType: 'session',
    entityId: `session-${cursor}`,
    version: 1,
    payload: { id: `session-${cursor}` },
    deletedAt: null,
    updatedAt: CREATED_AT,
  }
}
