import { describe, expect, it } from 'vitest'
import type {
  CloudSyncEntityType,
  CloudSyncGateway,
  LocalDeletionTombstone,
  SyncChange,
  SyncOutboxOperation,
  SyncPullResponse,
  SyncPushItem,
  SyncPushResponse,
} from '../domain/cloudSync'
import type {
  PracticeTexts,
  SavedExpression,
  TrainingSession,
} from '../domain/models'
import type { QuestionPracticeState } from '../domain/questionPracticeState'
import type { PersonalMaterial } from '../domain/personalMaterials'
import type {
  CloudSyncStorage,
  ListPersonalMaterialsOptions,
  LocalStorage,
  SyncEntityState,
} from '../ports/storage'
import { AccountCloudSyncService } from './accountCloudSyncService'

const OWNER = '00000000-0000-4000-8000-000000000001'
const OTHER_OWNER = '00000000-0000-4000-8000-000000000002'
const CREATED_AT = '2026-08-20T10:00:00.000Z'
const UPDATED_AT = '2026-08-21T10:00:00.000Z'

describe('AccountCloudSyncService', () => {
  it('uploads only the current owner and strips ownerId and recording references', async () => {
    const storage = new MemoryStorage()
    storage.sessions.set('session-mine', makeSession('session-mine', OWNER, true))
    storage.sessions.set('session-other', makeSession('session-other', OTHER_OWNER))
    storage.expressions.set('expression-mine', makeExpression('expression-mine', OWNER))
    storage.expressions.set('expression-other', makeExpression('expression-other', OTHER_OWNER))
    storage.materials.set('material-mine', makeMaterial('material-mine', OWNER))
    storage.materials.set('material-other', makeMaterial('material-other', OTHER_OWNER))
    const gateway = new StubGateway()
    gateway.pullResponses.push(emptyPull(), emptyPull())

    const summary = await createService(storage, gateway).synchronize()

    expect(summary).toMatchObject({ status: 'synced', queued: 3, uploaded: 3 })
    expect(gateway.events).toEqual(['pull', 'push', 'pull'])
    const pushed = gateway.pushed.flat()
    expect(pushed.map((item) => item.entityId).sort()).toEqual([
      'expression-mine',
      'material-mine',
      'session-mine',
    ])
    for (const item of pushed) {
      expect(item.payload).not.toHaveProperty('ownerId')
    }
    const sessionPayload = pushed.find((item) => item.entityType === 'session')?.payload
    expect(sessionPayload).not.toHaveProperty('readAloud')
    const attempts = sessionPayload?.attempts
    if (!isUnknownArray(attempts) || attempts.length !== 1) {
      throw new Error('Expected one sanitized session attempt.')
    }
    const firstAttempt = attempts[0]
    expect(typeof firstAttempt).toBe('object')
    expect(firstAttempt).not.toBeNull()
    expect(
      typeof firstAttempt === 'object' && firstAttempt !== null &&
      Object.prototype.hasOwnProperty.call(firstAttempt, 'audio'),
    ).toBe(false)
  })

  it('does not queue an unsubmitted first-ready draft', async () => {
    const storage = new MemoryStorage()
    storage.sessions.set('draft-session', makeDraftSession('draft-session', OWNER))
    storage.sessions.set('submitted-session', makeSession('submitted-session', OWNER))
    const gateway = new StubGateway()
    gateway.pullResponses.push(emptyPull(), emptyPull())

    const summary = await createService(storage, gateway).synchronize()

    expect(summary).toMatchObject({ status: 'synced', queued: 1, uploaded: 1 })
    expect(gateway.pushed.flat().map((item) => item.entityId)).toEqual([
      'submitted-session',
    ])
  })

  it('maps remote records to the selected local owner with strict entity separation', async () => {
    const storage = new MemoryStorage()
    const gateway = new StubGateway()
    gateway.pullResponses.push({
      changes: [
        changeFor('session', withoutOwner(makeSession('session-cloud', OWNER)), 1),
        changeFor('expression', withoutOwner(makeExpression('expression-cloud', OWNER)), 2),
        changeFor('personal_material', withoutOwner(makeMaterial('material-cloud', OWNER)), 3),
      ],
      nextCursor: 3,
      hasMore: false,
    }, emptyPull(3))

    const summary = await createService(storage, gateway).synchronize()

    expect(summary).toMatchObject({ status: 'synced', downloaded: 3, queued: 0 })
    expect(storage.sessions.get('session-cloud')?.ownerId).toBe(OWNER)
    expect(storage.expressions.get('expression-cloud')?.ownerId).toBe(OWNER)
    expect(storage.materials.get('material-cloud')?.ownerId).toBe(OWNER)
  })

  it('stops on concurrent changes without overwriting the local record', async () => {
    const storage = new MemoryStorage()
    const local = makeSession('session-1', OWNER, false, UPDATED_AT)
    storage.sessions.set(local.id, local)
    await storage.setSyncEntityState('cloud-account', 'session', local.id, {
      version: 1,
      syncedUpdatedAt: CREATED_AT,
    })
    const gateway = new StubGateway()
    gateway.pullResponses.push({
      changes: [changeFor(
        'session',
        withoutOwner({ ...local, status: 'completed', updatedAt: '2026-08-21T11:00:00.000Z' }),
        1,
        2,
      )],
      nextCursor: 1,
      hasMore: false,
    })

    const summary = await createService(storage, gateway).synchronize()

    expect(summary.status).toBe('conflict')
    expect(summary.conflicts[0]?.reason).toBe('concurrent-change')
    expect(storage.sessions.get(local.id)).toEqual(local)
    expect(await storage.getSyncCursor('cloud-account')).toBe(0)
    expect(gateway.pushed).toHaveLength(0)
  })

  it('retains the durable outbox when the network push fails', async () => {
    const storage = new MemoryStorage()
    storage.expressions.set('expression-1', makeExpression('expression-1', OWNER))
    const gateway = new StubGateway()
    gateway.pullResponses.push(emptyPull())
    gateway.pushError = new TypeError('offline')

    await expect(createService(storage, gateway).synchronize()).rejects.toThrow('offline')

    const pending = await storage.listSyncOperations('cloud-account', 100)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      entityType: 'expression',
      entityId: 'expression-1',
    })
  })

  it('keeps personal materials and personal corpus records independent', async () => {
    const storage = new MemoryStorage()
    storage.expressions.set('shared-id', makeExpression('shared-id', OWNER))
    storage.materials.set('shared-id', makeMaterial('shared-id', OWNER))
    const syncedAt = storage.materials.get('shared-id')?.updatedAt ?? UPDATED_AT
    await storage.setSyncEntityState('cloud-account', 'personal_material', 'shared-id', {
      version: 1,
      syncedUpdatedAt: syncedAt,
    })
    const tombstone = {
      ...makeMaterial('shared-id', OWNER),
      updatedAt: '2026-08-21T12:00:00.000Z',
      deletedAt: '2026-08-21T12:00:00.000Z',
    }
    const gateway = new StubGateway()
    gateway.pullResponses.push({
      changes: [changeFor(
        'personal_material',
        withoutOwner(tombstone),
        1,
        2,
        tombstone.deletedAt,
      )],
      nextCursor: 1,
      hasMore: false,
    }, emptyPull(1))

    const summary = await createService(storage, gateway).synchronize()

    expect(summary.status).toBe('synced')
    expect(storage.materials.get('shared-id')?.deletedAt).toBe(tombstone.deletedAt)
    expect(storage.expressions.get('shared-id')).toEqual(makeExpression('shared-id', OWNER))
    expect(storage.deletedMaterials).toEqual(['shared-id'])
    expect(storage.deletedExpressions).toEqual([])
  })

  it('applies a remote session tombstone and advances the cursor', async () => {
    const storage = new MemoryStorage()
    const session = makeSession('recorded-session', OWNER, true)
    storage.sessions.set(session.id, session)
    const gateway = new StubGateway()
    gateway.pullResponses.push({
      changes: [changeFor('session', {}, 1, 1, UPDATED_AT)],
      nextCursor: 1,
      hasMore: false,
    })

    const summary = await createService(storage, gateway).synchronize()

    expect(summary).toMatchObject({ status: 'synced', downloaded: 1 })
    expect(storage.sessions.has(session.id)).toBe(false)
    expect(storage.deletedSessions).toEqual([session.id])
    expect(await storage.getSyncCursor('cloud-account')).toBe(1)
  })

  it('strictly rejects malformed remote records before changing local data', async () => {
    const storage = new MemoryStorage()
    const gateway = new StubGateway()
    gateway.pullResponses.push({
      changes: [changeFor('expression', {
        ...withoutOwner(makeExpression('expression-1', OWNER)),
        unexpected: true,
      }, 1)],
      nextCursor: 1,
      hasMore: false,
    })

    await expect(createService(storage, gateway).synchronize()).rejects.toMatchObject({
      code: 'invalid-response',
    })
    expect(storage.expressions.size).toBe(0)
    expect(await storage.getSyncCursor('cloud-account')).toBe(0)
  })

  it('flushes all queued records in pages of at most 100', async () => {
    const storage = new MemoryStorage()
    for (let index = 0; index < 101; index += 1) {
      const id = `session-${index.toString().padStart(3, '0')}`
      storage.sessions.set(id, makeSession(id, OWNER))
    }
    const gateway = new StubGateway()
    gateway.pullResponses.push(emptyPull(), emptyPull())

    const summary = await createService(storage, gateway).synchronize()

    expect(summary).toMatchObject({ status: 'synced', queued: 101, uploaded: 101 })
    expect(gateway.pushed.map((batch) => batch.length)).toEqual([100, 1])
    expect(gateway.events).toEqual(['pull', 'push', 'push', 'pull'])
  })
})

