import { describe, expect, it } from 'vitest'
import { analyzePcmSignal } from './webAudioSignalAnalyzer'

const SAMPLE_RATE = 1_000

function signal(segments: Array<{ durationMs: number; amplitude: number }>): Float32Array {
  const values = segments.flatMap(({ durationMs, amplitude }) =>
    Array.from({ length: durationMs }, (_, index) =>
      amplitude === 0 ? 0 : Math.sin(index / 3) * amplitude,
    ),
  )
  return new Float32Array(values)
}

describe('analyzePcmSignal', () => {
  it('finds internal pauses and distinguishes pauses longer than 800ms', () => {
    const result = analyzePcmSignal(
      signal([
        { durationMs: 1_000, amplitude: 0.4 },
        { durationMs: 400, amplitude: 0 },
        { durationMs: 800, amplitude: 0.4 },
        { durationMs: 900, amplitude: 0 },
        { durationMs: 1_000, amplitude: 0.4 },
      ]),
      SAMPLE_RATE,
    )

    expect(result).toMatchObject({
      pauseCount: 2,
      longPauseCount: 1,
    })
    expect(result?.silenceRatio).toBeGreaterThan(0.25)
    expect(result?.averagePauseMs).toBeGreaterThanOrEqual(600)
  })

  it('bridges natural micro-gaps and returns null for effectively silent audio', () => {
    const bridged = analyzePcmSignal(
      signal([
        { durationMs: 500, amplitude: 0.3 },
        { durationMs: 80, amplitude: 0 },
        { durationMs: 500, amplitude: 0.3 },
      ]),
      SAMPLE_RATE,
    )
    expect(bridged?.pauseCount).toBe(0)
    expect(analyzePcmSignal(new Float32Array(1_000), SAMPLE_RATE)).toBeNull()
  })
})
