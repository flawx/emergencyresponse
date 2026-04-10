import type { SoundInstance } from '../types'

/** URL d’asset statique compatible `base` Vite (déploiement sous-chemin, ex. `/app/`). */
export function getAssetUrl(path: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  return `${base}${path.replace(/^\/+/, '')}`
}

/**
 * RMS linéaire (0–1 typique) sur le tampon temporel de l’analyseur.
 * Avec l’analyseur branché après `finalLimiter`, reflète le niveau **post-limiteur** (ce que l’utilisateur entend).
 */
export function measureRMS(analyser: AnalyserNode): number {
  const buffer = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(buffer)
  let sum = 0
  for (let i = 0; i < buffer.length; i += 1) {
    sum += buffer[i] * buffer[i]
  }
  return Math.sqrt(sum / buffer.length)
}

export function getDbAtHz(bins: Float32Array, sampleRate: number, hz: number): number {
  const nyquist = sampleRate / 2
  const hzPerBin = nyquist / bins.length
  const idx = Math.max(0, Math.min(bins.length - 1, Math.round(hz / hzPerBin)))
  return bins[idx] ?? -160
}

export function buildNoiseBuffer(ctx: AudioContext): AudioBuffer | undefined {
  const sampleRate = ctx.sampleRate
  const buffer = ctx.createBuffer(1, sampleRate, sampleRate)
  const data = buffer.getChannelData(0)
  const freqs = [233, 377, 601, 983, 1423]
  const phases = [0.12, 1.17, 2.31, 0.77, 1.94]
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sampleRate
    let v = 0
    for (let j = 0; j < freqs.length; j += 1) {
      const f = freqs[j] ?? 233
      const p = phases[j] ?? 0
      v += (0.12 / (1 + j * 0.18)) * Math.sin(2 * Math.PI * f * t + p)
    }
    data[i] = v
  }
  return buffer
}

export function nextJitter(instance: SoundInstance, maxAbs: number): number {
  const seq = [-5, -2, 3, 1, -1, 4, -3, 2, 0]
  const idx = instance.jitterIndex ?? 0
  instance.jitterIndex = (idx + 1) % seq.length
  const value = seq[idx] ?? 0
  return Math.max(-maxAbs, Math.min(maxAbs, value))
}

export function clampFrequencyHz(hz: number): number {
  return Math.max(150, Math.min(6000, hz))
}

export function attachAnalogDrift(
  ctx: AudioContext,
  instance: SoundInstance,
  osc: OscillatorNode,
  lfoHz: number,
  depthHz: number,
): void {
  const drift = ctx.createOscillator()
  const driftGain = ctx.createGain()
  drift.type = 'sine'
  drift.frequency.value = lfoHz
  driftGain.gain.value = depthHz
  drift.connect(driftGain)
  driftGain.connect(osc.frequency)
  drift.start()
  instance.lfoNodes.push(drift)
  instance.modulationNodes.push(driftGain)
}

export function attachGainWobble(
  ctx: AudioContext,
  instance: SoundInstance,
  param: AudioParam,
  lfoHz: number,
  depth: number,
): void {
  const wobble = ctx.createOscillator()
  const wobbleGain = ctx.createGain()
  wobble.type = 'sine'
  wobble.frequency.value = lfoHz
  wobbleGain.gain.value = depth
  wobble.connect(wobbleGain)
  wobbleGain.connect(param)
  wobble.start()
  instance.lfoNodes.push(wobble)
  instance.modulationNodes.push(wobbleGain)
}

export function attachNoiseLayer(
  ctx: AudioContext,
  instance: SoundInstance,
  noiseBuffer: AudioBuffer | undefined,
  noiseGainValue: number,
  destination?: AudioNode,
): void {
  if (!noiseBuffer) return
  const clampedGain = Math.max(0, Math.min(0.05, noiseGainValue))
  if (clampedGain <= 0) return
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer
  noise.loop = true
  const noiseHighpass = ctx.createBiquadFilter()
  noiseHighpass.type = 'highpass'
  noiseHighpass.frequency.value = 220
  noiseHighpass.Q.value = 0.707
  const noiseGain = ctx.createGain()
  noiseGain.gain.value = clampedGain
  noise.connect(noiseHighpass)
  noiseHighpass.connect(noiseGain)
  noiseGain.connect(destination ?? instance.voiceInput)
  noise.start()
  instance.noiseSource = noise
  instance.modulationNodes.push(noiseHighpass, noiseGain)
}
