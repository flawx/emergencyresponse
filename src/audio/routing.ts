import type { SoundInstance } from './types'
import { makeDistortionCurve, makeSirenLocalTanhCurve } from './utils/distortion'

/**
 * Routage timbre sirène :
 *
 * - **`connectOscWithTimbre`** : chaîne **US / générique** (osc seul → shaper → LP → voix). Utilisé pour Q-siren,
 *   phaser, HI-LO, deux tons « simples » non-FR. Le timbre **EU** sur le même chemin ne fait qu’ajuster drive /
 *   cutoff / Q selon `preset.regionStyle` (même graphe, paramètres différents).
 *
 * - **`connectFrOscWithTimbre` / `connectFrSourceWithTimbre`** : chaîne **dédiée France** (HP → shaper → HP DC → LP)
 *   vers `voiceInput`, pour les voix **two-tone / trois tons FR** construites dans `sirens/twoTone.ts` (gate + comp +
 *   EQ ensuite). Ne pas mélanger les deux pour une même voix FR : le timbre FR repose sur ce graphe + `voiceInput.gain`.
 */
export function connectOscWithTimbre(
  ctx: AudioContext,
  instance: SoundInstance,
  osc: OscillatorNode,
  lowpassHz: number,
  driveAmount: number,
  destination?: AudioNode,
): void {
  const shaper = ctx.createWaveShaper()
  const isEurope = instance.preset.regionStyle === 'eu'
  const drive = isEurope ? driveAmount * 1.25 : driveAmount
  const cutoff = isEurope ? lowpassHz * 0.78 : lowpassHz
  shaper.curve = new Float32Array(makeDistortionCurve(drive))
  shaper.oversample = '2x'
  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = cutoff
  lowpass.Q.value = isEurope ? 1.1 : 0.8
  osc.connect(shaper)
  shaper.connect(lowpass)
  const out = destination ?? instance.voiceInput
  lowpass.connect(out)
  instance.modulationNodes.push(shaper, lowpass)
}

/**
 * WAIL/YELP : source → preGain → tanh → low-pass → voiceInput (master inchangé).
 * `tanhDrive` / `preGain` permettent d’adoucir le WAIL (moins « digital »).
 */
export function connectUnifiedSirenSourceToVoiceInput(
  ctx: AudioContext,
  instance: SoundInstance,
  source: AudioNode,
  opts?: { preGain?: number; tanhDrive?: number },
): void {
  const preGain = ctx.createGain()
  preGain.gain.value = opts?.preGain ?? 1.4
  const tanhShaper = ctx.createWaveShaper()
  tanhShaper.curve = new Float32Array(makeSirenLocalTanhCurve(opts?.tanhDrive ?? 2.55))
  tanhShaper.oversample = '4x'
  const toneLp = ctx.createBiquadFilter()
  toneLp.type = 'lowpass'
  toneLp.frequency.value = 3500
  toneLp.Q.value = 0.85
  source.connect(preGain)
  preGain.connect(tanhShaper)
  tanhShaper.connect(toneLp)
  toneLp.connect(instance.voiceInput)
  instance.modulationNodes.push(preGain, tanhShaper, toneLp)
}

export function connectFrOscWithTimbre(
  ctx: AudioContext,
  instance: SoundInstance,
  osc: OscillatorNode,
  lowpassHz: number,
  driveAmount: number,
): void {
  connectFrSourceWithTimbre(ctx, instance, osc, lowpassHz, driveAmount)
}

export function connectFrSourceWithTimbre(
  ctx: AudioContext,
  instance: SoundInstance,
  source: AudioNode,
  lowpassHz: number,
  driveAmount: number,
): void {
  const highpass = ctx.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = 190
  highpass.Q.value = 0.7

  const shaper = ctx.createWaveShaper()
  shaper.curve = new Float32Array(makeDistortionCurve(driveAmount))
  shaper.oversample = '2x'

  const dcHighpass = ctx.createBiquadFilter()
  dcHighpass.type = 'highpass'
  dcHighpass.frequency.value = 220
  dcHighpass.Q.value = 0.7

  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = lowpassHz
  lowpass.Q.value = 1.1

  source.connect(highpass)
  highpass.connect(shaper)
  shaper.connect(dcHighpass)
  dcHighpass.connect(lowpass)
  lowpass.connect(instance.voiceInput)

  instance.modulationNodes.push(highpass, shaper, dcHighpass, lowpass)
}
