import { describe, expect, it } from 'vitest'
import type { PlaybackSnapshot } from '../../ports/speech'
import { HTMLAudioPlayback } from './htmlAudioPlayback'
import type { HTMLAudioElementLike } from './htmlAudioPlayback'

function createElement(durationSeconds = 12): HTMLAudioElementLike & {
  triggerTimeUpdate(): void
  triggerEnded(): void
} {
  const fake = {
    src: '',
    currentTime: 0,
    duration: durationSeconds,
    onended: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onloadedmetadata: null as (() => void) | null,
    ontimeupdate: null as (() => void) | null,
    onplay: null as (() => void) | null,
    onpause: null as (() => void) | null,
    play: () => Promise.resolve(),
    pause: () => undefined,
  }
  return Object.assign(fake, {
    triggerTimeUpdate() {
      fake.ontimeupdate?.()
    },
    triggerEnded() {
      fake.onended?.()
    },
  })
}

describe('HTMLAudioPlayback position publishing', () => {
  const flushMicrotasks = async () => {
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve()
    }
  }

  it('throttles routine position updates but keeps status changes instant', async () => {
    let clock = 1_000
    const element = createElement()
    const playback = new HTMLAudioPlayback(() => element, () => clock)
    const snapshots: PlaybackSnapshot[] = []
    playback.subscribePlayback((snapshot) => snapshots.push(snapshot))

    void playback.play('blob:test-audio')
    await flushMicrotasks()

    // stop() 复位、loading、playing 都是状态变化,立即发布。
    expect(snapshots.map((snapshot) => snapshot.status)).toEqual([
      'idle',
      'idle',
      'loading',
      'playing',
    ])

    // 距上次发布不足 500ms 的常规位置更新被合帧丢弃。
    element.triggerTimeUpdate()
    element.triggerTimeUpdate()
    expect(snapshots).toHaveLength(4)

    clock += 600
    element.triggerTimeUpdate()
    expect(snapshots).toHaveLength(5)
    expect(snapshots.at(-1)?.status).toBe('playing')

    // 暂停是状态变化,不受节流影响。
    await playback.pause()
    expect(snapshots.at(-1)?.status).toBe('paused')

    element.triggerEnded()
    expect(snapshots.at(-1)?.status).toBe('idle')
  })
})
