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
import { buildNoiseBuffer, getAssetUrl, getDbAtHz, measureRMS } from './utils/audioUtils'

const SAMPLE_EXTENSIONS = ['mp3', 'wav', 'ogg']

/** Headroom global sur le gain de voix (évite la saturation au bus). */
const PLAY_HEADROOM = 0.7
/** Atténuation quand une autre voix joue déjà (mix plus propre). */
const MULTI_VOICE_COMPENSATION = 0.65
const MAX_SIMULTANEOUS_VOICES = 2

class AudioEngine {
  private context?: AudioContext
  private masterChain?: MasterChain
  private mixGain?: GainNode
  private masterGain?: GainNode
  private analyser?: AnalyserNode
  /** Diagnostic `?masterCheck=1` : sortie somme des voix avant HP180 / saturateur / EQ master. */
  private preMasterAnalyser?: AnalyserNode
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

  private sirenCtx(): SirenBuildContext {
    return {
      audioContext: this.context!,
      frDebugIsolation: this.frDebugIsolation,
      noiseBuffer: this.noiseBuffer,
      logDebug: (m) => this.logDebug(m),
      pipelineAudit: this.isPipelineAudit(),
    }
  }

  private isPipelineAudit(): boolean {
    return (
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('pipelineAudit') === '1'
    )
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
    this.masterEqPresence = this.masterChain.masterEqPresence
    this.masterEqHighShelf = this.masterChain.masterEqHighShelf

    this.preMasterAnalyser = this.context.createAnalyser()
    this.preMasterAnalyser.fftSize = 2048
    this.mixGain.connect(this.preMasterAnalyser)

    logMasterDestinationRouting((m) => this.logDebug(m))
    this.noiseBuffer = buildNoiseBuffer(this.context)
    await this.loadPoliceHornBuffer()
    await this.loadAirHornBuffer()
    this.initialized = true
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

    if (
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('sourceLevel') === '1'
    ) {
      const sourceAnalyser = this.context.createAnalyser()
      sourceAnalyser.fftSize = 2048
      instance.voiceInput.connect(sourceAnalyser)
      instance.modulationNodes.push(sourceAnalyser)
      window.setTimeout(() => {
        const rms = measureRMS(sourceAnalyser)
        const db = rms > 1e-6 ? 20 * Math.log10(rms) : -Infinity
        console.log(
          '[SOURCE LEVEL]',
          id,
          Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : '-∞ dBFS',
          '(voiceInput → pre-calibration trim)',
        )
      }, 200)
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
    this.scheduleMasterCheckLog(id)
    this.schedulePipelineAuditLog(id, instance)
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

  /** Pic max |x| sur le tampon temporel (détection clipping float > 1). */
  private peakAbsFromAnalyser(a: AnalyserNode): number {
    const buffer = new Float32Array(a.fftSize)
    a.getFloatTimeDomainData(buffer)
    let peak = 0
    for (let i = 0; i < buffer.length; i += 1) {
      const v = Math.abs(buffer[i]!)
      if (v > peak) peak = v
    }
    return peak
  }

  /**
   * Comparaison RMS pré / post chaîne master. Activer avec `?masterCheck=1`.
   * Interprétation indicative : voir doc utilisateur (delta négatif fort → atténuation / compression côté master).
   */
  private scheduleMasterCheckLog(id: string) {
    if (typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('masterCheck') !== '1') return
    const preA = this.preMasterAnalyser
    const postA = this.analyser
    if (!preA || !postA) return

    window.setTimeout(() => {
      const pre = measureRMS(preA)
      const post = measureRMS(postA)
      const preDb = pre > 1e-6 ? 20 * Math.log10(pre) : -Infinity
      const postDb = post > 1e-6 ? 20 * Math.log10(post) : -Infinity
      const deltaDb =
        Number.isFinite(preDb) && Number.isFinite(postDb) ? postDb - preDb : Number.NaN
      const peakPre = this.peakAbsFromAnalyser(preA)
      const peakPost = this.peakAbsFromAnalyser(postA)

      console.log('[MASTER CHECK]', {
        id,
        voices: this.active.size,
        preDb: Number.isFinite(preDb) ? preDb.toFixed(1) : '-∞',
        postDb: Number.isFinite(postDb) ? postDb.toFixed(1) : '-∞',
        deltaDb: Number.isFinite(deltaDb) ? deltaDb.toFixed(1) : 'n/a',
        clipPre: peakPre > 1,
        clipPost: peakPost > 1,
        peakPre: peakPre.toFixed(4),
        peakPost: peakPost.toFixed(4),
      })
    }, 200)
  }

  /**
   * Audit multi-taps RMS + pics. URL `?pipelineAudit=1`.
   *
   * Chaîne réelle (résumé) :
   * - **WAIL/YELP** : osc → … → `connectUnifiedSirenSourceToVoiceInput` (preGain → tanh → LP → HP250) → **voiceInput**
   *   (× calibration) → **gainNode** (trim × headroom × multi-comp) → **stereoPanner** → **mixGain** → master :
   *   HP180 → saturatorInputGain → WaveShaper → DynamicsCompressor → makeupGain → masterGain → (‖ debug analyser)
   *   → peaking présence → high-shelf → DC HP → **finalLimiter** → destination ‖ **analyser** (post-master).
   * - **2-tone / 3-tone FR** : osc → `connectFrSourceWithTimbre` (HP190 → shaper → DCHP → LP) → **voiceInput** (× cal)
   *   → gate → comp FR → makeup → EQ (… si `pipelineAudit`, **auditTap** gain 1) → **gainNode** → panner → mixGain → …
   */
  private schedulePipelineAuditLog(id: string, instance: SoundInstance) {
    if (!this.isPipelineAudit() || !this.context) return

    const fft = 2048
    const aVoiceIn = this.context.createAnalyser()
    aVoiceIn.fftSize = fft
    const aPostChain = this.context.createAnalyser()
    aPostChain.fftSize = fft
    const aGainNode = this.context.createAnalyser()
    aGainNode.fftSize = fft

    instance.voiceInput.connect(aVoiceIn)
    if (instance.auditPreGainNode) {
      instance.auditPreGainNode.connect(aPostChain)
    } else {
      instance.voiceInput.connect(aPostChain)
    }
    instance.gainNode.connect(aGainNode)

    instance.modulationNodes.push(aVoiceIn, aPostChain, aGainNode)

    const preMasterA = this.preMasterAnalyser
    const postMasterA = this.analyser

    window.setTimeout(() => {
      const rmsDb = (rms: number) => (rms > 1e-6 ? 20 * Math.log10(rms) : -Infinity)
      const fmt = (db: number) => (Number.isFinite(db) ? db.toFixed(1) : '-∞')

      const voiceInputDb = rmsDb(measureRMS(aVoiceIn))
      const postVoiceChainDb = rmsDb(measureRMS(aPostChain))
      const gainNodeDb = rmsDb(measureRMS(aGainNode))
      const mixDb = preMasterA ? rmsDb(measureRMS(preMasterA)) : Number.NaN
      const masterDb = postMasterA ? rmsDb(measureRMS(postMasterA)) : Number.NaN

      const peakVi = this.peakAbsFromAnalyser(aVoiceIn)
      const peakPost = this.peakAbsFromAnalyser(aPostChain)
      const peakGn = this.peakAbsFromAnalyser(aGainNode)
      const peakMix = preMasterA ? this.peakAbsFromAnalyser(preMasterA) : 0
      const peakMaster = postMasterA ? this.peakAbsFromAnalyser(postMasterA) : 0

      const { hints, primaryLead } = this.interpretPipelineAudit({
        voiceIn: voiceInputDb,
        post: postVoiceChainDb,
        gn: gainNodeDb,
        mix: mixDb,
        master: masterDb,
        peakVi,
        peakPost,
        peakGn,
        peakMix,
        peakMaster,
        voices: this.active.size,
        hasFrTap: !!instance.auditPreGainNode,
      })

      console.log('[PIPELINE AUDIT]', {
        id,
        voices: this.active.size,
        voiceInputDb: fmt(voiceInputDb),
        postVoiceChainDb: fmt(postVoiceChainDb),
        gainNodeDb: fmt(gainNodeDb),
        mixDb: Number.isFinite(mixDb) ? fmt(mixDb) : 'n/a',
        masterDb: Number.isFinite(masterDb) ? fmt(masterDb) : 'n/a',
        deltaPostToGnDb:
          Number.isFinite(postVoiceChainDb) && Number.isFinite(gainNodeDb)
            ? (gainNodeDb - postVoiceChainDb).toFixed(1)
            : 'n/a',
        deltaMixToMasterDb:
          Number.isFinite(mixDb) && Number.isFinite(masterDb) ? (masterDb - mixDb).toFixed(1) : 'n/a',
        clipVoiceIn: peakVi > 1,
        clipPostChain: peakPost > 1,
        clipGainNode: peakGn > 1,
        clipMix: peakMix > 1,
        clipMaster: peakMaster > 1,
        peakVoiceIn: peakVi.toFixed(4),
        peakPostChain: peakPost.toFixed(4),
        peakGainNode: peakGn.toFixed(4),
        peakMix: peakMix.toFixed(4),
        peakMaster: peakMaster.toFixed(4),
        note:
          'postVoiceChainDb = même point que voiceInputDb si pas de chaîne FR (WAIL/Yelp…). Analyseurs mix/master : fft 2048 / 128 — comparer les RMS en tendance, pas au dB près.',
        hints,
        primaryLead,
      })
    }, 200)
  }

  private interpretPipelineAudit(p: {
    voiceIn: number
    post: number
    gn: number
    mix: number
    master: number
    peakVi: number
    peakPost: number
    peakGn: number
    peakMix: number
    peakMaster: number
    voices: number
    hasFrTap: boolean
  }): { hints: string[]; primaryLead: string } {
    const hints: string[] = []
    const f = Number.isFinite

    if (p.hasFrTap && f(p.voiceIn) && f(p.post) && p.post - p.voiceIn < -2) {
      hints.push(
        'FR : baisse > ~2 dB entre sortie voiceInput et fin gate/comp/EQ (avant gainNode) — le traitement FR absorbe ou tasse le signal.',
      )
    }

    if (f(p.post) && f(p.gn) && p.gn - p.post < -4) {
      hints.push(
        'Fort écart fin de chaîne voix → sortie gainNode : normal en partie (trim × PLAY_HEADROOM × multi-comp sur gainNode ; wobble sur gain). Si > ~8 dB avec voix seule, vérifier calibration + trim.',
      )
    }

    if (f(p.mix) && f(p.master) && p.master - p.mix < -2.5) {
      hints.push(
        'Le master abaisse le RMS global (saturateur, EQ présence/shelf, compresseur master, limiteur) : chute mix→sortie.',
      )
    }

    if (p.peakMix > 0.98 || p.peakMaster > 0.98) {
      hints.push(
        'Pics float ≈ 1 sur mix ou post-master : waveshaper / limiteur / saturation du bus — corrélation probable avec grésillement perçu.',
      )
    }

    if (p.voices > 1 && f(p.mix) && f(p.master) && p.master - p.mix < -3) {
      hints.push(
        'Multi-voix : si mixDb monte fort par rapport au solo mais masterDb plafonne ou descend, le limiteur / compresseur master réagit fortement (écrasement).',
      )
    }

    if (hints.length === 0) {
      hints.push('Aucun seuil heuristique dépassé : comparer manuellement solo vs duo et les deltas listés.')
    }

    let primaryLead =
      'Aucune cause unique inférée sans comparer les 3 captures (WAIL seul, 2-tone seul, duo) — utiliser les deltas et pics.'

    if (p.peakMix > 1 || p.peakMaster > 1) {
      primaryLead =
        'Piste prioritaire : surcharge du bus (pics > 1) — réduire l’énergie avant le saturateur master (ex. `saturatorInputGain` ou headroom des voix), puis re-mesurer.'
    } else if (p.hasFrTap && f(p.voiceIn) && f(p.post) && p.post - p.voiceIn < -3) {
      primaryLead =
        'Piste prioritaire : traitement FR (compresseur / EQ) trop absorbant — assouplir seuil/ratio du comp FR ou réduire légèrement les boosts 500–1,8 kHz avant de toucher au master.'
    } else if (f(p.mix) && f(p.master) && p.master - p.mix < -4 && p.peakMix <= 0.95) {
      primaryLead =
        'Piste prioritaire : chaîne master (EQ + comp + limiteur) réduit fort le niveau sans pic extrême sur mix — revoir gains de présence/shelf ou `masterMakeupGain` / seuil limiteur.'
    }

    return { hints, primaryLead }
  }

  /** Réduit le boost présence / air du master quand plusieurs sirènes somment au bus. */
  private syncMasterEqToVoiceCount() {
    if (!this.context || !this.masterEqPresence || !this.masterEqHighShelf) return
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
      this.active.delete(id)
      this.syncMasterEqToVoiceCount()
      this.updateAllActiveVoiceTrimGains()
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
