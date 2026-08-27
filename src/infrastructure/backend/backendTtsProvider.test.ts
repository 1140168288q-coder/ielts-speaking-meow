import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBackendHealth, makeProviderHealth } from '../../test/fixtures/backendHealth'
import type { TtsCacheEntry } from '../../domain'
import type { TtsCacheStorage } from '../../ports/imports'
import type { RecordingPlayback } from '../../ports/speech'
import { BackendClient } from './backendClient'
import { BackendHealthCache } from './backendHealth'
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
  private voiceConfigVersion: number | null = null

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

  getVoiceConfigVersion(): Promise<number | null> {
    return Promise.resolve(this.voiceConfigVersion)
  }

  setVoiceConfigVersion(version: number): Promise<void> {
    this.voiceConfigVersion = version
    return Promise.resolve()
  }
}

function audioResponse(): Response {
  return new Response(new Uint8Array([9, 9]), {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
  })
}

function createClient(fetch: ReturnType<typeof vi.fn>): BackendClient {
  return new BackendClient({
    baseUrl: 'http://backend.test',
    isNative: () => false,
    fetch,
  })
}

function createHarness(options: {
  health?: BackendHealthCache
  now?: () => number
} = {}): {
  provider: BackendTtsProvider
  fetch: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  cache: MemoryTtsCache
} {
  const fetch = vi.fn().mockResolvedValue(audioResponse())
  const client = createClient(fetch)
  const play = vi.fn().mockResolvedValue(undefined)
  const playback: RecordingPlayback = {
    play,
    stop: vi.fn().mockResolvedValue(undefined),
  }
  const cache = new MemoryTtsCache()
  return {
    provider: new BackendTtsProvider(
      client,
      cache,
      playback,
      options.health,
      options.now ?? (() => Date.now()),
    ),
    fetch,
    play,
    cache,
  }
}

function createHealthClient(providers: Parameters<typeof makeBackendHealth>[0]): {
  client: BackendClient
  health: BackendHealthCache
} {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(makeBackendHealth(providers)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  const client = createClient(fetch)
  return { client, health: new BackendHealthCache(client) }
}

describe('BackendTtsProvider', () => {
  it('fetches mp3 audio from the backend and plays it', async () => {
    const { provider, fetch, play } = createHarness()
    await provider.speak({ text: 'Hello there.' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('reports adjustable language/rate/pitch capabilities', () => {
    const { provider } = createHarness()
    expect(provider.isAvailable()).toBe(true)
    expect(provider.capabilities).toEqual({
      language: true,
      voice: true,
      rate: true,
      pitch: true,
      style: false,
    })
  })

  it('forwards language, voice, rate and pitch to the backend', async () => {
    const { provider, fetch } = createHarness()
    await provider.speak({
      text: 'Hello.',
      language: 'en-US',
      rate: 0.92,
      pitch: 1,
      voice: 'en_male_dave_moon_bigtts',
    })
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'Hello.',
      language: 'en-US',
      rate: 0.92,
      pitch: 1,
      voice: 'en_male_dave_moon_bigtts',
    })
  })

  it('becomes unavailable when the health cache confirms TTS is not configured', async () => {
    const { client, health } = createHealthClient({
      deepseek: true,
      volc_tts: false,
    })
    await health.refresh()
    const play = vi.fn().mockResolvedValue(undefined)
    const playback: RecordingPlayback = {
      play,
      stop: vi.fn().mockResolvedValue(undefined),
    }
    const provider = new BackendTtsProvider(
      client,
      new MemoryTtsCache(),
      playback,
      health,
    )
    expect(provider.isAvailable()).toBe(false)
  })

  it('is unavailable while cloud health is unknown, so system TTS speaks immediately', () => {
    const { client, health } = createHealthClient({ volc_tts: true })
    // 健康检查尚未完成(快照为 null)→ 状态 unknown → 不走云端
    const provider = new BackendTtsProvider(
      client,
      new MemoryTtsCache(),
      { play: vi.fn(), stop: vi.fn() },
      health,
    )
    expect(health.statusOf('volc_tts')).toBe('unknown')
    expect(provider.isAvailable()).toBe(false)
  })

  it('trips a short circuit breaker after a cloud failure', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const client = createClient(fetch)
    let now = 1_000_000
    const provider = new BackendTtsProvider(
      client,
      new MemoryTtsCache(),
      { play: vi.fn(), stop: vi.fn() },
      undefined,
      () => now,
    )
    await expect(provider.speak({ text: 'Hi' })).rejects.toBeTruthy()
    expect(provider.isAvailable()).toBe(false)
    now += 59_000
    expect(provider.isAvailable()).toBe(false)
    now += 2_000
    expect(provider.isAvailable()).toBe(true)
  })

  it('clears the circuit breaker after a successful synthesis', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(audioResponse())
    const client = createClient(fetch)
    let now = 1_000_000
    const provider = new BackendTtsProvider(
      client,
      new MemoryTtsCache(),
      { play: vi.fn().mockResolvedValue(undefined), stop: vi.fn() },
      undefined,
      () => now,
    )
    await expect(provider.speak({ text: 'Hi' })).rejects.toBeTruthy()
    expect(provider.isAvailable()).toBe(false)
    now += 61_000
    await provider.speak({ text: 'Hi again' })
    expect(provider.isAvailable()).toBe(true)
  })

  it('changes the cache key when the server speaker changes', async () => {
    const { health } = createHealthClient({
      volc_tts: makeProviderHealth({
        model: 'seed-tts-2.0',
        speaker: { id: 'voice-a', name: null },
      }),
    })
    await health.refresh()
    const cache = new MemoryTtsCache()
    const playback: RecordingPlayback = {
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }
    const fetch = vi.fn().mockResolvedValue(audioResponse())
    const first = new BackendTtsProvider(createClient(fetch), cache, playback, health)
    await first.speak({ text: 'Same text.', language: 'en-US', rate: 0.92 })

    // 服务端换了音色:健康信息变化后,相同文本必须重新合成,不命中旧缓存
    const secondHealthClient = createHealthClient({
      volc_tts: makeProviderHealth({
        model: 'seed-tts-2.0',
        speaker: { id: 'voice-b', name: null },
      }),
    })
    await secondHealthClient.health.refresh()
    const secondTtsFetch = vi.fn().mockResolvedValue(audioResponse())
    const second = new BackendTtsProvider(
      createClient(secondTtsFetch),
      cache,
      playback,
      secondHealthClient.health,
    )
    await second.speak({ text: 'Same text.', language: 'en-US', rate: 0.92 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(secondTtsFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects empty audio responses', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(0), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    )
    const client = createClient(fetch)
    const playback: RecordingPlayback = {
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }
    const provider = new BackendTtsProvider(client, new MemoryTtsCache(), playback)
    await expect(provider.speak({ text: 'Hi' }))
      .rejects.toMatchObject({ code: 'invalid-response' })
  })
})
