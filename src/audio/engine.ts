import { getSoundDefinitionById, type SoundKind } from '../utils/sirenConfig'
import { AUDIO_CALIBRATION } from './audioCalibration'
import {
  buildDebugSnapshot,
  logAudioDebug,
  logMasterDestinationRouting,
} from './debug'
import { HORN_FIRE_GAIN, HORN_POLICE_GAIN, createHorn } from './horns'
import { createMasterChain, type MasterChain } from './masterChain'
import type { SilenceDiagnostics, SirenBuildContext, SoundInstance, SoundPreset } from './types'
export type {
  DebugVoice,
  FrVoiceOptions,
  SilenceDiagnostics,
  SoundPreset,
  SoundInstance,
  WailYelpUnifiedOptions,
} from './types'
import { createHiLo } from './sirens/hiLo'
import { createPhaser } from './sirens/phaser'
import { createQSiren } from './sirens/qsiren'
import {
  createPoliceFrTwoTone,
  createThreeToneFr,
  createTwoToneFr,
} from './sirens/twoTone'
import { createWailUnified } from './sirens/wail'
import { createYelpUnified } from './sirens/yelp'
import { buildNoiseBuffer, getDbAtHz, measureRMS } from './utils/audioUtils'

const SAMPLE_EXTENSIONS = ['mp3', 'wav', 'ogg']

class AudioEngine {
  private context?: AudioContext
  private masterChain?: MasterChain
  private mixGain?: GainNode
  private masterGain?: GainNode
  private analyser?: AnalyserNode
  private analyserDebugPreFinalEq?: AnalyserNode
  private initialized = false
  private samples = new Map<string, AudioBuffer>()
  private active = new Map<string, SoundInstance>()
  private debugLog: string[] = []
  private noiseBuffer?: AudioBuffer
  private policeHornBuffer?: AudioBuffer
  private airHornBuffer?: AudioBuffer
  private frDebugIsolation = false
  private DEBUG_AUDIO = false
  private readonly loudnessTargetDb = -11

  private sirenCtx(): SirenBuildContext {
    return {
      audioContext: this.context!,
      frDebugIsolation: this.frDebugIsolation,
      noiseBuffer: this.noiseBuffer,
      logDebug: (m) => this.logDebug(m),
    }
  }

  async init() {
    if (this.initialized) return
    this.DEBUG_AUDIO =
      typeof window !== 'undefined' && window.location.search.includes('debugAudio=1')
    this.context = new AudioContext({ latencyHint: 'interactive' })
    this.masterChain = createMasterChain(this.context)
    this.mixGain = this.masterChain.mixGain
    this.masterGain = this.masterChain.masterGain
    this.analyser = this.masterChain.analyser
    this.analyserDebugPreFinalEq = this.masterChain.analyserDebugPreFinalEq

    logMasterDestinationRouting((m) => this.logDebug(m))
    this.noiseBuffer = buildNoiseBuffer(this.context)
    await this.loadPoliceHornBuffer()
    await this.loadAirHornBuffer()
    this.initialized = true
  }

  private async loadPoliceHornBuffer(): Promise<void> {
    if (!this.context) return
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')
    for (const ext of ['wav', 'mp3'] as const) {
      try {
        const res = await fetch(`${base}audio/horn-police-us.${ext}`)
        if (!res.ok) continue
        const raw = await res.arrayBuffer()
        this.policeHornBuffer = await this.context.decodeAudioData(raw.slice(0))
        this.logDebug(`[horn-police] sample loaded (horn-police-us.${ext}, ${this.policeHornBuffer.duration.toFixed(2)}s)`)
        return
      } catch (e) {
        this.logDebug(`[horn-police] sample horn-police-us.${ext} failed: ${e}`)
      }
    }
    this.policeHornBuffer = undefined
    this.logDebug('[horn-police] no sample in public/audio')
  }

  private async loadAirHornBuffer(): Promise<void> {
    if (!this.context) return
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')
    for (const ext of ['wav', 'mp3'] as const) {
      try {
        const res = await fetch(`${base}audio/horn-fire-us.${ext}`)
        if (!res.ok) continue
        const raw = await res.arrayBuffer()
        this.airHornBuffer = await this.context.decodeAudioData(raw.slice(0))
        this.logDebug(
          `[horn-fire] sample loaded (horn-fire-us.${ext}, ${this.airHornBuffer.duration.toFixed(2)}s)`,
        )
        return
      } catch (e) {
        this.logDebug(`[horn-fire] sample horn-fire-us.${ext} failed: ${e}`)
      }
    }
    this.airHornBuffer = undefined
    this.logDebug('[horn-fire] no sample in public/audio')
  }

  async resume() {
    if (!this.context) return
    if (this.context.state !== 'running') await this.context.resume()
  }

  getAnalyser() {
    return this.analyser
  }

