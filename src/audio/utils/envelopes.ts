import type { SoundInstance } from '../types'
import { nextJitter } from './audioUtils'

export function applyAsymmetricWailAutomation(
  ctx: AudioContext,
  instance: SoundInstance,
  carriers: OscillatorNode[],
): void {
  const minHz = 500
  const maxHz = 1500
  const baseCycleSec = 4
  const horizonCycles = 90
  const start = ctx.currentTime + 0.01
  for (const c of carriers) {
    c.frequency.cancelScheduledValues(start)
    c.frequency.setValueAtTime(minHz, start)
  }
  let cycleStart = start
  for (let i = 0; i < horizonCycles; i += 1) {
    const cycleSec = baseCycleSec * (1 + nextJitter(instance, 3) * 0.009)
    const riseSec = cycleSec * 0.72
    const peakAt = cycleStart + riseSec
    const endAt = cycleStart + cycleSec
    for (const c of carriers) {
      c.frequency.setValueAtTime(minHz, cycleStart)
      c.frequency.exponentialRampToValueAtTime(maxHz, peakAt)
      c.frequency.exponentialRampToValueAtTime(minHz, endAt)
    }
    cycleStart = endAt
  }
  instance.debug.modulation = 'wail-asymmetric-exp-jitter'
}

/** Yelp : rampe continue 900↔1600 Hz, cycle court, sans LFO binaire. */
export function applyContinuousYelpAutomation(
  ctx: AudioContext,
  instance: SoundInstance,
  carrier: OscillatorNode,
): void {
  const minHz = 900
  const maxHz = 1600
  const baseCycleSec = 0.25
  const horizonCycles = 720
  const start = ctx.currentTime + 0.02
  carrier.frequency.cancelScheduledValues(start)
  carrier.frequency.setValueAtTime(minHz, start)
  let t = start
  for (let i = 0; i < horizonCycles; i += 1) {
    const cycleSec = baseCycleSec * (1 + nextJitter(instance, 3) * 0.012)
    const riseSec = cycleSec * 0.4
    const tPeak = t + riseSec
    const tEnd = t + cycleSec
    carrier.frequency.setValueAtTime(minHz, t)
    carrier.frequency.exponentialRampToValueAtTime(maxHz, tPeak)
    carrier.frequency.exponentialRampToValueAtTime(minHz, tEnd)
    t = tEnd
  }
  instance.debug.modulation = 'yelp-continuous-exp'
}