class MemoryStorage implements LocalStorage, CloudSyncStorage {
  readonly sessions = new Map<string, TrainingSession>()
  readonly expressions = new Map<string, SavedExpression>()
  readonly questionStates = new Map<string, QuestionPracticeState>()
  readonly materials = new Map<string, PersonalMaterial>()
  readonly deletedSessions: string[] = []
  readonly deletedExpressions: string[] = []
  readonly deletedMaterials: string[] = []
  private readonly tombstones = new Map<string, LocalDeletionTombstone>()
  private readonly operations = new Map<string, SyncOutboxOperation>()
  private readonly cursors = new Map<string, number>()
  private readonly states = new Map<string, SyncEntityState>()

  upsertSession(session: TrainingSession): Promise<void> {
    this.sessions.set(session.id, structuredClone(session))
    return Promise.resolve()
  }
  getSession(id: string): Promise<TrainingSession | null> {
    return Promise.resolve(cloneOrNull(this.sessions.get(id)))
  }
  listSessions(): Promise<TrainingSession[]> {
    return Promise.resolve(
      [...this.sessions.values()].map((value) => structuredClone(value)),
    )
  }
  listQuestionPracticeStates(ownerId: string): Promise<QuestionPracticeState[]> {
    return Promise.resolve(
      [...this.questionStates.values()].filter((state) => state.ownerId === ownerId),
    )
  }
  saveQuestionPracticeState(state: QuestionPracticeState): Promise<void> {
    this.questionStates.set(state.id, structuredClone(state))
    return Promise.resolve()
  }
  deleteSessionWithAudio(
    id: string,
    ownerId: string,
    deletedAt: string | null,
  ): Promise<{ deletedAudio: number }> {
    const session = this.sessions.get(id)
    if (session?.ownerId !== ownerId) {
      return Promise.reject(new Error('The practice session could not be found.'))
    }
    const deletedAudio = session.attempts.reduce(
      (count, attempt) => count + (attempt.audio === undefined ? 0 : 1),
      0,
    )
    this.deletedSessions.push(id)
    this.sessions.delete(id)
    if (deletedAt !== null) {
      const tombstone: LocalDeletionTombstone = {
        id: [ownerId, 'session', id].join(':'),
        ownerId,
        entityType: 'session',
        entityId: id,
        deletedAt,
      }
      this.tombstones.set(tombstone.id, tombstone)
    }
    return Promise.resolve({ deletedAudio })
  }
  upsertExpression(expression: SavedExpression): Promise<void> {
    this.expressions.set(expression.id, structuredClone(expression))
    return Promise.resolve()
  }
  getExpression(id: string): Promise<SavedExpression | null> {
    return Promise.resolve(cloneOrNull(this.expressions.get(id)))
  }
  listExpressions(): Promise<SavedExpression[]> {
    return Promise.resolve(
      [...this.expressions.values()].map((value) => structuredClone(value)),
    )
  }
  deleteExpression(
    id: string,
    ownerId: string,
    deletedAt: string | null,
  ): Promise<void> {
    const expression = this.expressions.get(id)
    if (expression?.ownerId !== ownerId) {
      return Promise.reject(new Error('Saved expression not found.'))
    }
    this.deletedExpressions.push(id)
    this.expressions.delete(id)
    if (deletedAt !== null) {
      const tombstone: LocalDeletionTombstone = {
        id: [ownerId, 'expression', id].join(':'),
        ownerId,
        entityType: 'expression',
        entityId: id,
        deletedAt,
      }
      this.tombstones.set(tombstone.id, tombstone)
    }
    return Promise.resolve()
  }
  upsertPersonalMaterial(material: PersonalMaterial): Promise<void> {
    this.materials.set(material.id, structuredClone(material))
    return Promise.resolve()
  }
  getPersonalMaterial(id: string, ownerId: string): Promise<PersonalMaterial | null> {
    const material = this.materials.get(id)
    return Promise.resolve(
      material?.ownerId === ownerId ? structuredClone(material) : null,
    )
  }
  listPersonalMaterials(
    ownerId: string,
    options: ListPersonalMaterialsOptions = {},
  ): Promise<PersonalMaterial[]> {
    return Promise.resolve(
      [...this.materials.values()]
        .filter((value) =>
          value.ownerId === ownerId &&
          (options.includeDeleted === true || value.deletedAt === null),
        )
        .map((value) => structuredClone(value)),
    )
  }
  deletePersonalMaterial(
    id: string,
    ownerId: string,
    deletedAt: string,
  ): Promise<void> {
    const material = this.materials.get(id)
    if (material?.ownerId === ownerId) {
      this.deletedMaterials.push(id)
      this.materials.set(id, {
        ...material,
        updatedAt: deletedAt,
        deletedAt,
        version: material.version + 1,
      })
    }
    return Promise.resolve()
  }
  getPracticeTexts(): Promise<PracticeTexts | null> { return Promise.resolve(null) }
  savePracticeTexts(texts: PracticeTexts): Promise<void> {
    void texts
    return Promise.resolve()
  }
  listLocalDeletionTombstones(ownerId: string): Promise<LocalDeletionTombstone[]> {
    return Promise.resolve(
      [...this.tombstones.values()]
        .filter((tombstone) => tombstone.ownerId === ownerId)
        .map((tombstone) => structuredClone(tombstone)),
    )
  }
  removeLocalDeletionTombstone(
    ownerId: string,
    entityType: LocalDeletionTombstone['entityType'],
    entityId: string,
  ): Promise<void> {
    const tombstone = [...this.tombstones.values()].find((candidate) =>
      candidate.ownerId === ownerId &&
      candidate.entityType === entityType &&
      candidate.entityId === entityId,
    )
    if (tombstone !== undefined) this.tombstones.delete(tombstone.id)
    return Promise.resolve()
  }
  commitPulledSyncChange(
    scopeId: string,
    change: SyncChange,
    state: SyncEntityState,
  ): Promise<void> {
    this.states.set(
      [scopeId, change.entityType, change.entityId].join(':'),
      structuredClone(state),
    )
    this.cursors.set(scopeId, change.cursor)
    return Promise.resolve()
  }