  hasPoliceHorn(): boolean {
    return !!this.policeHornBuffer
  }

  hasAirHorn(): boolean {
    return !!this.airHornBuffer
  }

  getDebugAnalyserPreFinalEq() {
    return this.analyserDebugPreFinalEq ?? null
  }

  getDebugSnapshot() {
    return buildDebugSnapshot(this.active, this.debugLog, this.analyser)
  }

  setFrDebugIsolation(enabled: boolean) {
    this.frDebugIsolation = enabled
    this.logDebug(`[debug-fr] isolation=${enabled ? 'on' : 'off'}`)
  }

  debugGetSpectrumSnapshot() {
    if (!this.analyser) return null
    const bins = new Float32Array(this.analyser.frequencyBinCount)
    this.analyser.getFloatFrequencyData(bins)
    const sampleRate = this.context?.sampleRate ?? 48000
    const nyquist = sampleRate / 2
    const hzPerBin = nyquist / bins.length
    const points = [20, 40, 60, 80, 100, 120, 150, 173, 200, 300]
    const result = points.map((hz) => {
      const idx = Math.max(0, Math.min(bins.length - 1, Math.round(hz / hzPerBin)))
      return { hz, db: Number(bins[idx]?.toFixed(2) ?? -160) }
    })
    this.logDebug(`[debug-fr] spectrum ${result.map((p) => `${p.hz}Hz=${p.db}dB`).join(' ')}`)
    return result
  }

  async debugValidateLowBand(soundId: string, preset: SoundPreset, sampleMs = 1400) {
    if (!this.context || !this.analyser) return null
    const probeId = `__probe-${soundId}`
    this.stopAll(false)
    this.play(probeId, preset)
    await new Promise((resolve) => window.setTimeout(resolve, sampleMs))
    const bins = new Float32Array(this.analyser.frequencyBinCount)
    this.analyser.getFloatFrequencyData(bins)
    const sampleRate = this.context.sampleRate
    let lowBandMaxDb = -160
    for (let hz = 20; hz <= 150; hz += 10) {
      const db = getDbAtHz(bins, sampleRate, hz)
      lowBandMaxDb = Math.max(lowBandMaxDb, db)
    }
    const hz173Db = getDbAtHz(bins, sampleRate, 173)
    const hz220Db = getDbAtHz(bins, sampleRate, 220)
    this.stop(probeId, 0.02)
    const result = {
      soundId,
      lowBandMaxDb: Number(lowBandMaxDb.toFixed(2)),
      hz173Db: Number(hz173Db.toFixed(2)),
      hz220Db: Number(hz220Db.toFixed(2)),
      sampleMs,
    }
    this.logDebug(
      `[debug-band] ${soundId} low20-150=${result.lowBandMaxDb}dB 173Hz=${result.hz173Db}dB 220Hz=${result.hz220Db}dB`,
    )
    return result
  }

  async debugPlayFrTwoToneIsolated() {
    this.stopAll(false)
    this.setFrDebugIsolation(true)
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    this.play('__debug-fr-two-tone', { kind: 'twoTone', regionStyle: 'eu', variant: 'ambulance' })
    this.logDebug('[debug-fr] launched isolated two-tone')
  }

  setMasterVolume(value: number) {
    if (!this.masterGain || !this.context) return
    const now = this.context.currentTime
    this.masterGain.gain.cancelScheduledValues(now)
    this.masterGain.gain.linearRampToValueAtTime(value, now + 0.05)
  }

  async preloadSamples(ids: string[]) {
    if (!this.context) return
    await Promise.all(
      ids.map(async (id) => {
        if (this.samples.has(id)) return
        for (const ext of SAMPLE_EXTENSIONS) {
          try {
            const response = await fetch(`/sounds/${id}.${ext}`)
            if (!response.ok) continue
            const arr = await response.arrayBuffer()
            const decoded = await this.context!.decodeAudioData(arr)
            this.samples.set(id, decoded)
            break
          } catch {
            // Keep synth fallback.
          }
        }
      }),
    )
  }

