import type { SoundKind } from '../utils/sirenConfig'

type SoundPreset = {
  kind: SoundKind
  gain?: number
}

type DebugVoice = {
  frequencyHz: number
  holdActive: boolean
  modulation: string
}

type SilenceDiagnostics = {
  rms: number
  activeVoiceCount: number
  activeVoiceIds: string[]
  suspicious: string[]
}

type FrVoiceOptions = {
  withDrift?: boolean
  withWobble?: boolean
  withNoise?: boolean
  noiseGain?: number
  withEq?: boolean
  withGateCompressor?: boolean
}

/** Réservé aux extensions futures ; WAIL/YELP sont identiques pour tous les ids (pas de variante régionale). */
export type WailYelpUnifiedOptions = Record<string, never>

type SoundInstance = {
  id: string
  gainNode: GainNode
  voiceInput: GainNode
  oscillators: OscillatorNode[]
  lfoNodes: OscillatorNode[]
  modulationNodes: AudioNode[]
  noiseSource?: AudioBufferSourceNode
  timer?: number
  timeouts?: number[]
  sampleSource?: AudioBufferSourceNode
  preset: SoundPreset
  mainOsc?: OscillatorNode
  baseTone?: ConstantSourceNode
  holdOffset?: ConstantSourceNode
  jitterIndex?: number
  qBaseFreq?: number
  qTopFreq?: number
  qMaxFreq?: number
  qHoldActive?: boolean
  qCycleMs?: number
  debug: DebugVoice
}

const SAMPLE_EXTENSIONS = ['mp3', 'wav', 'ogg']

class AudioEngine {
  private context?: AudioContext
  private masterGain?: GainNode
  private masterMakeupGain?: GainNode
  private mixGain?: GainNode
  private saturatorInputGain?: GainNode
  private compressor?: DynamicsCompressorNode
  private finalLimiter?: DynamicsCompressorNode
  private saturator?: WaveShaperNode
  /** Tap après le limiteur final (viz, RMS produit). Voir `docs/audio-engine.md`. */
  private analyser?: AnalyserNode
  /** Tap debug : après `masterGain`, avant présence / shelf / DC / limiteur. */
  private analyserDebugPreFinalEq?: AnalyserNode
  private dcBlocker?: BiquadFilterNode
  private masterEqHighpass180?: BiquadFilterNode
  private masterEqPresence?: BiquadFilterNode
  private masterEqHighShelf?: BiquadFilterNode
  private initialized = false
  private samples = new Map<string, AudioBuffer>()
  private active = new Map<string, SoundInstance>()
  private debugLog: string[] = []
  private noiseBuffer?: AudioBuffer
  private frDebugIsolation = false
  private readonly loudnessTargetDb = -11
  private loudnessByKind = new Map<SoundKind, number>()
  private loudnessGainByKind = new Map<SoundKind, number>()
  private loudnessTrackers = new Map<string, number>()

  async init() {
    if (this.initialized) return
    this.context = new AudioContext({ latencyHint: 'interactive' })
    this.mixGain = this.context.createGain()
    this.mixGain.gain.value = 1
    this.saturatorInputGain = this.context.createGain()
    this.saturatorInputGain.gain.value = 1.4
    this.saturator = this.context.createWaveShaper()
    this.saturator.curve = this.makeDistortionCurve(11)
    this.saturator.oversample = '4x'
    this.compressor = this.context.createDynamicsCompressor()
    this.compressor.threshold.value = -24
    this.compressor.knee.value = 14
    this.compressor.ratio.value = 6
    this.compressor.attack.value = 0.003
    this.compressor.release.value = 0.06
    this.masterMakeupGain = this.context.createGain()
    this.masterMakeupGain.gain.value = 1.41
    this.masterGain = this.context.createGain()
    this.masterGain.gain.value = 0.92
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 128
    this.analyserDebugPreFinalEq = this.context.createAnalyser()
    this.analyserDebugPreFinalEq.fftSize = 128
    this.masterEqHighpass180 = this.context.createBiquadFilter()
    this.masterEqHighpass180.type = 'highpass'
    this.masterEqHighpass180.frequency.value = 180
    this.masterEqHighpass180.Q.value = 0.7
    this.masterEqPresence = this.context.createBiquadFilter()
    this.masterEqPresence.type = 'peaking'
    this.masterEqPresence.frequency.value = 1900
    this.masterEqPresence.Q.value = 0.9
    this.masterEqPresence.gain.value = 5.2
    this.masterEqHighShelf = this.context.createBiquadFilter()
    this.masterEqHighShelf.type = 'highshelf'
    this.masterEqHighShelf.frequency.value = 3600
    this.masterEqHighShelf.gain.value = 7.2
    this.dcBlocker = this.context.createBiquadFilter()
    this.dcBlocker.type = 'highpass'
    this.dcBlocker.frequency.value = 20
    this.dcBlocker.Q.value = 0.7
    this.finalLimiter = this.context.createDynamicsCompressor()
    this.finalLimiter.threshold.value = -1
    this.finalLimiter.knee.value = 0
    this.finalLimiter.ratio.value = 20
    this.finalLimiter.attack.value = 0.001
    this.finalLimiter.release.value = 0.05

    this.mixGain.connect(this.masterEqHighpass180)
    this.masterEqHighpass180.connect(this.saturatorInputGain)
    this.saturatorInputGain.connect(this.saturator)
    this.saturator.connect(this.compressor)
    this.compressor.connect(this.masterMakeupGain)
    this.masterMakeupGain.connect(this.masterGain)
    this.masterGain.connect(this.masterEqPresence)
    this.masterGain.connect(this.analyserDebugPreFinalEq)
    this.masterEqPresence.connect(this.masterEqHighShelf)
    this.masterEqHighShelf.connect(this.dcBlocker)
    this.dcBlocker.connect(this.finalLimiter)
    this.finalLimiter.connect(this.context.destination)
    this.finalLimiter.connect(this.analyser)
    this.logDestinationRouting()
    this.noiseBuffer = this.buildNoiseBuffer()
    this.initialized = true
  }

