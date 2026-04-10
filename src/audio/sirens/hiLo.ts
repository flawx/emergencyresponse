import type { SirenBuildContext, SoundInstance } from '../types'
import { attachAnalogDrift, attachGainWobble, attachNoiseLayer, nextJitter } from '../utils/audioUtils'
import { connectOscWithTimbre } from '../routing'

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

  let idx = 0
  instance.timer = window.setInterval(() => {
    idx = (idx + 1) % freqs.length
    const next = (freqs[idx] ?? freqs[0] ?? 600) + nextJitter(instance, 5)
    const now = ac.currentTime
    osc.frequency.cancelScheduledValues(now)
    osc.frequency.setValueAtTime(next, now)
    instance.debug.frequencyHz = next
  }, everyMs)
}
