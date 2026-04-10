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
  const { audioContext: ac, frDebugIsolation, noiseBuffer } = ctx
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

export function createThreeToneFr(ctx: SirenBuildContext, instance: SoundInstance): void {
  const { audioContext: ac, frDebugIsolation, logDebug } = ctx
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
  const noteMs = 180
  const cycleSec = (noteMs * 3) / 1000 + 1.1
  const attack = 0.005
  const endFade = 0.02
  const horizonCycles = 220
  const start = ac.currentTime + 0.01
  for (let i = 0; i < horizonCycles; i += 1) {
    const cycleStart = start + i * cycleSec
    const t2 = cycleStart + noteMs / 1000
    const t3 = cycleStart + (noteMs * 2) / 1000
    const t4 = cycleStart + (noteMs * 3) / 1000
    gate.gain.cancelScheduledValues(cycleStart)
    gate.gain.setValueAtTime(0, cycleStart)
    const f1 = clampFrequencyHz(420 + nextJitter(instance, 1))
    const f2 = clampFrequencyHz(516 + nextJitter(instance, 1))
    const f3 = clampFrequencyHz(420 + nextJitter(instance, 1))
    oscA.frequency.setValueAtTime(f1, cycleStart)
    oscA.frequency.setValueAtTime(f2, t2)
    oscA.frequency.setValueAtTime(f3, t3)
    oscA.frequency.setValueAtTime(f3, t4)

    gate.gain.setValueAtTime(0, cycleStart)
    gate.gain.linearRampToValueAtTime(1, cycleStart + attack)
    gate.gain.setValueAtTime(1, t4)
    gate.gain.linearRampToValueAtTime(0, t4 + endFade)

    const cycleEnd = cycleStart + cycleSec
    gate.gain.setValueAtTime(0, cycleEnd)
    if (i < 8 || i % 20 === 0) {
      logDebug(
        `[three-tone] cycle=${i} f=[${f1.toFixed(1)},${f2.toFixed(1)},${f3.toFixed(1)}] fade=${endFade.toFixed(3)}s pause=${(
          cycleEnd - t4
        ).toFixed(3)}s`,
      )
    }
  }
  instance.debug.frequencyHz = 700
}

export function createTwoToneFr(
  ctx: SirenBuildContext,
  instance: SoundInstance,
  freqs: number[],
  everyMs: number,
): void {
  const { audioContext: ac, frDebugIsolation, logDebug } = ctx
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

  const start = ac.currentTime + 0.01
  const step = everyMs / 1000
  const horizonSteps = 600
  for (let i = 0; i < horizonSteps; i += 1) {
    const idx = i % freqs.length
    const f = clampFrequencyHz((freqs[idx] ?? freqs[0] ?? 700) + nextJitter(instance, 1))
    oscA.frequency.setValueAtTime(f, start + i * step)
    if (i < 8) logDebug(`[two-tone] step=${i} f=${f.toFixed(2)}Hz t=${(i * step).toFixed(3)}s`)
  }
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
  const { audioContext: ac, frDebugIsolation, logDebug } = ctx
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

  const start = ac.currentTime + 0.01
  const step = everyMs / 1000
  const horizonSteps = 600
  for (let i = 0; i < horizonSteps; i += 1) {
    const idx = i % freqs.length
    const f = clampFrequencyHz((freqs[idx] ?? freqs[0] ?? 800) + nextJitter(instance, 1))
    oscA.frequency.setValueAtTime(f, start + i * step)
    if (i < 8) logDebug(`[two-tone-police] step=${i} f=${f.toFixed(2)}Hz t=${(i * step).toFixed(3)}s`)
  }
  instance.debug.frequencyHz = freqs[0] ?? 800
}