  async resume() {
    if (!this.context) return
    if (this.context.state !== 'running') await this.context.resume()
  }

  getAnalyser() {
    return this.analyser
  }

  /** Spectre / RMS avant EQ finale + DC + limiteur (debug uniquement). */
  getDebugAnalyserPreFinalEq() {
    return this.analyserDebugPreFinalEq ?? null
  }

  getDebugSnapshot() {
    const voices: Record<string, DebugVoice> = {}
    for (const [id, instance] of this.active.entries()) voices[id] = { ...instance.debug }
    return { voices, logs: this.debugLog.slice(-25) }
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
      const db = this.getDbAtHz(bins, sampleRate, hz)
      lowBandMaxDb = Math.max(lowBandMaxDb, db)
    }
    const hz173Db = this.getDbAtHz(bins, sampleRate, 173)
    const hz220Db = this.getDbAtHz(bins, sampleRate, 220)
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
    this.play('__debug-fr-two-tone', { kind: 'twoTone' })
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
      preset,
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
    gainNode.gain.setValueAtTime(0, now)
    const normalizedGain = this.normalizePresetVolume(preset.kind, preset.gain)
    gainNode.gain.linearRampToValueAtTime(normalizedGain, now + 0.02)
    this.active.set(id, instance)
    this.startLoudnessTracking(id, preset.kind)
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
    const learnedCompensation = this.loudnessGainByKind.get(kind) ?? 1
    const normalized = (explicitGain ?? target) * (staticCompensation[kind] ?? 1) * learnedCompensation
    const clamped = Math.max(0.4, Math.min(0.64, normalized))
    this.logDebug(
      `[loudness] kind=${kind} gain=${clamped.toFixed(3)} static=${(staticCompensation[kind] ?? 1).toFixed(
        3,
      )} learned=${learnedCompensation.toFixed(3)}`,
    )
    return clamped
  }

  private startLoudnessTracking(id: string, kind: SoundKind) {
    if (!this.context || !this.analyser) return
    if (this.active.size !== 1) return
    const startedAt = this.context.currentTime
    const tracker = window.setInterval(() => {
      if (!this.context || !this.analyser || !this.active.has(id)) {
        const existing = this.loudnessTrackers.get(id)
        if (existing) window.clearInterval(existing)
        this.loudnessTrackers.delete(id)
        return
      }
      if (this.active.size !== 1) return
      const samples = new Float32Array(this.analyser.fftSize)
      this.analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (let i = 0; i < samples.length; i += 1) {
        sum += samples[i] * samples[i]
      }
      const rms = Math.sqrt(sum / samples.length)
      const measuredDb = this.measureLoudness(rms)
      const prevDb = this.loudnessByKind.get(kind)
      const smoothedDb = prevDb == null ? measuredDb : prevDb * 0.82 + measuredDb * 0.18
      this.loudnessByKind.set(kind, smoothedDb)
      const adjustDb = Math.max(-6, Math.min(6, this.loudnessTargetDb - smoothedDb))
      const gainComp = Math.pow(10, adjustDb / 20)
      this.loudnessGainByKind.set(kind, gainComp)
      if (this.context.currentTime - startedAt > 2.4) {
        window.clearInterval(tracker)
        this.loudnessTrackers.delete(id)
      }
      this.logDebug(
        `[loudness] kind=${kind} measured=${smoothedDb.toFixed(2)}dB target=${this.loudnessTargetDb}dB comp=${gainComp.toFixed(
          3,
        )}`,
      )
    }, 180)
    this.loudnessTrackers.set(id, tracker)
  }

  private measureLoudness(rms: number) {
    const floor = 1e-7
    return 20 * Math.log10(Math.max(floor, rms))
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
      const tracker = this.loudnessTrackers.get(id)
      if (tracker) {
        window.clearInterval(tracker)
        this.loudnessTrackers.delete(id)
      }
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
      instance.timeouts?.forEach((id) => window.clearTimeout(id))
      instance.voiceInput.disconnect()
      instance.gainNode.disconnect()
      this.active.delete(id)
    }, (fadeOut + 0.04) * 1000)
  }

  stopAll(withChirp = false) {
    for (const id of this.active.keys()) this.stop(id, 0.03)
    if (withChirp) this.playStopChirp()
  }

  // Debug: coupe toute source active, conserve uniquement AudioContext -> destination.
  debugAbsoluteSilence() {
    for (const id of [...this.active.keys()]) {
      this.stop(id, 0.005)
    }
    this.logDebug('[debug] absolute silence requested')
  }

  // Debug: mesure RMS master et remonte les sources potentiellement parasites.
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
      const samples = new Float32Array(this.analyser.fftSize)
      this.analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (let i = 0; i < samples.length; i += 1) {
        sum += samples[i] * samples[i]
      }
      rms = Math.sqrt(sum / samples.length)
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
    // Inertial but punchier response.
    instance.holdOffset.offset.setTargetAtTime(targetOffset, now, instance.qHoldActive ? 0.55 : 2.3)

    instance.debug.frequencyHz = (instance.qBaseFreq ?? 400) + targetOffset
    instance.debug.holdActive = instance.qHoldActive
    this.logDebug(`[q-siren] id=${id} hold=${instance.qHoldActive} offset=${targetOffset.toFixed(1)}`)
  }

  private buildSynth(instance: SoundInstance) {
    switch (instance.preset.kind) {
      case 'qsiren':
        this.createQSiren(instance)
        break
      case 'threeTone':
        this.createThreeToneFr(instance)
        break
      case 'wail':
        this.createWailUnified(instance, {})
        break
      case 'yelp':
        this.createYelpUnified(instance, {})
        break
      case 'phaser':
        this.createPhaserLfoSiren(instance)
        break
      case 'hilo':
        this.createSwitchedTone(instance, [600, 1000], 500, 'hilo')
        break
      case 'twoToneA':
        if (instance.id.includes('eu-police')) {
          this.createPoliceFrTwoTone(instance, [435, 580], 580, 'twoToneA-police-fr')
          break
        }
        if (instance.id.includes('eu-fire')) {
          this.createTwoToneFr(instance, [435, 488], 1200)
          break
        }
        this.createTwoToneFr(instance, [700, 900], 700)
        break
      case 'twoToneM':
        if (instance.id.includes('eu-police')) {
          this.createPoliceFrTwoTone(instance, [435, 580], 520, 'twoToneM-police-fr')
          break
        }
        if (instance.id.includes('eu-fire')) {
          this.createTwoToneFr(instance, [435, 488], 950)
          break
        }
        this.createTwoToneFr(instance, [700, 900], 700)
        break
      case 'twoTone':
        this.createTwoToneFr(instance, [420, 516], 560)
        break
      case 'twoToneUmh':
        this.createTwoToneFr(instance, [435, 651], 560)
        break
      case 'horn':
      default:
        this.createHorn(instance)
    }
  }

  private connectOscWithTimbre(instance: SoundInstance, osc: OscillatorNode, lowpassHz: number, driveAmount: number) {
    if (!this.context) return
    const shaper = this.context.createWaveShaper()
    const isEurope = instance.id.startsWith('eu-')
    const drive = isEurope ? driveAmount * 1.25 : driveAmount
    const cutoff = isEurope ? lowpassHz * 0.78 : lowpassHz
    shaper.curve = this.makeDistortionCurve(drive)
    shaper.oversample = '2x'
    const lowpass = this.context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = cutoff
    lowpass.Q.value = isEurope ? 1.1 : 0.8
    osc.connect(shaper)
    shaper.connect(lowpass)
    lowpass.connect(instance.voiceInput)
    instance.modulationNodes.push(shaper, lowpass)
  }

  /**
   * WAIL/YELP : source → preGain → tanh → low-pass → voiceInput (master inchangé).
   * `tanhDrive` / `preGain` permettent d’adoucir le WAIL (moins « digital »).
   */
  private connectUnifiedSirenSourceToVoiceInput(
    instance: SoundInstance,
    source: AudioNode,
    opts?: { preGain?: number; tanhDrive?: number },
  ) {
    if (!this.context) return
    const preGain = this.context.createGain()
    preGain.gain.value = opts?.preGain ?? 1.4
    const tanhShaper = this.context.createWaveShaper()
    tanhShaper.curve = this.makeSirenLocalTanhCurve(opts?.tanhDrive ?? 2.55)
    tanhShaper.oversample = '4x'
    const toneLp = this.context.createBiquadFilter()
    toneLp.type = 'lowpass'
    toneLp.frequency.value = 3500
    toneLp.Q.value = 0.85
    source.connect(preGain)
    preGain.connect(tanhShaper)
    tanhShaper.connect(toneLp)
    toneLp.connect(instance.voiceInput)
    instance.modulationNodes.push(preGain, tanhShaper, toneLp)
  }

  private createQSiren(instance: SoundInstance) {
    if (!this.context) return
    const osc = this.context.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = 300
    this.connectOscWithTimbre(instance, osc, 2800, 16)
    osc.start()

    const baseTone = this.context.createConstantSource()
    baseTone.offset.value = 200
    baseTone.connect(osc.frequency)
    baseTone.start()

    const holdOffset = this.context.createConstantSource()
    holdOffset.offset.value = 0
    holdOffset.connect(osc.frequency)
    holdOffset.start()

    instance.mainOsc = osc
    instance.oscillators.push(osc)
    instance.baseTone = baseTone
    instance.holdOffset = holdOffset
    instance.modulationNodes.push(baseTone, holdOffset)
    instance.qBaseFreq = 400
    instance.qMaxFreq = 1200
    instance.qHoldActive = false
    instance.debug.frequencyHz = 300
    instance.debug.modulation = 'q-siren-continuous-decay-plus-hold-offset'

    this.attachAnalogDrift(instance, osc, 0.05, 3)
    this.attachGainWobble(instance, instance.gainNode.gain, 0.1, 0.02)
    this.attachNoiseLayer(instance, 0.008)
    // Continuous one-way decay: starts around 300 Hz, asymptotically goes to ~200 Hz.
    const now = this.context.currentTime
    osc.frequency.setValueAtTime(300, now)
    osc.frequency.setTargetAtTime(200, now, 3.5)
  }

  private createThreeToneFr(instance: SoundInstance) {
    if (!this.context) return
    instance.debug.modulation = 'three-tone-fr-persistent-voice'
    const voice = this.createFrTwoToneVoice(instance, 700, undefined, {
      withDrift: !this.frDebugIsolation,
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
    const start = this.context.currentTime + 0.01
    for (let i = 0; i < horizonCycles; i += 1) {
      const cycleStart = start + i * cycleSec
      const t2 = cycleStart + noteMs / 1000
      const t3 = cycleStart + (noteMs * 2) / 1000
      const t4 = cycleStart + (noteMs * 3) / 1000
      // Hard reset of gain automation timeline at each cycle start.
      gate.gain.cancelScheduledValues(cycleStart)
      gate.gain.setValueAtTime(0, cycleStart)
      const f1 = this.clampFrequencyHz(420 + this.nextJitter(instance, 1))
      const f2 = this.clampFrequencyHz(516 + this.nextJitter(instance, 1))
      const f3 = this.clampFrequencyHz(420 + this.nextJitter(instance, 1))
      oscA.frequency.setValueAtTime(f1, cycleStart)
      oscA.frequency.setValueAtTime(f2, t2)
      oscA.frequency.setValueAtTime(f3, t3)
      oscA.frequency.setValueAtTime(f3, t4)

      // Keep continuous signal across the 3 notes; only light anti-click shaping.
      gate.gain.setValueAtTime(0, cycleStart)
      gate.gain.linearRampToValueAtTime(1, cycleStart + attack)
      gate.gain.setValueAtTime(1, t4)
      gate.gain.linearRampToValueAtTime(0, t4 + endFade)

      const cycleEnd = cycleStart + cycleSec
      gate.gain.setValueAtTime(0, cycleEnd)
      if (i < 8 || i % 20 === 0) {
        this.logDebug(
          `[three-tone] cycle=${i} f=[${f1.toFixed(1)},${f2.toFixed(1)},${f3.toFixed(1)}] fade=${endFade.toFixed(3)}s pause=${(
            cycleEnd - t4
          ).toFixed(3)}s`,
        )
      }
    }
    instance.debug.frequencyHz = 700
  }

  private createTwoToneFr(instance: SoundInstance, freqs: number[], everyMs: number) {
    const voice = this.createFrTwoToneVoice(instance, freqs[0] ?? 700, undefined, {
      withDrift: !this.frDebugIsolation,
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

    const start = this.context!.currentTime + 0.01
    const step = everyMs / 1000
    const horizonSteps = 600
    for (let i = 0; i < horizonSteps; i += 1) {
      const idx = i % freqs.length
      const f = this.clampFrequencyHz((freqs[idx] ?? freqs[0] ?? 700) + this.nextJitter(instance, 1))
      oscA.frequency.setValueAtTime(f, start + i * step)
      if (i < 8) this.logDebug(`[two-tone] step=${i} f=${f.toFixed(2)}Hz t=${(i * step).toFixed(3)}s`)
    }
    instance.debug.frequencyHz = freqs[0] ?? 700
  }

  /** Même chaîne que `createTwoToneFr` (timbre FR + gate + comp + EQ), fréquences / pas police. */
  private createPoliceFrTwoTone(
    instance: SoundInstance,
    freqs: number[],
    everyMs: number,
    modulation: string,
  ) {
    const voice = this.createFrTwoToneVoice(instance, freqs[0] ?? 800, undefined, {
      withDrift: !this.frDebugIsolation,
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

    const start = this.context!.currentTime + 0.01
    const step = everyMs / 1000
    const horizonSteps = 600
    for (let i = 0; i < horizonSteps; i += 1) {
      const idx = i % freqs.length
      const f = this.clampFrequencyHz((freqs[idx] ?? freqs[0] ?? 800) + this.nextJitter(instance, 1))
      oscA.frequency.setValueAtTime(f, start + i * step)
      if (i < 8) this.logDebug(`[two-tone-police] step=${i} f=${f.toFixed(2)}Hz t=${(i * step).toFixed(3)}s`)
    }
    instance.debug.frequencyHz = freqs[0] ?? 800
  }

  private createFrTwoToneVoice(
    instance: SoundInstance,
    initialFreq: number,
    startAt?: number,
    options?: FrVoiceOptions,
  ) {
    if (!this.context) return null
    const withDrift = options?.withDrift ?? true
    const withWobble = options?.withWobble ?? true
    const withNoise = options?.withNoise ?? true
    const noiseGain = options?.noiseGain ?? 0.01
    const withEq = options?.withEq ?? true
    const withGateCompressor = options?.withGateCompressor ?? true
    const oscA = this.context.createOscillator()
    oscA.type = 'sawtooth'
    oscA.frequency.value = this.clampFrequencyHz(initialFreq)
    oscA.detune.value = -3
    this.connectFrOscWithTimbre(instance, oscA, 2200, 7)
    // FR tones need stronger pre-drive into unified master chain.
    instance.voiceInput.gain.value = 1.41
    const gate = this.context.createGain()
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
      const frCompressor = this.context.createDynamicsCompressor()
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
      const bp1 = this.context.createBiquadFilter()
      bp1.type = 'peaking'
      bp1.frequency.value = 1200
      bp1.Q.value = 1.1
      bp1.gain.value = 3.5
      const bp2 = this.context.createBiquadFilter()
      bp2.type = 'peaking'
      bp2.frequency.value = 1800
      bp2.Q.value = 1.2
      bp2.gain.value = 3.8
      const lowShelf = this.context.createBiquadFilter()
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
    oscA.start(startAt ?? this.context.currentTime)
    instance.oscillators.push(oscA)
    if (withDrift) this.attachAnalogDrift(instance, oscA, 0.05, 1.5)
    if (withWobble) this.attachGainWobble(instance, instance.gainNode.gain, 0.75, 0.028)
    if (withNoise) this.attachNoiseLayer(instance, noiseGain)
    return { oscA, gate }
  }

  async debugFrSilenceTest() {
    this.debugAbsoluteSilence()
    await new Promise((resolve) => window.setTimeout(resolve, 120))
    return this.debugSilenceDiagnostics()
  }

  private connectFrOscWithTimbre(
    instance: SoundInstance,
    osc: OscillatorNode,
    lowpassHz: number,
    driveAmount: number,
  ) {
    this.connectFrSourceWithTimbre(instance, osc, lowpassHz, driveAmount)
  }

  private connectFrSourceWithTimbre(
    instance: SoundInstance,
    source: AudioNode,
    lowpassHz: number,
    driveAmount: number,
  ) {
    if (!this.context) return
    const highpass = this.context.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 190
    highpass.Q.value = 0.7

    const shaper = this.context.createWaveShaper()
    shaper.curve = this.makeDistortionCurve(driveAmount)
    shaper.oversample = '2x'

    const dcHighpass = this.context.createBiquadFilter()
    dcHighpass.type = 'highpass'
    dcHighpass.frequency.value = 220
    dcHighpass.Q.value = 0.7

    const lowpass = this.context.createBiquadFilter()
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

  private createSwitchedTone(instance: SoundInstance, freqs: number[], everyMs: number, modulation: string) {
    if (!this.context) return
    const osc = this.context.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freqs[0] ?? 600
    this.connectOscWithTimbre(instance, osc, 3200, 8)
    osc.start()
    instance.mainOsc = osc
    instance.oscillators.push(osc)
    instance.debug.frequencyHz = freqs[0] ?? 600
    instance.debug.modulation = modulation
    this.attachAnalogDrift(instance, osc, 0.05, 3)
    this.attachGainWobble(instance, instance.gainNode.gain, 0.1, 0.02)
    this.attachNoiseLayer(instance, 0.007)

    let idx = 0
    instance.timer = window.setInterval(() => {
      idx = (idx + 1) % freqs.length
      const next = (freqs[idx] ?? freqs[0] ?? 600) + this.nextJitter(instance, 5)
      const now = this.context!.currentTime
      osc.frequency.cancelScheduledValues(now)
      osc.frequency.setValueAtTime(next, now)
      instance.debug.frequencyHz = next
    }, everyMs)
  }

  private createWailUnified(instance: SoundInstance, _options?: WailYelpUnifiedOptions) {
    if (!this.context) return
    console.log('[WAIL] unified version used')
    const saw = this.context.createOscillator()
    saw.type = 'sawtooth'
    saw.frequency.value = 500
    const sine = this.context.createOscillator()
    sine.type = 'sine'
    sine.frequency.value = 500

    const gSaw = this.context.createGain()
    gSaw.gain.value = 0.78
    const gSine = this.context.createGain()
    gSine.gain.value = 0.22
    const merge = this.context.createGain()
    merge.gain.value = 1
    saw.connect(gSaw)
    sine.connect(gSine)
    gSaw.connect(merge)
    gSine.connect(merge)

    const microLfo = this.context.createOscillator()
    microLfo.type = 'sine'
    microLfo.frequency.value = 0.28
    const microGain = this.context.createGain()
    microGain.gain.value = 3.5
    microLfo.connect(microGain)
    microGain.connect(saw.frequency)
    microGain.connect(sine.frequency)
    microLfo.start()

    this.connectUnifiedSirenSourceToVoiceInput(instance, merge, { preGain: 1.32, tanhDrive: 2.08 })
    saw.start()
    sine.start()

    instance.mainOsc = saw
    instance.oscillators.push(saw, sine)
    instance.lfoNodes.push(microLfo)
    instance.modulationNodes.push(gSaw, gSine, merge, microGain)
    instance.debug.frequencyHz = 500
    instance.debug.modulation = 'wail-saw-sine-organic'
    this.attachGainWobble(instance, instance.gainNode.gain, 0.1, 0.02)
    this.attachNoiseLayer(instance, 0.009)
    this.applyWailYelpVoicing(instance)
    this.applyAsymmetricWailAutomation(instance, [saw, sine])
  }

  private createYelpUnified(instance: SoundInstance, _options?: WailYelpUnifiedOptions) {
    if (!this.context) return
    console.log('[YELP] unified version used')
    const carrier = this.context.createOscillator()
    carrier.type = 'sawtooth'
    carrier.frequency.value = 900
    this.connectUnifiedSirenSourceToVoiceInput(instance, carrier)
    carrier.start()

    instance.mainOsc = carrier
    instance.oscillators.push(carrier)
    instance.debug.frequencyHz = 900
    this.attachAnalogDrift(instance, carrier, 0.06, 3.5)
    this.attachGainWobble(instance, instance.gainNode.gain, 0.12, 0.022)
    this.attachNoiseLayer(instance, 0.009)
    this.applyWailYelpVoicing(instance)
    this.applyContinuousYelpAutomation(instance, carrier)
  }

  private createPhaserLfoSiren(instance: SoundInstance) {
    if (!this.context) return
    const baseHz = 860
    const lfoHz = 14
    const depth = 220
    const carrier = this.context.createOscillator()
    carrier.type = 'square'
    carrier.frequency.value = baseHz
    const lfo = this.context.createOscillator()
    lfo.type = 'triangle'
    lfo.frequency.value = lfoHz
    const lfoGain = this.context.createGain()
    lfoGain.gain.value = depth
    const lfoShaper = this.context.createWaveShaper()
    lfoShaper.curve = this.makeWailBiasCurve()
    lfo.connect(lfoShaper)
    lfoShaper.connect(lfoGain)
    lfoGain.connect(carrier.frequency)
    this.connectOscWithTimbre(instance, carrier, 3600, 10)
    carrier.start()
    lfo.start()

    instance.mainOsc = carrier
    instance.oscillators.push(carrier)
    instance.lfoNodes.push(lfo)
    instance.modulationNodes.push(lfoGain, lfoShaper)
    instance.debug.frequencyHz = baseHz
    instance.debug.modulation = 'phaser-lfo'
    this.attachAnalogDrift(instance, carrier, 0.05, 3)
    this.attachGainWobble(instance, instance.gainNode.gain, 0.1, 0.02)
    this.attachNoiseLayer(instance, 0.007)
  }

  private applyWailYelpVoicing(instance: SoundInstance) {
    if (!this.context) return
    try {
      instance.voiceInput.disconnect()
    } catch {
      // no-op
    }
    const presence = this.context.createBiquadFilter()
    presence.type = 'peaking'
    presence.frequency.value = 2000
    presence.Q.value = 0.95
    presence.gain.value = 5
    const highShelf = this.context.createBiquadFilter()
    highShelf.type = 'highshelf'
    highShelf.frequency.value = 4200
    highShelf.Q.value = 0.7
    highShelf.gain.value = 8.5
    const sirenCompressor = this.context.createDynamicsCompressor()
    sirenCompressor.threshold.value = -22
    sirenCompressor.knee.value = 10
    sirenCompressor.ratio.value = 6.5
    sirenCompressor.attack.value = 0.002
    sirenCompressor.release.value = 0.055
    const finalBoost = this.context.createGain()
    finalBoost.gain.value = 1.55
    instance.voiceInput.connect(presence)
    presence.connect(highShelf)
    highShelf.connect(sirenCompressor)
    sirenCompressor.connect(finalBoost)
    finalBoost.connect(instance.gainNode)
    instance.modulationNodes.push(presence, highShelf, sirenCompressor, finalBoost)
  }

  private applyAsymmetricWailAutomation(instance: SoundInstance, carriers: OscillatorNode[]) {
    if (!this.context) return
    const minHz = 500
    const maxHz = 1500
    const baseCycleSec = 4
    const horizonCycles = 90
    const start = this.context.currentTime + 0.01
    for (const c of carriers) {
      c.frequency.cancelScheduledValues(start)
      c.frequency.setValueAtTime(minHz, start)
    }
    let cycleStart = start
    for (let i = 0; i < horizonCycles; i += 1) {
      const cycleSec = baseCycleSec * (1 + this.nextJitter(instance, 3) * 0.009)
      const riseSec = cycleSec * 0.72
      const peakAt = cycleStart + riseSec
      const endAt = cycleStart + cycleSec
      for (const c of carriers) {
        c.frequency.setValueAtTime(minHz, cycleStart)
        c.frequency.exponentialRampToValueAtTime(maxHz, peakAt)
        c.frequency.exponentialRampToValueAtTime(minHz, endAt)
      }
      cycleStart = endAt
    }
    instance.debug.modulation = 'wail-asymmetric-exp-jitter'
  }

  /** Yelp : rampe continue 900↔1600 Hz, cycle court, sans LFO binaire. */
  private applyContinuousYelpAutomation(instance: SoundInstance, carrier: OscillatorNode) {
    if (!this.context) return
    const minHz = 900
    const maxHz = 1600
    const baseCycleSec = 0.25
    const horizonCycles = 720
    const start = this.context.currentTime + 0.02
    carrier.frequency.cancelScheduledValues(start)
    carrier.frequency.setValueAtTime(minHz, start)
    let t = start
    for (let i = 0; i < horizonCycles; i += 1) {
      const cycleSec = baseCycleSec * (1 + this.nextJitter(instance, 3) * 0.012)
      const riseSec = cycleSec * 0.4
      const tPeak = t + riseSec
      const tEnd = t + cycleSec
      carrier.frequency.setValueAtTime(minHz, t)
      carrier.frequency.exponentialRampToValueAtTime(maxHz, tPeak)
      carrier.frequency.exponentialRampToValueAtTime(minHz, tEnd)
      t = tEnd
    }
    instance.debug.modulation = 'yelp-continuous-exp'
  }

  private makeWailBiasCurve() {
    const n = 1024
    const curve = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      const x = (i / (n - 1)) * 2 - 1
      curve[i] = x < 0 ? x * 0.4 : x
    }
    return curve
  }

  private createHorn(instance: SoundInstance) {
    if (!this.context) return
    const isUsFire = instance.id.includes('amer-fire')
    const isUsPolice = instance.id.includes('amer-police')
    const isEurope = instance.id.startsWith('eu-')
    const freqs = isUsFire ? [180, 220, 260] : isUsPolice ? [520, 610, 690] : isEurope ? [420, 428] : [320, 360]
    const drive = isUsFire ? 28 : isUsPolice ? 14 : 10
    const lowpass = isUsFire ? 2300 : isUsPolice ? 3000 : 2600

    for (let i = 0; i < freqs.length; i += 1) {
      const osc = this.context.createOscillator()
      osc.type = 'square'
      osc.frequency.value = freqs[i] ?? 420
      osc.detune.value = i === 0 ? -4 : i === 1 ? 2 : 5
      this.connectOscWithTimbre(instance, osc, lowpass, drive)
      osc.start()
      instance.oscillators.push(osc)
      this.attachAnalogDrift(instance, osc, 0.05, 3)
    }

    const now = this.context.currentTime
    instance.gainNode.gain.cancelScheduledValues(now)
    instance.gainNode.gain.setValueAtTime(0, now)
    instance.gainNode.gain.linearRampToValueAtTime(0.55, now + 0.012)
    instance.gainNode.gain.setTargetAtTime(0.5, now + 0.02, 0.05)

    instance.mainOsc = instance.oscillators[0]
    instance.debug.frequencyHz = freqs[0] ?? 420
    instance.debug.modulation = isUsFire ? 'us-fire-air-horn' : isUsPolice ? 'us-police-horn' : 'eu-horn'
    this.attachGainWobble(instance, instance.gainNode.gain, 0.1, 0.018)
    this.attachNoiseLayer(instance, isUsFire ? 0.012 : 0.006)
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

  private attachAnalogDrift(instance: SoundInstance, osc: OscillatorNode, lfoHz: number, depthHz: number) {
    if (!this.context) return
    const drift = this.context.createOscillator()
    const driftGain = this.context.createGain()
    drift.type = 'sine'
    drift.frequency.value = lfoHz
    driftGain.gain.value = depthHz
    drift.connect(driftGain)
    driftGain.connect(osc.frequency)
    drift.start()
    instance.lfoNodes.push(drift)
    instance.modulationNodes.push(driftGain)
  }

  private attachGainWobble(instance: SoundInstance, param: AudioParam, lfoHz: number, depth: number) {
    if (!this.context) return
    const wobble = this.context.createOscillator()
    const wobbleGain = this.context.createGain()
    wobble.type = 'sine'
    wobble.frequency.value = lfoHz
    wobbleGain.gain.value = depth
    wobble.connect(wobbleGain)
    wobbleGain.connect(param)
    wobble.start()
    instance.lfoNodes.push(wobble)
    instance.modulationNodes.push(wobbleGain)
  }

  private nextJitter(instance: SoundInstance, maxAbs: number) {
    const seq = [-5, -2, 3, 1, -1, 4, -3, 2, 0]
    const idx = instance.jitterIndex ?? 0
    instance.jitterIndex = (idx + 1) % seq.length
    const value = seq[idx] ?? 0
    return Math.max(-maxAbs, Math.min(maxAbs, value))
  }

  private clampFrequencyHz(hz: number) {
    return Math.max(150, Math.min(6000, hz))
  }

  private attachNoiseLayer(instance: SoundInstance, noiseGainValue: number) {
    if (!this.context || !this.noiseBuffer) return
    const clampedGain = Math.max(0, Math.min(0.05, noiseGainValue))
    const noise = this.context.createBufferSource()
    noise.buffer = this.noiseBuffer
    noise.loop = true
    const noiseHighpass = this.context.createBiquadFilter()
    noiseHighpass.type = 'highpass'
    noiseHighpass.frequency.value = 220
    noiseHighpass.Q.value = 0.707
    const noiseGain = this.context.createGain()
    noiseGain.gain.value = clampedGain
    noise.connect(noiseHighpass)
    noiseHighpass.connect(noiseGain)
    noiseGain.connect(instance.voiceInput)
    noise.start()
    instance.noiseSource = noise
    instance.modulationNodes.push(noiseHighpass, noiseGain)
  }

  private buildNoiseBuffer() {
    if (!this.context) return undefined
    const sampleRate = this.context.sampleRate
    const buffer = this.context.createBuffer(1, sampleRate, sampleRate)
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

  private getDbAtHz(bins: Float32Array, sampleRate: number, hz: number) {
    const nyquist = sampleRate / 2
    const hzPerBin = nyquist / bins.length
    const idx = Math.max(0, Math.min(bins.length - 1, Math.round(hz / hzPerBin)))
    return bins[idx] ?? -160
  }

  private makeDistortionCurve(amount: number) {
    const n = 44100
    const curve = new Float32Array(n)
    const drive = Math.max(1, amount)
    for (let i = 0; i < n; i += 1) {
      const x = (i * 2) / n - 1
      // Courbe strictement impaire: f(-x) = -f(x), sans offset DC.
      curve[i] = Math.tanh((drive / 12) * x)
    }
    return curve
  }

  /** Saturation locale WAIL/YELP : tanh impaire, sans offset DC. */
  private makeSirenLocalTanhCurve(drive = 2.55) {
    const n = 4096
    const curve = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      const x = (i / (n - 1)) * 2 - 1
      curve[i] = Math.tanh(drive * x)
    }
    return curve
  }

  private logDebug(message: string) {
    this.debugLog.push(`${new Date().toISOString()} ${message}`)
    if (this.debugLog.length > 100) this.debugLog.shift()
    console.debug(message)
  }

  private logDestinationRouting() {
    const routing = [
      'Audio route: source -> mixGain -> preEQ(HP180) -> preGain -> saturator -> compressor -> makeupGain -> masterGain -> presenceEQ -> highShelf -> DCBlocker -> limiter -> destination',
      'Analyzer (product): finalLimiter -> analyser (parallel, no destination)',
      'Analyzer (debug): masterGain -> analyserDebugPreFinalEq (parallel, no destination)',
      'Nodes connected to destination: finalLimiter only',
    ]
    routing.forEach((line) => this.logDebug(`[routing] ${line}`))
  }
}

export const audioEngine = new AudioEngine()
