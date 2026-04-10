import type { SoundInstance } from './types'

/** Gain final sur `gainNode` après `normalizePresetVolume`, horns US lus en sample. */
export const HORN_POLICE_GAIN = 1.8
export const HORN_FIRE_GAIN = 1.15

export function setupHornUsPoliceFromSample(
  ctx: AudioContext,
  instance: SoundInstance,
  hornMix: GainNode,
  policeHornBuffer: AudioBuffer,
): void {
  const source = ctx.createBufferSource()
  source.buffer = policeHornBuffer
  source.loop = true

  const voiceGain = ctx.createGain()
  voiceGain.gain.value = 1.0
  const boost = ctx.createGain()
  boost.gain.value = 1.5
  const hornComp = ctx.createGain()
  hornComp.gain.value = 1.3

  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 500
  bp.Q.value = 1.5

  source.connect(voiceGain)
  voiceGain.connect(boost)
  boost.connect(hornComp)
  hornComp.connect(bp)
  bp.connect(hornMix)

  const t = ctx.currentTime
  hornMix.gain.cancelScheduledValues(t)
  hornMix.gain.setValueAtTime(1, t)

  instance.sampleSource = source
  instance.modulationNodes.push(voiceGain, boost, hornComp, bp)
  source.start()
}

/** Air horn pompiers US : sample bouclé + gain + bandpass léger. */
export function setupHornUsFireFromSample(
  ctx: AudioContext,
  instance: SoundInstance,
  hornMix: GainNode,
  airHornBuffer: AudioBuffer,
): void {
  const source = ctx.createBufferSource()
  source.buffer = airHornBuffer
  source.loop = true

  const voiceGain = ctx.createGain()
  voiceGain.gain.value = 1.0
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 500
  bp.Q.value = 1.2

  source.connect(voiceGain)
  voiceGain.connect(bp)
  bp.connect(hornMix)

  const t = ctx.currentTime
  hornMix.gain.cancelScheduledValues(t)
  hornMix.gain.setValueAtTime(1, t)

  instance.sampleSource = source
  instance.modulationNodes.push(voiceGain, bp)
  source.start()
}

export type HornBuffers = {
  police?: AudioBuffer
  air?: AudioBuffer
}

/**
 * Horns : uniquement samples US (`horn-police-us`, `horn-fire-us`). Pas de synthèse.
 * Enveloppe hornMix ; niveau final via `play()` sur gainNode.
 */
export function createHorn(
  ctx: AudioContext,
  instance: SoundInstance,
  buffers: HornBuffers,
  logDebug: (msg: string) => void,
): void {
  const hornMix = ctx.createGain()
  hornMix.gain.value = 0

  const now = ctx.currentTime
  hornMix.gain.setValueAtTime(0, now)
  hornMix.gain.linearRampToValueAtTime(1, now + 0.014)
  hornMix.gain.setTargetAtTime(0.94, now + 0.03, 0.065)
  hornMix.connect(instance.voiceInput)
  instance.modulationNodes.push(hornMix)

  const isPoliceHorn = instance.id === 'amer-police-horn'
  const isFireAirHorn = instance.id === 'amer-fire-airhorn'

  if (isPoliceHorn && buffers.police) {
    setupHornUsPoliceFromSample(ctx, instance, hornMix, buffers.police)
    instance.debug.modulation = 'horn-us-police-sample'
    instance.debug.frequencyHz = 0
  } else if (isFireAirHorn && buffers.air) {
    setupHornUsFireFromSample(ctx, instance, hornMix, buffers.air)
    instance.debug.modulation = 'horn-us-fire-sample'
    instance.debug.frequencyHz = 0
  } else if (isPoliceHorn || isFireAirHorn) {
    instance.debug.modulation = isPoliceHorn ? 'horn-us-police-sample-missing' : 'horn-us-fire-sample-missing'
    instance.debug.frequencyHz = 0
    logDebug(`[horn] sample missing id=${instance.id}`)
  } else {
    instance.debug.modulation = 'horn-unsupported'
    instance.debug.frequencyHz = 0
    logDebug(`[horn] unsupported horn id=${instance.id}`)
  }

  const firstOsc = instance.oscillators[0]
  if (firstOsc) instance.mainOsc = firstOsc
}