  enqueueSyncOperation(
    scopeId: string,
    operation: SyncOutboxOperation,
  ): Promise<'created' | 'already-enqueued'> {
    const key = `${scopeId}:${operation.operationId}`
    if (this.operations.has(key)) return Promise.resolve('already-enqueued')
    this.operations.set(key, structuredClone(operation))
    return Promise.resolve('created')
  }
  listSyncOperations(scopeId: string, limit = 100): Promise<SyncOutboxOperation[]> {
    return Promise.resolve(
      [...this.operations.entries()]
        .filter(([key]) => key.startsWith(`${scopeId}:`))
        .map(([, operation]) => structuredClone(operation))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit),
    )
  }
  removeSyncOperation(scopeId: string, operationId: string): Promise<void> {
    this.operations.delete(`${scopeId}:${operationId}`)
    return Promise.resolve()
  }
  getSyncCursor(scopeId: string): Promise<number> {
    return Promise.resolve(this.cursors.get(scopeId) ?? 0)
  }
  setSyncCursor(scopeId: string, cursor: number): Promise<void> {
    this.cursors.set(scopeId, cursor)
    return Promise.resolve()
  }
  getSyncEntityState(
    scopeId: string,
    entityType: CloudSyncEntityType,
    entityId: string,
  ): Promise<SyncEntityState> {
    return Promise.resolve(
      this.states.get(`${scopeId}:${entityType}:${entityId}`) ?? {
        version: 0,
        syncedUpdatedAt: null,
      },
    )
  }
  setSyncEntityState(
    scopeId: string,
    entityType: CloudSyncEntityType,
    entityId: string,
    state: SyncEntityState,
  ): Promise<void> {
    this.states.set(`${scopeId}:${entityType}:${entityId}`, structuredClone(state))
    return Promise.resolve()
  }
}

