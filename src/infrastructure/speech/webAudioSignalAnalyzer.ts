import {
  acousticSpeechMetricsSchema,
  type AcousticSpeechMetrics,
} from '../../domain/models'
import type { RecordedAudioAnalyzer } from '../../ports/speech'

const FRAME_MS = 20
const MIN_PAUSE_MS = 250
const LONG_PAUSE_MS = 800
const BRIDGE_GAP_MS = 120

export function analyzePcmSignal(
  samples: Float32Array,
  sampleRate: number,
): AcousticSpeechMetrics | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length === 0) {
    return null
  }

  const frameSize = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1_000))
  const rmsValues: number[] = []
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const end = Math.min(samples.length, offset + frameSize)
    let energy = 0
    for (let index = offset; index < end; index += 1) {
      const sample = samples[index] ?? 0
      energy += sample * sample
    }
    rmsValues.push(Math.sqrt(energy / Math.max(1, end - offset)))
  }

  const peak = Math.max(...rmsValues)
  if (peak < 0.006) return null

  const sorted = [...rmsValues].sort((a, b) => a - b)
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] ?? 0
  const threshold = Math.min(
    0.08,
    Math.max(0.008, noiseFloor * 2.5, peak * 0.08),
  )
  const active = rmsValues.map((rms) => rms >= threshold)

  const bridgeFrames = Math.max(1, Math.round(BRIDGE_GAP_MS / FRAME_MS))
  for (let index = 0; index < active.length; index += 1) {
    if (active[index]) continue
    const start = index
    while (index < active.length && !active[index]) index += 1
    const end = index
    if (
      start > 0 &&
      end < active.length &&
      end - start <= bridgeFrames
    ) {
      for (let fill = start; fill < end; fill += 1) active[fill] = true
    }
  }

  const firstActive = active.indexOf(true)
  const lastActive = active.lastIndexOf(true)
  if (firstActive < 0 || lastActive < firstActive) return null

  const activeFrames = active.filter(Boolean).length
  const pauseDurations: number[] = []
  for (let index = firstActive; index <= lastActive; index += 1) {
    if (active[index]) continue
    const start = index
    while (index <= lastActive && !active[index]) index += 1
    const durationMs = (index - start) * FRAME_MS
    if (durationMs >= MIN_PAUSE_MS) pauseDurations.push(durationMs)
  }

  const analyzedDurationMs = (samples.length / sampleRate) * 1_000
  const activeSpeechMs = Math.min(
    analyzedDurationMs,
    activeFrames * FRAME_MS,
  )
  const silenceRatio = Math.max(
    0,
    Math.min(1, 1 - activeSpeechMs / analyzedDurationMs),
  )

  return acousticSpeechMetricsSchema.parse({
    analysisVersion: 1,
    analyzedDurationMs: Math.round(analyzedDurationMs),
    activeSpeechMs: Math.round(activeSpeechMs),
    silenceRatio: Math.round(silenceRatio * 1_000) / 1_000,
    pauseCount: pauseDurations.length,
    longPauseCount: pauseDurations.filter((duration) => duration >= LONG_PAUSE_MS).length,
    averagePauseMs: pauseDurations.length > 0
      ? Math.round(
          pauseDurations.reduce((total, duration) => total + duration, 0) /
            pauseDurations.length,
        )
      : null,
  })
}

export class WebAudioSignalAnalyzer implements RecordedAudioAnalyzer {
  async analyze(audio: Blob): Promise<AcousticSpeechMetrics | null> {
    const AudioContextConstructor = globalThis.AudioContext
    if (AudioContextConstructor === undefined) return null

    const context = new AudioContextConstructor()
    try {
      const buffer = await context.decodeAudioData(await audio.arrayBuffer())
      if (buffer.length === 0 || buffer.numberOfChannels === 0) return null

      const mono = new Float32Array(buffer.length)
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const channelData = buffer.getChannelData(channel)
        for (let index = 0; index < channelData.length; index += 1) {
          mono[index] = (mono[index] ?? 0) + (channelData[index] ?? 0)
        }
      }
      if (buffer.numberOfChannels > 1) {
        for (let index = 0; index < mono.length; index += 1) {
          mono[index] = (mono[index] ?? 0) / buffer.numberOfChannels
        }
      }
      return analyzePcmSignal(mono, buffer.sampleRate)
    } catch {
      return null
    } finally {
      await context.close().catch(() => undefined)
    }
  }
}