  play(id: string, preset: SoundPreset) {
    if (!this.context || !this.mixGain || !this.initialized) return
    if (this.active.has(id)) return

    let def = getSoundDefinitionById(id)
    if (!def && id.startsWith('__probe-')) {
      def = getSoundDefinitionById(id.slice('__probe-'.length))
    }
    const presetResolved: SoundPreset = {
      ...preset,
      regionStyle: preset.regionStyle ?? def?.regionStyle,
      variant: preset.variant ?? def?.variant,
    }

    const gainNode = this.context.createGain()
    gainNode.gain.value = 0
    gainNode.connect(this.mixGain)

    const voiceInput = this.context.createGain()
    voiceInput.gain.value = 1
    voiceInput.connect(gainNode)

    const instance: SoundInstance = {
      id,
      gainNode,
      voiceInput,
      oscillators: [],
      lfoNodes: [],
      modulationNodes: [],
      preset: presetResolved,
      debug: { frequencyHz: 0, holdActive: false, modulation: 'idle' },
    }

    const sample = this.samples.get(id)
    if (sample) {
      const source = this.context.createBufferSource()
      source.buffer = sample
      source.loop = true
      source.connect(voiceInput)
      source.start()
      instance.sampleSource = source
    } else {
      this.buildSynth(instance)
    }

    const now = this.context.currentTime
    const normalizedGain = this.normalizePresetVolume(preset.kind, preset.gain)
    const calibration = AUDIO_CALIBRATION[id] ?? 1
    const finalGain = normalizedGain * calibration
    const hornSampleInstant =
      instance.debug.modulation === 'horn-us-police-sample' ||
      instance.debug.modulation === 'horn-us-fire-sample'
    if (hornSampleInstant) {
      gainNode.gain.cancelScheduledValues(now)
      const hornMul =
        instance.debug.modulation === 'horn-us-police-sample' ? HORN_POLICE_GAIN : HORN_FIRE_GAIN
      gainNode.gain.setValueAtTime(finalGain * hornMul, now)
    } else {
      gainNode.gain.setValueAtTime(0, now)
      gainNode.gain.linearRampToValueAtTime(finalGain, now + 0.02)
    }
    this.active.set(id, instance)
    this.logDebug(`[play] ${id} kind=${preset.kind}`)
  }

  private getUnifiedGain(kind: SoundKind) {
    switch (kind) {
      case 'qsiren':
        return 0.48
      case 'wail':
        return 0.47
      case 'yelp':
        return 0.46
      case 'twoTone':
      case 'twoToneA':
      case 'twoToneM':
      case 'twoToneUmh':
        return 0.47
      case 'threeTone':
        return 0.47
      case 'horn':
        return 0.44
      default:
        return 0.46
    }
  }

  private normalizePresetVolume(kind: SoundKind, explicitGain?: number) {
    const target = this.getUnifiedGain(kind)
    const staticCompensation: Partial<Record<SoundKind, number>> = {
      qsiren: 0.99,
      wail: 1.01,
      yelp: 0.9,
      hilo: 1.02,
      phaser: 1.01,
      horn: 0.95,
      twoTone: 1.12,
      twoToneA: 1.1,
      twoToneM: 1.1,
      twoToneUmh: 1.12,
      threeTone: 1.14,
    }
    const staticMul = staticCompensation[kind] ?? 1
    const normalized = (explicitGain ?? target) * staticMul
    const clamped = Math.max(0.4, Math.min(0.64, normalized))
    this.logDebug(
      `[loudness] kind=${kind} gain=${clamped.toFixed(3)} static=${staticMul.toFixed(3)} targetDbRef=${this.loudnessTargetDb}`,
    )
    return clamped
  }

  stop(id: string, fadeOut = 0.05) {
    if (!this.context) return
    const instance = this.active.get(id)
    if (!instance) return

    const now = this.context.currentTime
    instance.gainNode.gain.cancelScheduledValues(now)
    instance.gainNode.gain.setValueAtTime(instance.gainNode.gain.value, now)
    instance.gainNode.gain.linearRampToValueAtTime(0, now + fadeOut)

    window.setTimeout(() => {
      try {
        instance.sampleSource?.stop()
      } catch {
        // already stopped
      }
      try {
        instance.noiseSource?.stop()
      } catch {
        // already stopped
      }
      instance.oscillators.forEach((osc) => {
        try {
          osc.stop()
        } catch {
          // already stopped
        }
      })
      instance.lfoNodes.forEach((lfo) => {
        try {
          lfo.stop()
        } catch {
          // already stopped
        }
      })
      instance.modulationNodes.forEach((node) => {
        if ('stop' in node && typeof node.stop === 'function') {
          try {
            node.stop()
          } catch {
            // Ignore already stopped.
          }
        }
        node.disconnect()
      })
      if (instance.timer) window.clearInterval(instance.timer)
      instance.voiceInput.disconnect()
      instance.gainNode.disconnect()
      this.active.delete(id)
    }, (fadeOut + 0.04) * 1000)
  }

  stopAll(withChirp = false) {
    for (const id of this.active.keys()) this.stop(id, 0.03)
    if (withChirp) this.playStopChirp()
  }

  debugAbsoluteSilence() {
    for (const id of [...this.active.keys()]) {
      this.stop(id, 0.005)
    }
    this.logDebug('[debug] absolute silence requested')
  }

