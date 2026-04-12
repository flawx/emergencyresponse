import { getSoundDefinitionById, type SoundKind } from '../utils/sirenConfig'
import { resolveAudioCalibration } from './audioCalibration'
import {
  buildDebugSnapshot,
  logAudioDebug,
  logMasterDestinationRouting,
} from './debug'
import { HORN_FIRE_GAIN, HORN_POLICE_GAIN, createHorn } from './horns'
import {
  createMasterChain,
  MASTER_EQ_HIGHSHELF_GAIN_MULTI,
  MASTER_EQ_HIGHSHELF_GAIN_SINGLE,
  MASTER_EQ_PRESENCE_GAIN_MULTI,
  MASTER_EQ_PRESENCE_GAIN_SINGLE,
  type MasterChain,
} from './masterChain'
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
import { supportsSetSinkId } from '../utils/systemInfo'
import { buildNoiseBuffer, getAssetUrl, getDbAtHz, measureRMS } from './utils/audioUtils'
import { makeDistortionCurve } from './utils/distortion'

const SAMPLE_EXTENSIONS = ['mp3', 'wav', 'ogg']

/** Headroom global sur le gain de voix (évite la saturation au bus). */
const PLAY_HEADROOM = 0.6
/** Atténuation quand une autre voix joue déjà (mix plus propre). */
const MULTI_VOICE_COMPENSATION = 0.75
const MAX_SIMULTANEOUS_VOICES = 2

/** `true` = micro → `micPreGain` → `micGain` (sans chaîne mégaphone), pour test qualité brute. */
const BYPASS_MEGAPHONE = false

class AudioEngine {
  private context?: AudioContext
  private masterChain?: MasterChain
  private mixGain?: GainNode
  private masterGain?: GainNode
  private analyser?: AnalyserNode
  private analyserDebugPreFinalEq?: AnalyserNode
  private masterEqPresence?: BiquadFilterNode
  private masterEqHighShelf?: BiquadFilterNode
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
  private mediaStreamDestination?: MediaStreamAudioDestinationNode
  private outputAudioEl?: HTMLAudioElement
  /** `false` au boot : sortie native `context.destination` (évite glitches MediaStream). Passage à `true` via `enableMediaStreamOutput` (ex. Settings / `setSinkId`). */
  private useMediaStreamOutput = false
  /**
   * Court laps de temps après `init` : on évite de reprogrammer l’EQ master (présence / highshelf)
   * à chaque `play`/`stop`, alors que `createMasterChain` a déjà posé les cibles « une voix ».
   * Un seul rattrapage à la fin aligne l’EQ sur le nombre de voix réel (ex. passage multi).
   *
   * Note : ne pas appliquer la même garde à `updateAllActiveVoiceTrimGains` — elle est indispensable
   * dès le premier `play()` pour sortir les `gainNode` de voix de 0.
   */
  private masterEqWarmUpActive = false
  private masterEqWarmUpTimer: ReturnType<typeof setTimeout> | undefined
  /** Une fois le flux MediaStream → `<audio>` démarré, ne plus appliquer le warm-up muet. */
  private outputAudioWarmupComplete = false

  private micStream?: MediaStream
  private micSource?: MediaStreamAudioSourceNode
  private micPreGain?: GainNode
  private micGain?: GainNode
  private megaphoneHPF?: BiquadFilterNode
  private megaphoneLPF?: BiquadFilterNode
  private megaphonePresence?: BiquadFilterNode
  private megaphoneDistortion?: WaveShaperNode
  private megaphoneCompressor?: DynamicsCompressorNode

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

    /** Taux d’échantillonnage par défaut du device (probe fermée tout de suite — pas de contexte persistant en plus). */
    let outputSampleRate: number | undefined
    if (typeof window !== 'undefined' && typeof AudioContext !== 'undefined') {
      try {
        const probe = new AudioContext({ latencyHint: 'interactive' })
        outputSampleRate = probe.sampleRate
        await probe.close()
      } catch {
        // fallback : contexte principal sans sampleRate explicite
      }
    }

