import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TtsCacheEntry } from '../../domain'
import type { TtsCacheStorage } from '../../ports/imports'
import type { RecordingPlayback } from '../../ports/speech'
import { BackendClient } from './backendClient'
import { BackendTtsProvider } from './backendTtsProvider'

let originalCreateDescriptor: PropertyDescriptor | undefined
let originalRevokeDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  originalCreateDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  originalRevokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:fake-url'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: originalCreateDescriptor?.value,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: originalRevokeDescriptor?.value,
  })
})

class MemoryTtsCache implements TtsCacheStorage {
  private entries = new Map<string, { metadata: TtsCacheEntry; audio: Blob }>()

  getTtsCacheEntry(cacheId: string): Promise<{
    metadata: TtsCacheEntry
    audio: Blob
  } | null> {
    const entry = this.entries.get(cacheId)
    if (!entry) return Promise.resolve(null)
    return Promise.resolve({ metadata: entry.metadata, audio: entry.audio })
  }

  putTtsCacheEntry(metadata: TtsCacheEntry, audio: Blob): Promise<void> {
    this.entries.set(metadata.id, { metadata, audio })
    return Promise.resolve()
  }
}

function createHarness(): {
  provider: BackendTtsProvider
  fetch: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
} {
  const fetch = vi.fn().mockResolvedValue(
    new Response(new Uint8Array([9, 9]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    }),
  )
  const client = new BackendClient({
    baseUrl: 'http://backend.test',
    isNative: () => false,
    fetch: fetch,
  })
  const play = vi.fn().mockResolvedValue(undefined)
  const playback: RecordingPlayback = {
    play,
    stop: vi.fn().mockResolvedValue(undefined),
  }
  return {
    provider: new BackendTtsProvider(client, new MemoryTtsCache(), playback),
    fetch,
    play,
  }
}

describe('BackendTtsProvider', () => {
  it('fetches mp3 audio from the backend and plays it', async () => {
    const { provider, fetch, play } = createHarness()
    await provider.speak({ text: 'Hello there.' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('reports no adjustable capabilities', () => {
    const { provider } = createHarness()
    expect(provider.isAvailable()).toBe(true)
    expect(provider.capabilities).toEqual({
      language: false,
      voice: false,
      rate: false,
      pitch: false,
      style: false,
    })
  })

  it('rejects empty audio responses', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(0), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    )
    const client = new BackendClient({
      baseUrl: 'http://backend.test',
      isNative: () => false,
      fetch: fetch,
    })
    const playback: RecordingPlayback = {
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }
    const provider = new BackendTtsProvider(client, new MemoryTtsCache(), playback)
    await expect(provider.speak({ text: 'Hi' }))
      .rejects.toMatchObject({ code: 'invalid-response' })
  })
})
