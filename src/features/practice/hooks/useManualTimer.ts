import { useEffect, useRef, useState } from 'react'

export type TimerStatus = 'idle' | 'running' | 'paused'

export function useManualTimer() {
  const [elapsedMs, setElapsedMs] = useState(0)
  const [status, setStatus] = useState<TimerStatus>('idle')
  const startedAtRef = useRef(0)
  const accumulatedMsRef = useRef(0)
  const intervalRef = useRef<number | null>(null)

  const stopTicking = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const start = () => {
    if (status === 'running') return
    stopTicking()
    accumulatedMsRef.current = 0
    startedAtRef.current = Date.now()
    setElapsedMs(0)
    setStatus('running')
    intervalRef.current = window.setInterval(() => {
      setElapsedMs(
        accumulatedMsRef.current + Math.max(0, Date.now() - startedAtRef.current),
      )
    }, 250)
  }

  const pause = () => {
    if (status !== 'running') return
    stopTicking()
    accumulatedMsRef.current += Math.max(0, Date.now() - startedAtRef.current)
    setElapsedMs(accumulatedMsRef.current)
    setStatus('paused')
  }

  const resume = () => {
    if (status !== 'paused') return
    startedAtRef.current = Date.now()
    setStatus('running')
    intervalRef.current = window.setInterval(() => {
      setElapsedMs(
        accumulatedMsRef.current + Math.max(0, Date.now() - startedAtRef.current),
      )
    }, 250)
  }

  const reset = () => {
    stopTicking()
    accumulatedMsRef.current = 0
    startedAtRef.current = 0
    setElapsedMs(0)
    setStatus('idle')
  }

  useEffect(() => stopTicking, [])

  return { elapsedMs, status, start, pause, resume, reset }
}