class StubGateway implements CloudSyncGateway {
  readonly events: string[] = []
  readonly pushed: SyncPushItem[][] = []
  readonly pullResponses: SyncPullResponse[] = []
  pushError: Error | null = null
  private cursor = 100

  push(items: SyncPushItem[]): Promise<SyncPushResponse> {
    this.events.push('push')
    this.pushed.push(structuredClone(items))
    if (this.pushError !== null) return Promise.reject(this.pushError)
    return Promise.resolve({
      results: items.map((item) => ({
        operationId: item.operationId,
        entityType: item.entityType,
        entityId: item.entityId,
        status: 'applied',
        version: item.baseVersion + 1,
        cursor: ++this.cursor,
        replayed: false,
        code: null,
        message: null,
        current: null,
      })),
    })
  }
  pull(cursor: number): Promise<SyncPullResponse> {
    this.events.push('pull')
    return Promise.resolve(this.pullResponses.shift() ?? emptyPull(cursor))
  }
}

function createService(storage: MemoryStorage, gateway: StubGateway) {
  return new AccountCloudSyncService({
    scopeId: 'cloud-account',
    ownerId: OWNER,
    storage,
    gateway,
  })
}

function makeSession(
  id: string,
  ownerId: string,
  withRecording = false,
  updatedAt = UPDATED_AT,
): TrainingSession {
  return {
    id,
    ownerId,
    questionId: 'question-1',
    status: 'first-review',
    attempts: [{
      id: `${id}-attempt`,
      attemptNumber: 1,
      ...(withRecording ? { audio: {
        id: `${id}-audio`,
        relativePath: `recordings/${id}.m4a`,
        mimeType: 'audio/mp4',
        durationMs: 10_000,
        createdAt: CREATED_AT,
      } } : {}),
      transcript: {
        status: 'ready',
        text: 'I like reading.',
        originalText: null,
        source: 'manual',
        errorCode: null,
        updatedAt,
      },
      metrics: {
        durationMs: 10_000,
        wordCount: 3,
        wordsPerMinute: null,
        fillerWords: [],
        fillerCount: 0,
        repeatedWords: [],
        repeatedWordCount: 0,
        caveats: [],
      },
      createdAt: CREATED_AT,
      updatedAt,
    }],
    localFeedback: [],
    aiFeedback: null,
    comparison: null,
    createdAt: CREATED_AT,
    updatedAt,
  }
}