    this.context = new AudioContext({
      latencyHint: 'interactive',
      ...(outputSampleRate != null && outputSampleRate > 0 ? { sampleRate: outputSampleRate } : {}),
    })

    if (import.meta.env.DEV) {
      console.log('[Audio] sampleRate:', this.context.sampleRate)
    }

    this.useMediaStreamOutput = false
    this.mediaStreamDestination = undefined
    this.outputAudioEl = undefined
    this.masterChain = createMasterChain(this.context, this.context.destination)
    this.logDebug('[routing] boot: master → context.destination (MediaStream désactivé)')
    this.mixGain = this.masterChain.mixGain
    this.masterGain = this.masterChain.masterGain
    this.analyser = this.masterChain.analyser
    this.analyserDebugPreFinalEq = this.masterChain.analyserDebugPreFinalEq
    this.masterEqPresence = this.masterChain.masterEqPresence
    this.masterEqHighShelf = this.masterChain.masterEqHighShelf

    logMasterDestinationRouting((m) => this.logDebug(m))
    this.noiseBuffer = buildNoiseBuffer(this.context)
    await this.loadPoliceHornBuffer()
    await this.loadAirHornBuffer()
    this.initialized = true

    this.masterEqWarmUpActive = true
    if (typeof window !== 'undefined') {
      if (this.masterEqWarmUpTimer !== undefined) {
        window.clearTimeout(this.masterEqWarmUpTimer)
      }
      this.masterEqWarmUpTimer = window.setTimeout(() => {
        this.masterEqWarmUpTimer = undefined
        this.masterEqWarmUpActive = false
        this.syncMasterEqToVoiceCount()
      }, 2000)
    } else {
      this.masterEqWarmUpActive = false
    }
  }

  private async loadPoliceHornBuffer(): Promise<void> {
    if (!this.context) return
    for (const ext of ['wav', 'mp3'] as const) {
      try {
        const res = await fetch(getAssetUrl(`audio/horn-police-us.${ext}`))
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
    for (const ext of ['wav', 'mp3'] as const) {
      try {
        const res = await fetch(getAssetUrl(`audio/horn-fire-us.${ext}`))
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
    await this.ensureOutputElementPlaying()
  }

  /**
   * Attend que le `<audio>` ait assez de données sur le MediaStream avant `play()`
   * (évite instabilité / artefacts les premiers instants).
   */
  private waitForOutputCanPlay(el: HTMLAudioElement): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve()
    if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve()
    return new Promise((resolve) => {
      const finish = () => {
        el.removeEventListener('canplay', finish)
        el.removeEventListener('loadeddata', finish)
        window.clearTimeout(fallbackId)
        resolve()
      }
      el.addEventListener('canplay', finish, { once: true })
      el.addEventListener('loadeddata', finish, { once: true })
      const fallbackId = window.setTimeout(finish, 400)
    })
  }

  /**
   * Débranche `finalLimiter` de la sortie principale (`destination` ou `MediaStreamDestination`) sans toucher le tap vers `analyser`.
   */
  private disconnectFinalLimiterFromMainOutput() {
    const chain = this.masterChain
    const ctx = this.context
    if (!chain || !ctx) return
    const fl = chain.finalLimiter
    try {
      fl.disconnect(ctx.destination)
    } catch {
      /* pas connecté */
    }
    if (this.mediaStreamDestination) {
      try {
        fl.disconnect(this.mediaStreamDestination)
      } catch {
        /* pas connecté */
      }
    }
  }

  /**
   * Active MediaStream + `<audio>` (après un geste utilisateur, ex. choix de périphérique) et branche le master dessus.
   */
  async enableMediaStreamOutput(deviceId?: string): Promise<void> {
    if (!this.initialized) await this.init()
    const ctx = this.context
    const chain = this.masterChain
    if (!ctx || !chain) throw new Error('Audio not initialized')
    if (typeof document === 'undefined') {
      throw new Error('MediaStream output requires a browser document')
    }

    if (this.useMediaStreamOutput && this.outputAudioEl && this.mediaStreamDestination) {
      if (deviceId && supportsSetSinkId()) {
        await this.outputAudioEl.setSinkId(deviceId)
      }
      await this.ensureOutputElementPlaying()
      return
    }

    this.disconnectFinalLimiterFromMainOutput()

    this.mediaStreamDestination = ctx.createMediaStreamDestination()
    const el = new Audio()
    el.autoplay = false
    el.setAttribute('playsinline', '')
    el.srcObject = this.mediaStreamDestination.stream
    el.style.display = 'none'
    document.body.appendChild(el)
    this.outputAudioEl = el

    chain.finalLimiter.connect(this.mediaStreamDestination)
    this.useMediaStreamOutput = true

    if (deviceId && supportsSetSinkId()) {
      await el.setSinkId(deviceId)
    }
    await this.ensureOutputElementPlaying()
    this.logDebug(
      `[routing] MediaStream + <audio> activés${deviceId ? ` sink=${deviceId.slice(0, 12)}…` : ''}`,
    )
  }

  /** Revient à la sortie native Web Audio (plus de MediaStream / `<audio>`). */
  async disableMediaStreamOutput(): Promise<void> {
    if (!this.useMediaStreamOutput) return
    const ctx = this.context
    const chain = this.masterChain
    if (!ctx || !chain) {
      this.useMediaStreamOutput = false
      return
    }

    this.disconnectFinalLimiterFromMainOutput()
    chain.finalLimiter.connect(ctx.destination)

    const el = this.outputAudioEl
    if (el && typeof document !== 'undefined') {
      try {
        el.pause()
      } catch {
        /* ignore */
      }
      el.srcObject = null
      el.remove()
    }
    this.outputAudioEl = undefined
    this.mediaStreamDestination = undefined
    this.useMediaStreamOutput = false
    this.outputAudioWarmupComplete = false
    this.logDebug('[routing] master → context.destination (MediaStream désactivé)')
  }

  /** Lecture du flux master via `<audio>` (obligatoire lorsque la sortie passe par MediaStream). */
  private async ensureOutputElementPlaying() {
    if (!this.useMediaStreamOutput) return
    const el = this.outputAudioEl
    if (!el || typeof window === 'undefined') return
    try {
      await this.waitForOutputCanPlay(el)
      const firstStart = !this.outputAudioWarmupComplete
      if (firstStart) {
        el.muted = true
      }
      await el.play()
      if (firstStart) {
        this.outputAudioWarmupComplete = true
        window.setTimeout(() => {
          el.muted = false
        }, 500)
      }
    } catch {
      el.muted = false
      // Autoplay bloqué jusqu’à une interaction utilisateur — `resume()` est appelé après gesture dans le store.
    }
  }

  getAudioContext(): AudioContext | undefined {
    return this.context
  }

  supportsAudioOutputSelection(): boolean {
    return supportsSetSinkId()
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    if (!this.supportsAudioOutputSelection()) {
      throw new Error('setSinkId is not supported in this browser')
    }
    if (!deviceId) {
      await this.disableMediaStreamOutput()
      return
    }
    await this.enableMediaStreamOutput(deviceId)
  }

  getOutputSinkId(): string {
    const el = this.outputAudioEl
    if (!el) return ''
    try {
      return el.sinkId ?? ''
    } catch {
      return ''
    }
  }

  getAnalyser() {
    return this.analyser
  }

  /**
   * Capture micro → (`BYPASS_MEGAPHONE` ? direct : mégaphone) → `micPreGain` → `micGain` → `mixGain`.
   * Nécessite `getUserMedia` (geste utilisateur typique).
   */
  async enableMicrophone(deviceId?: string): Promise<void> {
    if (!this.initialized) await this.init()
    const ctx = this.context
    const mix = this.mixGain
    if (!ctx || !mix) throw new Error('Audio not initialized')
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia is not available')
    }

    this.disableMicrophone()

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        latency: 0,
        channelCount: 1,
      },
    })

    const source = ctx.createMediaStreamSource(stream)

    const preGain = ctx.createGain()
    preGain.gain.value = 3

    const gain = ctx.createGain()
    gain.gain.value = 0

    if (BYPASS_MEGAPHONE) {
      source.connect(preGain).connect(gain)
      gain.connect(mix)
      this.megaphoneHPF = undefined
      this.megaphoneLPF = undefined
      this.megaphonePresence = undefined
      this.megaphoneDistortion = undefined
      this.megaphoneCompressor = undefined
    } else {
      const hpf = ctx.createBiquadFilter()
      hpf.type = 'highpass'
      hpf.frequency.value = 200
      hpf.Q.value = 0.7

      const lpf = ctx.createBiquadFilter()
      lpf.type = 'lowpass'
      lpf.frequency.value = 4000
      lpf.Q.value = 0.7

      const presence = ctx.createBiquadFilter()
      presence.type = 'peaking'
      presence.frequency.value = 1500
      presence.gain.value = 3
      presence.Q.value = 1

      const dist = ctx.createWaveShaper()
      dist.curve = new Float32Array(makeDistortionCurve(2.8))
      dist.oversample = '4x'

      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -12
      comp.ratio.value = 2
      comp.attack.value = 0.01
      comp.release.value = 0.15

      source
        .connect(hpf)
        .connect(lpf)
        .connect(presence)
        .connect(dist)
        .connect(comp)
        .connect(preGain)
        .connect(gain)
      gain.connect(mix)

      this.megaphoneHPF = hpf
      this.megaphoneLPF = lpf
      this.megaphonePresence = presence
      this.megaphoneDistortion = dist
      this.megaphoneCompressor = comp
    }

    this.micStream = stream
    this.micSource = source
    this.micPreGain = preGain
    this.micGain = gain
    this.logDebug(
      `[mic] enabled (${BYPASS_MEGAPHONE ? 'bypass megaphone' : 'megaphone'})${deviceId ? ` device=${deviceId.slice(0, 12)}…` : ''}`,
    )
  }

  disableMicrophone(): void {
    const had = !!this.micStream
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.micStream = undefined
    const disconnectSafe = (n: AudioNode | undefined) => {
      if (!n) return
      try {
        n.disconnect()
      } catch {
        /* ignore */
      }
    }
    disconnectSafe(this.micSource)
    disconnectSafe(this.megaphoneHPF)
    disconnectSafe(this.megaphoneLPF)
    disconnectSafe(this.megaphonePresence)
    disconnectSafe(this.megaphoneDistortion)
    disconnectSafe(this.megaphoneCompressor)
    disconnectSafe(this.micPreGain)
    disconnectSafe(this.micGain)
    this.micSource = undefined
    this.megaphoneHPF = undefined
    this.megaphoneLPF = undefined
    this.megaphonePresence = undefined
    this.megaphoneDistortion = undefined
    this.megaphoneCompressor = undefined
    this.micPreGain = undefined
    this.micGain = undefined
    if (had) this.logDebug('[mic] disabled')
  }

  /** Monte ou coupe le micro dans le mix (ramp court sur `micGain`). */
  setMicrophoneActive(enabled: boolean): void {
    const ctx = this.context
    const g = this.micGain
    if (!ctx || !g) return
    const now = ctx.currentTime
    g.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.02)
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
            const response = await fetch(getAssetUrl(`sounds/${id}.${ext}`))
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

  play(id: string, preset: SoundPreset): boolean {
    if (!this.context || !this.mixGain || !this.initialized) return false
    if (this.active.has(id)) return false
    if (this.active.size >= MAX_SIMULTANEOUS_VOICES) return false

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
    const stereoPanner = this.context.createStereoPanner()
    stereoPanner.pan.value = this.stereoPanForSirenKind(presetResolved.kind)
    gainNode.connect(stereoPanner)
    stereoPanner.connect(this.mixGain)

    const voiceInput = this.context.createGain()
    voiceInput.gain.value = 1
    voiceInput.connect(gainNode)

    const instance: SoundInstance = {
      id,
      gainNode,
      stereoPanner,
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

    const normalizedGain = this.normalizePresetVolume(preset.kind, preset.gain)
    const calibration = resolveAudioCalibration(id)
    instance.voiceInput.gain.value *= calibration

    const hornSampleInstant =
      instance.debug.modulation === 'horn-us-police-sample' ||
      instance.debug.modulation === 'horn-us-fire-sample'
    const hornMul = hornSampleInstant
      ? instance.debug.modulation === 'horn-us-police-sample'
        ? HORN_POLICE_GAIN
        : HORN_FIRE_GAIN
      : 1
    instance.voiceTrimBase = normalizedGain
    instance.hornTrimMul = hornMul

    this.active.set(id, instance)
    this.syncMasterEqToVoiceCount()
    this.updateAllActiveVoiceTrimGains()

    const multiAfter = this.active.size > 1 ? MULTI_VOICE_COMPENSATION : 1
    const effectiveTrim = normalizedGain * PLAY_HEADROOM * multiAfter * hornMul
    this.logDebug(
      `[GAIN] id=${id} norm=${normalizedGain.toFixed(4)} cal=${calibration} trim=${effectiveTrim.toFixed(4)} voiceIn=${instance.voiceInput.gain.value.toFixed(4)} multi=${multiAfter}`,
    )
    this.logDebug(`[play] ${id} kind=${preset.kind}`)
    return true
  }

  /**
   * Recalcule le trim `gainNode` pour **toutes** les voix actives avec le même `MULTI_VOICE_COMPENSATION`,
   * pour que l’ordre d’activation (2ᵉ voix directe ou après d’autres actions) ne laisse pas une voix à multi=1.
   */
  private updateAllActiveVoiceTrimGains() {
    if (!this.context) return
    if (this.active.size === 0) return
    const multi = this.active.size > 1 ? MULTI_VOICE_COMPENSATION : 1
    const now = this.context.currentTime
    const timeConstant = 0.03
    for (const [, inst] of this.active) {
      const base = inst.voiceTrimBase
      if (base === undefined) continue
      const horn = inst.hornTrimMul ?? 1
      const target = base * PLAY_HEADROOM * multi * horn
      const current = inst.gainNode.gain.value
      inst.gainNode.gain.cancelScheduledValues(now)
      inst.gainNode.gain.setValueAtTime(current, now)
      inst.gainNode.gain.setTargetAtTime(target, now, timeConstant)
    }
    this.logDebug(`[multi-trim] voices=${this.active.size} multi=${multi}`)
  }

  /** Réduit le boost présence / air du master quand plusieurs sirènes somment au bus. */
  private syncMasterEqToVoiceCount() {
    if (!this.context || !this.masterEqPresence || !this.masterEqHighShelf) return
    if (this.masterEqWarmUpActive) return
    const isMulti = this.active.size > 1
    const now = this.context.currentTime
    const presenceTarget = isMulti ? MASTER_EQ_PRESENCE_GAIN_MULTI : MASTER_EQ_PRESENCE_GAIN_SINGLE
    const shelfTarget = isMulti ? MASTER_EQ_HIGHSHELF_GAIN_MULTI : MASTER_EQ_HIGHSHELF_GAIN_SINGLE
    this.masterEqPresence.gain.cancelScheduledValues(now)
    this.masterEqHighShelf.gain.cancelScheduledValues(now)
    this.masterEqPresence.gain.setTargetAtTime(presenceTarget, now, 0.04)
    this.masterEqHighShelf.gain.setTargetAtTime(shelfTarget, now, 0.04)
  }

  /** Séparation légère WAIL (gauche) vs tons FR (droite) en stéréo. */
  private stereoPanForSirenKind(kind: SoundKind): number {
    switch (kind) {
      case 'wail':
        return -0.1
      case 'twoTone':
      case 'twoToneA':
      case 'twoToneM':
      case 'twoToneUmh':
      case 'threeTone':
        return 0.1
      default:
        return 0
    }
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

    // Libère le slot tout de suite pour permettre un `play()` qui se croise avec la fin de fade
    // (crossfade orchestré côté store, sans dépasser MAX_SIMULTANEOUS_VOICES).
    this.active.delete(id)
    this.syncMasterEqToVoiceCount()
    this.updateAllActiveVoiceTrimGains()

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
      instance.stereoPanner?.disconnect()
      instance.voiceInput.disconnect()
      instance.gainNode.disconnect()
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