  debugSilenceDiagnostics(): SilenceDiagnostics {
    const suspicious: string[] = []
    const activeVoiceIds = [...this.active.keys()]
    if (activeVoiceIds.length > 0) {
      suspicious.push(`active voices still present: ${activeVoiceIds.join(', ')}`)
    }

    for (const [id, voice] of this.active.entries()) {
      if (voice.holdOffset && voice.holdOffset.offset.value > 0) {
        suspicious.push(`${id}: holdOffset > 0 (${voice.holdOffset.offset.value.toFixed(3)})`)
      }
      if (voice.gainNode.gain.value > 0) {
        suspicious.push(`${id}: gainNode gain > 0 (${voice.gainNode.gain.value.toFixed(6)})`)
      }
      if (voice.oscillators.length > 0) {
        suspicious.push(`${id}: oscillators array non-vide (${voice.oscillators.length})`)
      }
    }

    let rms = 0
    if (this.analyser) {
      rms = measureRMS(this.analyser)
      if (rms > 0.0005) suspicious.push(`master RMS > 0 en silence (${rms.toExponential(3)})`)
    } else {
      suspicious.push('analyser non initialisé')
    }

    this.logDebug(`[debug] silence diagnostics rms=${rms.toExponential(3)} voices=${activeVoiceIds.length}`)
    return {
      rms,
      activeVoiceCount: activeVoiceIds.length,
      activeVoiceIds,
      suspicious,
    }
  }

  setQSirenBoost(id: string, amount: number) {
    const instance = this.active.get(id)
    if (!instance || !this.context || instance.preset.kind !== 'qsiren' || !instance.holdOffset) return

    const now = this.context.currentTime
    const targetOffset = amount > 0.5 ? 490 : 0
    instance.qHoldActive = amount > 0.5
    instance.holdOffset.offset.cancelScheduledValues(now)
    instance.holdOffset.offset.setTargetAtTime(targetOffset, now, instance.qHoldActive ? 0.55 : 2.3)

    instance.debug.frequencyHz = (instance.qBaseFreq ?? 400) + targetOffset
    instance.debug.holdActive = instance.qHoldActive
    this.logDebug(`[q-siren] id=${id} hold=${instance.qHoldActive} offset=${targetOffset.toFixed(1)}`)
  }

  private buildSynth(instance: SoundInstance) {
    const ctx = this.sirenCtx()
    switch (instance.preset.kind) {
      case 'qsiren':
        createQSiren(ctx, instance)
        break
      case 'threeTone':
        createThreeToneFr(ctx, instance)
        break
      case 'wail':
        createWailUnified(ctx, instance, {})
        break
      case 'yelp':
        createYelpUnified(ctx, instance, {})
        break
      case 'phaser':
        createPhaser(ctx, instance)
        break
      case 'hilo':
        createHiLo(ctx, instance)
        break
      case 'twoToneA':
        if (instance.preset.regionStyle === 'eu' && instance.preset.variant === 'police') {
          createPoliceFrTwoTone(ctx, instance, [435, 580], 580, 'twoToneA-police-fr')
          break
        }
        if (instance.preset.regionStyle === 'eu' && instance.preset.variant === 'fire') {
          createTwoToneFr(ctx, instance, [435, 488], 1200)
          break
        }
        createTwoToneFr(ctx, instance, [700, 900], 700)
        break
      case 'twoToneM':
        if (instance.preset.regionStyle === 'eu' && instance.preset.variant === 'police') {
          createPoliceFrTwoTone(ctx, instance, [435, 580], 520, 'twoToneM-police-fr')
          break
        }
        if (instance.preset.regionStyle === 'eu' && instance.preset.variant === 'fire') {
          createTwoToneFr(ctx, instance, [435, 488], 950)
          break
        }
        createTwoToneFr(ctx, instance, [700, 900], 700)
        break
      case 'twoTone':
        createTwoToneFr(ctx, instance, [420, 516], 560)
        break
      case 'twoToneUmh':
        createTwoToneFr(ctx, instance, [435, 651], 560)
        break
      case 'horn':
      default:
        createHorn(this.context!, instance, { police: this.policeHornBuffer, air: this.airHornBuffer }, (m) =>
          this.logDebug(m),
        )
    }
  }

  async debugFrSilenceTest() {
    this.debugAbsoluteSilence()
    await new Promise((resolve) => window.setTimeout(resolve, 120))
    return this.debugSilenceDiagnostics()
  }

  private playStopChirp() {
    if (!this.context || !this.masterGain) return
    const gain = this.context.createGain()
    gain.gain.value = 0.18
    gain.connect(this.masterGain)
    const osc = this.context.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(900, this.context.currentTime)
    osc.frequency.exponentialRampToValueAtTime(240, this.context.currentTime + 0.22)
    osc.connect(gain)
    osc.start()
    osc.stop(this.context.currentTime + 0.24)
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + 0.24)
  }

  private logDebug(message: string) {
    logAudioDebug(this.debugLog, this.DEBUG_AUDIO, message)
  }
}

export const audioEngine = new AudioEngine()