function makeDraftSession(id: string, ownerId: string): TrainingSession {
  return {
    ...makeSession(id, ownerId),
    status: 'first-ready',
    attempts: [],
  }
}

function makeExpression(id: string, ownerId: string): SavedExpression {
  return {
    id,
    ownerId,
    text: 'It gives me a chance to unwind.',
    topic: 'Weekends',
    questionId: 'question-1',
    sessionId: 'session-1',
    sourceAttempt: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  }
}

function makeMaterial(id: string, ownerId: string): PersonalMaterial {
  return {
    id,
    ownerId,
    title: 'My neighbourhood park',
    content: 'A quiet park where I walk after dinner.',
    kind: 'place',
    topicTags: ['parks'],
    questionIds: ['question-1'],
    sourceSessionId: null,
    status: 'confirmed',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    version: 1,
    deletedAt: null,
  }
}

function withoutOwner<T extends object>(value: T): Omit<T, 'ownerId'> {
  const copy = { ...value }
  Reflect.deleteProperty(copy, 'ownerId')
  return copy
}

function changeFor(
  entityType: CloudSyncEntityType,
  payload: Record<string, unknown>,
  cursor: number,
  version = 1,
  deletedAt: string | null = null,
): SyncChange {
  return {
    cursor,
    entityType,
    entityId: typeof payload.id === 'string' ? payload.id : 'recorded-session',
    version,
    payload,
    deletedAt,
    updatedAt: UPDATED_AT,
  }
}

function emptyPull(cursor = 0): SyncPullResponse {
  return { changes: [], nextCursor: cursor, hasMore: false }
}

function cloneOrNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : structuredClone(value)
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}
