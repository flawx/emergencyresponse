import type { SirenBuildContext, SoundInstance } from '../types'
import {
  attachAnalogDrift,
  attachGainWobble,
  attachNoiseLayer,
  clampFrequencyHz,
  nextJitter,
} from '../utils/audioUtils'
import { connectOscWithTimbre } from '../routing'

/** Nombre de demi-cycles planifiés (~5 min à 500 ms / pas, aligné sur les horizons two-tone FR). */
const HILO_HORIZON_STEPS = 600

export function createHiLo(ctx: SirenBuildContext, instance: SoundInstance): void {
  createSwitchedTone(ctx, instance, [600, 1000], 500, 'hilo')
}

export function createSwitchedTone(
  ctx: SirenBuildContext,
  instance: SoundInstance,
  freqs: number[],
  everyMs: number,
  modulation: string,
): void {
  const { audioContext: ac } = ctx
  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freqs[0] ?? 600
  connectOscWithTimbre(ac, instance, osc, 3200, 8)
  osc.start()
  instance.mainOsc = osc
  instance.oscillators.push(osc)
  instance.debug.frequencyHz = freqs[0] ?? 600
  instance.debug.modulation = modulation
  attachAnalogDrift(ac, instance, osc, 0.05, 3)
  attachGainWobble(ac, instance, instance.gainNode.gain, 0.1, 0.02)
  attachNoiseLayer(ac, instance, ctx.noiseBuffer, 0.007)

  const start = ac.currentTime + 0.01
  const stepSec = everyMs / 1000
  osc.frequency.cancelScheduledValues(start)
  for (let i = 0; i < HILO_HORIZON_STEPS; i += 1) {
    const t = start + i * stepSec
    const idx = i % freqs.length
    const base = freqs[idx] ?? freqs[0] ?? 600
    const withJitter = i === 0 ? base : base + nextJitter(instance, 5)
    const f = clampFrequencyHz(withJitter)
    osc.frequency.setValueAtTime(f, t)
  }
}
