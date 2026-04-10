import type { FrVoiceOptions, SirenBuildContext, SoundInstance } from '../types'
import { attachAnalogDrift, attachGainWobble, attachNoiseLayer, clampFrequencyHz, nextJitter } from '../utils/audioUtils'
import { connectFrOscWithTimbre } from '../routing'

function createFrTwoToneVoice(
  ctx: SirenBuildContext,
  instance: SoundInstance,
  initialFreq: number,
  startAt?: number,
  options?: FrVoiceOptions,
): { oscA: OscillatorNode; gate: GainNode } | null {
  const { audioContext: ac, noiseBuffer } = ctx
  const withDrift = options?.withDrift ?? true
  const withWobble = options?.withWobble ?? true
  const withNoise = options?.withNoise ?? true
  const noiseGain = options?.noiseGain ?? 0.01
  const withEq = options?.withEq ?? true
  const withGateCompressor = options?.withGateCompressor ?? true
  const oscA = ac.createOscillator()
  oscA.type = 'sawtooth'
  oscA.frequency.value = clampFrequencyHz(initialFreq)
  oscA.detune.value = -3
  connectFrOscWithTimbre(ac, instance, oscA, 2200, 7)
  instance.voiceInput.gain.value = 1.41
  const gate = ac.createGain()
  gate.gain.value = 1
  try {
    instance.voiceInput.disconnect()
  } catch {
    // no-op
  }
  instance.voiceInput.connect(gate)
  instance.modulationNodes.push(gate)
  let postGate: AudioNode = gate
  if (withGateCompressor) {
    const frCompressor = ac.createDynamicsCompressor()
    frCompressor.threshold.value = -26
    frCompressor.knee.value = 14
    frCompressor.ratio.value = 4
    frCompressor.attack.value = 0.006
    frCompressor.release.value = 0.18
    postGate.connect(frCompressor)
    postGate = frCompressor
    instance.modulationNodes.push(frCompressor)
  }
  if (withEq) {
    const bp1 = ac.createBiquadFilter()
    bp1.type = 'peaking'
    bp1.frequency.value = 1200
    bp1.Q.value = 1.1
    bp1.gain.value = 3.5
    const bp2 = ac.createBiquadFilter()
    bp2.type = 'peaking'
    bp2.frequency.value = 1800
    bp2.Q.value = 1.2
    bp2.gain.value = 3.8
    const lowShelf = ac.createBiquadFilter()
    lowShelf.type = 'highshelf'
    lowShelf.frequency.value = 3200
    lowShelf.gain.value = -3.2
    postGate.connect(bp1)
    bp1.connect(bp2)
    bp2.connect(lowShelf)
    postGate = lowShelf
    instance.modulationNodes.push(bp1, bp2, lowShelf)
  }
  postGate.connect(instance.gainNode)
  oscA.start(startAt ?? ac.currentTime)
  instance.oscillators.push(oscA)
  if (withDrift) attachAnalogDrift(ac, instance, oscA, 0.05, 1.5)
  if (withWobble) attachGainWobble(ac, instance, instance.gainNode.gain, 0.75, 0.028)
  if (withNoise) attachNoiseLayer(ac, instance, noiseBuffer, noiseGain)
  return { oscA, gate }
}

type SteppedAlternatingSpec = {
  mode: 'stepped'
  freqs: number[]
  /** Durée entre deux changements de fréquence (ms), comme l’ancien `everyMs`. */
  stepMs: number
  horizonSteps?: number
  jitterMax?: number
  logPrefix: string
  baseFallback: number
}

type GatedThreeToneSpec = {
  mode: 'gatedThreeTone'
  gate: GainNode
  noteMs: number
  /** Pause après les 3 notes (secondes), ex. `1.1`. */
  extraPauseSec: number
  attack: number
  endFade: number
  horizonCycles?: number
  /** Gabarit Hz par note ; `nextJitter(instance, 1)` est ajouté à chaque tirage. */
  toneHz: readonly [number, number, number]
  logTag: string
}

type AlternatingTonesSpec = SteppedAlternatingSpec | GatedThreeToneSpec

/**
 * Planification commune des séquences two-tone FR (pas fixe) et trois tons FR (cycles + gate).
 * Ne crée pas l’oscillateur : uniquement fréquences / gate sur `osc` (et `gate` en mode trois tons).
 */
function scheduleAlternatingTones(
  ctx: SirenBuildContext,
  instance: SoundInstance,
  osc: OscillatorNode,
  spec: AlternatingTonesSpec,
): void {
  const { audioContext: ac, logDebug } = ctx

  if (spec.mode === 'stepped') {
    const horizonSteps = spec.horizonSteps ?? 600
    const jitterMax = spec.jitterMax ?? 1
    const start = ac.currentTime + 0.01
    const step = spec.stepMs / 1000
    for (let i = 0; i < horizonSteps; i += 1) {
      const idx = i % spec.freqs.length
      const f = clampFrequencyHz(
        (spec.freqs[idx] ?? spec.freqs[0] ?? spec.baseFallback) + nextJitter(instance, jitterMax),
      )
      osc.frequency.setValueAtTime(f, start + i * step)
      if (i < 8) logDebug(`${spec.logPrefix} step=${i} f=${f.toFixed(2)}Hz t=${(i * step).toFixed(3)}s`)
    }
    return
  }

  const noteMs = spec.noteMs
  const cycleSec = (noteMs * 3) / 1000 + spec.extraPauseSec
  const attack = spec.attack
  const endFade = spec.endFade
  const horizonCycles = spec.horizonCycles ?? 220
  const start = ac.currentTime + 0.01
  const gate = spec.gate
  const [h1, h2, h3] = spec.toneHz

  for (let i = 0; i < horizonCycles; i += 1) {
    const cycleStart = start + i * cycleSec
    const t2 = cycleStart + noteMs / 1000
    const t3 = cycleStart + (noteMs * 2) / 1000
    const t4 = cycleStart + (noteMs * 3) / 1000
    gate.gain.cancelScheduledValues(cycleStart)
    gate.gain.setValueAtTime(0, cycleStart)
    const f1 = clampFrequencyHz(h1 + nextJitter(instance, 1))
    const f2 = clampFrequencyHz(h2 + nextJitter(instance, 1))
    const f3 = clampFrequencyHz(h3 + nextJitter(instance, 1))
    osc.frequency.setValueAtTime(f1, cycleStart)
    osc.frequency.setValueAtTime(f2, t2)
    osc.frequency.setValueAtTime(f3, t3)
    osc.frequency.setValueAtTime(f3, t4)

    gate.gain.setValueAtTime(0, cycleStart)
    gate.gain.linearRampToValueAtTime(1, cycleStart + attack)
    gate.gain.setValueAtTime(1, t4)
    gate.gain.linearRampToValueAtTime(0, t4 + endFade)

    const cycleEnd = cycleStart + cycleSec
    gate.gain.setValueAtTime(0, cycleEnd)
    if (i < 8 || i % 20 === 0) {
      logDebug(
        `[${spec.logTag}] cycle=${i} f=[${f1.toFixed(1)},${f2.toFixed(1)},${f3.toFixed(1)}] fade=${endFade.toFixed(3)}s pause=${(
          cycleEnd - t4
        ).toFixed(3)}s`,
      )
    }
  }
}

export function createThreeToneFr(ctx: SirenBuildContext, instance: SoundInstance): void {
  const { frDebugIsolation } = ctx
  instance.debug.modulation = 'three-tone-fr-persistent-voice'
  const voice = createFrTwoToneVoice(ctx, instance, 700, undefined, {
    withDrift: !frDebugIsolation,
    withWobble: false,
    withNoise: false,
    withEq: true,
    withGateCompressor: true,
  })
  if (!voice) return
  const { oscA, gate } = voice
  instance.mainOsc = oscA
  scheduleAlternatingTones(ctx, instance, oscA, {
    mode: 'gatedThreeTone',
    gate,
    noteMs: 180,
    extraPauseSec: 1.1,
    attack: 0.005,
    endFade: 0.02,
    horizonCycles: 220,
    toneHz: [420, 516, 420],
    logTag: 'three-tone',
  })
  instance.debug.frequencyHz = 700
}

export function createTwoToneFr(
  ctx: SirenBuildContext,
  instance: SoundInstance,
  freqs: number[],
  everyMs: number,
): void {
  const { frDebugIsolation } = ctx
  const voice = createFrTwoToneVoice(ctx, instance, freqs[0] ?? 700, undefined, {
    withDrift: !frDebugIsolation,
    withWobble: false,
    withNoise: false,
    withEq: true,
    withGateCompressor: true,
  })
  if (!voice) return
  const { oscA } = voice
  instance.mainOsc = oscA
  instance.debug.frequencyHz = freqs[0] ?? 700
  instance.debug.modulation = 'two-tone-fr'

  scheduleAlternatingTones(ctx, instance, oscA, {
    mode: 'stepped',
    freqs,
    stepMs: everyMs,
    logPrefix: '[two-tone]',
    baseFallback: freqs[0] ?? 700,
  })
  instance.debug.frequencyHz = freqs[0] ?? 700
}

/** Même chaîne que `createTwoToneFr` (timbre FR + gate + comp + EQ), fréquences / pas police. */
export function createPoliceFrTwoTone(
  ctx: SirenBuildContext,
  instance: SoundInstance,
  freqs: number[],
  everyMs: number,
  modulation: string,
): void {
  const { frDebugIsolation } = ctx
  const voice = createFrTwoToneVoice(ctx, instance, freqs[0] ?? 800, undefined, {
    withDrift: !frDebugIsolation,
    withWobble: false,
    withNoise: false,
    withEq: true,
    withGateCompressor: true,
  })
  if (!voice) return
  const { oscA } = voice
  instance.mainOsc = oscA
  instance.debug.frequencyHz = freqs[0] ?? 800
  instance.debug.modulation = modulation

  scheduleAlternatingTones(ctx, instance, oscA, {
    mode: 'stepped',
    freqs,
    stepMs: everyMs,
    logPrefix: '[two-tone-police]',
    baseFallback: freqs[0] ?? 800,
  })
  instance.debug.frequencyHz = freqs[0] ?? 800
}
