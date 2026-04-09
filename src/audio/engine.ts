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
  private mixGain?: GainNode
  private compressor?: DynamicsCompressorNode
  private saturator?: WaveShaperNode
  private analyser?: AnalyserNode
  private initialized = false
  private samples = new Map<string, AudioBuffer>()
  private active = new Map<string, SoundInstance>()
  private debugLog: string[] = []
  private noiseBuffer?: AudioBuffer

  async init() {
    if (this.initialized) return
    this.context = new AudioContext({ latencyHint: 'interactive' })
    this.mixGain = this.context.createGain()
    this.mixGain.gain.value = 1
    this.saturator = this.context.createWaveShaper()
    this.saturator.curve = this.makeDistortionCurve(18)
    this.saturator.oversample = '4x'
    this.compressor = this.context.createDynamicsCompressor()
    this.compressor.threshold.value = -24
    this.compressor.knee.value = 16
    this.compressor.ratio.value = 3.6
    this.compressor.attack.value = 0.006
    this.compressor.release.value = 0.16
    this.masterGain = this.context.createGain()
    this.masterGain.gain.value = 0.85
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 128

    this.mixGain.connect(this.saturator)
    this.saturator.connect(this.compressor)
    this.compressor.connect(this.masterGain)
    this.masterGain.connect(this.analyser)
    this.analyser.connect(this.context.destination)
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

  getDebugSnapshot() {
    const voices: Record<string, DebugVoice> = {}
    for (const [id, instance] of this.active.entries()) voices[id] = { ...instance.debug }
    return { voices, logs: this.debugLog.slice(-25) }
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
    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.linearRampToValueAtTime(preset.gain ?? 0.35, now + 0.02)
    this.active.set(id, instance)
    this.logDebug(`[play] ${id} kind=${preset.kind}`)
  }

  stop(id: string, fadeOut = 0.05) {
    if (!this.context) return
    const instance = this.active.get(id)
    if (!instance) return

    const now = this.context.currentTime
    instance.gainNode.gain.cancelScheduledValues(now)
    instance.gainNode.gain.setValueAtTime(instance.gainNode.gain.value, now)
    instance.gainNode.gain.linearRampToValueAtTime(0.0001, now + fadeOut)

    window.setTimeout(() => {
      instance.sampleSource?.stop()
      instance.noiseSource?.stop()
      instance.oscillators.forEach((osc) => osc.stop())
      instance.lfoNodes.forEach((lfo) => lfo.stop())
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
        this.createLfoSiren(instance, 1160, 0.2, 440, 'sine', 'sine', 'wail-lfo')
        break
      case 'yelp':
        this.createLfoSiren(instance, 1000, 3.5, 300, 'triangle', 'triangle', 'yelp-lfo')
        break
      case 'phaser':
        this.createLfoSiren(instance, 860, 14, 220, 'triangle', 'square', 'phaser-lfo')
        break
      case 'hilo':
        this.createSwitchedTone(instance, [600, 1000], 500, 'hilo')
        break
      case 'twoToneA':
        if (instance.id.includes('eu-police')) {
          this.createPoliceFrTwoTone(instance, [600, 800], 520, 'twoToneA-police-fr')
          break
        }
        this.createTwoToneFr(instance, [700, 900], 700)
        break
      case 'twoToneM':
        if (instance.id.includes('eu-police')) {
          this.createPoliceFrTwoTone(instance, [600, 800], 240, 'twoToneM-police-fr')
          break
        }
        this.createTwoToneFr(instance, [700, 900], 700)
        break
      case 'twoTone':
        this.createTwoToneFr(instance, [700, 960], 700)
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
    instance.debug.modulation = 'three-tone-fr-real-silence'
    instance.timeouts = []
    const noteMs = 180
    const cyclePauseMs = 1000
    const cycleMs = noteMs * 3 + cyclePauseMs

    const scheduleCycle = (atMs: number) => {
      const timeoutId = window.setTimeout(() => {
        if (!this.context || !this.active.has(instance.id)) return
        this.playFrTriplePulse(
          instance,
          700 + this.nextJitter(instance, 10),
          900 + this.nextJitter(instance, 10),
          700 + this.nextJitter(instance, 10),
          noteMs,
        )
        instance.debug.frequencyHz = 700
      }, atMs)
      instance.timeouts?.push(timeoutId)
    }

    scheduleCycle(0)
    instance.timer = window.setInterval(() => {
      if (!this.context || !this.active.has(instance.id)) return
      scheduleCycle(0)
    }, cycleMs)
  }

  private createTwoToneFr(instance: SoundInstance, freqs: number[], everyMs: number) {
    const voice = this.createFrTwoToneVoice(instance, freqs[0] ?? 700)
    if (!voice) return
    const { oscA, oscB, sub } = voice
    instance.mainOsc = oscA
    instance.debug.frequencyHz = freqs[0] ?? 700
    instance.debug.modulation = 'two-tone-fr'

    let idx = 0
    instance.timer = window.setInterval(() => {
      idx = (idx + 1) % freqs.length
      const f = (freqs[idx] ?? freqs[0] ?? 700) + this.nextJitter(instance, 5)
      const now = this.context!.currentTime
      oscA.frequency.setValueAtTime(f, now)
      oscB.frequency.setValueAtTime(f, now)
      sub.frequency.setValueAtTime(f / 2, now)
      instance.debug.frequencyHz = f
    }, everyMs)
  }

  private createPoliceFrTwoTone(
    instance: SoundInstance,
    freqs: number[],
    everyMs: number,
    modulation: string,
  ) {
    if (!this.context) return
    const oscA = this.context.createOscillator()
    const oscB = this.context.createOscillator()
    oscA.type = 'sawtooth'
    oscB.type = 'sawtooth'
    oscA.frequency.value = freqs[0] ?? 800
    oscB.frequency.value = freqs[0] ?? 800
    oscA.detune.value = -5
    oscB.detune.value = 5
    this.connectOscWithTimbre(instance, oscA, 1800, 24)
    this.connectOscWithTimbre(instance, oscB, 1800, 24)
    oscA.start()
    oscB.start()
    instance.mainOsc = oscA
    instance.oscillators.push(oscA, oscB)
    instance.debug.frequencyHz = freqs[0] ?? 800
    instance.debug.modulation = modulation
    this.attachAnalogDrift(instance, oscA, 0.05, 3)
    this.attachAnalogDrift(instance, oscB, 0.05, 3)
    this.attachGainWobble(instance, instance.gainNode.gain, 0.8, 0.02)
    this.attachNoiseLayer(instance, 0.012)
    const policeCompressor = this.context.createDynamicsCompressor()
    policeCompressor.threshold.value = -30
    policeCompressor.knee.value = 12
    policeCompressor.ratio.value = 5.5
    policeCompressor.attack.value = 0.005
    policeCompressor.release.value = 0.14
    try {
      instance.voiceInput.disconnect()
    } catch {
      // no-op
    }
    instance.voiceInput.connect(policeCompressor)
    policeCompressor.connect(instance.gainNode)
    instance.modulationNodes.push(policeCompressor)

    let idx = 0
    instance.timer = window.setInterval(() => {
      idx = (idx + 1) % freqs.length
      const f = (freqs[idx] ?? freqs[0] ?? 800) + this.nextJitter(instance, 5)
      const now = this.context!.currentTime
      oscA.frequency.setValueAtTime(f, now)
      oscB.frequency.setValueAtTime(f, now)
      instance.debug.frequencyHz = f
    }, everyMs)
  }

  private createFrTwoToneVoice(instance: SoundInstance, initialFreq: number) {
    if (!this.context) return null
    const oscA = this.context.createOscillator()
    const oscB = this.context.createOscillator()
    oscA.type = 'sine'
    oscB.type = 'sine'
    oscA.frequency.value = initialFreq
    oscB.frequency.value = initialFreq
    oscA.detune.value = -12
    oscB.detune.value = 12
    const sub = this.context.createOscillator()
    sub.type = 'triangle'
    sub.frequency.value = initialFreq / 2
    const gate = this.context.createGain()
    gate.gain.value = 1
    this.connectOscWithTimbre(instance, oscA, 2500, 16)
    this.connectOscWithTimbre(instance, oscB, 2500, 16)
    this.connectOscWithTimbre(instance, sub, 2200, 10)
    try {
      instance.voiceInput.disconnect()
    } catch {
      // no-op
    }
    instance.voiceInput.connect(gate)
    gate.connect(instance.gainNode)
    oscA.start()
    oscB.start()
    sub.start()
    instance.oscillators.push(oscA, oscB, sub)
    instance.modulationNodes.push(gate)
    this.attachAnalogDrift(instance, oscA, 0.05, 3)
    this.attachAnalogDrift(instance, oscB, 0.05, 3)
    this.attachAnalogDrift(instance, sub, 0.05, 2.5)
    this.attachGainWobble(instance, instance.gainNode.gain, 0.75, 0.028)
    this.attachNoiseLayer(instance, 0.01)
    this.applyTwoToneFrEq(instance)
    return { oscA, oscB, sub, gate }
  }

  private playFrTriplePulse(
    instance: SoundInstance,
    freq1: number,
    freq2: number,
    freq3: number,
    noteMs: number,
  ) {
    if (!this.context) return
    const oscA = this.context.createOscillator()
    const oscB = this.context.createOscillator()
    const sub = this.context.createOscillator()
    oscA.type = 'sine'
    oscB.type = 'sine'
    sub.type = 'triangle'
    oscA.frequency.value = freq1
    oscB.frequency.value = freq1
    sub.frequency.value = freq1 / 2
    oscA.detune.value = -12
    oscB.detune.value = 12
    const gate = this.context.createGain()
    gate.gain.value = 1
    this.connectOscWithTimbre(instance, oscA, 2500, 16)
    this.connectOscWithTimbre(instance, oscB, 2500, 16)
    this.connectOscWithTimbre(instance, sub, 2200, 10)
    try {
      instance.voiceInput.disconnect()
    } catch {
      // no-op
    }
    instance.voiceInput.connect(gate)
    gate.connect(instance.gainNode)
    const now = this.context.currentTime
    const t2 = now + noteMs / 1000
    const t3 = now + (noteMs * 2) / 1000
    oscA.frequency.setValueAtTime(freq1, now)
    oscB.frequency.setValueAtTime(freq1, now)
    sub.frequency.setValueAtTime(freq1 / 2, now)
    oscA.frequency.setValueAtTime(freq2, t2)
    oscB.frequency.setValueAtTime(freq2, t2)
    sub.frequency.setValueAtTime(freq2 / 2, t2)
    oscA.frequency.setValueAtTime(freq3, t3)
    oscB.frequency.setValueAtTime(freq3, t3)
    sub.frequency.setValueAtTime(freq3 / 2, t3)
    oscA.start()
    oscB.start()
    sub.start()
    const stopAt = now + (noteMs * 3) / 1000
    oscA.stop(stopAt)
    oscB.stop(stopAt)
    sub.stop(stopAt)
    instance.oscillators.push(oscA, oscB, sub)
    instance.modulationNodes.push(gate)
  }

  private applyTwoToneFrEq(instance: SoundInstance) {
    if (!this.context) return
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
    try {
      instance.voiceInput.disconnect()
    } catch {
      // no-op
    }
    instance.voiceInput.connect(bp1)
    bp1.connect(bp2)
    bp2.connect(lowShelf)
    lowShelf.connect(instance.gainNode)
    instance.modulationNodes.push(bp1, bp2, lowShelf)
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

  private createLfoSiren(
    instance: SoundInstance,
    baseHz: number,
    lfoHz: number,
    depth: number,
    lfoType: OscillatorType,
    carrierType: OscillatorType,
    modulationName: string,
  ) {
    if (!this.context) return
    const isWail = modulationName === 'wail-lfo'
    const carrier = this.context.createOscillator()
    carrier.type = carrierType
    carrier.frequency.value = baseHz
    const lfo = this.context.createOscillator()
    lfo.type = lfoType
    lfo.frequency.value = isWail ? 1 / 6 : lfoHz
    const lfoGain = this.context.createGain()
    lfoGain.gain.value = depth
    const lfoShaper = this.context.createWaveShaper()
    lfoShaper.curve = this.makeWailBiasCurve()
    lfo.connect(lfoShaper)
    lfoShaper.connect(lfoGain)
    lfoGain.connect(carrier.frequency)
    this.connectOscWithTimbre(instance, carrier, 3200, 10)
    if (isWail) {
      carrier.frequency.value = 720
    }
    carrier.start()
    lfo.start()

    instance.mainOsc = carrier
    instance.oscillators.push(carrier)
    instance.lfoNodes.push(lfo)
    instance.modulationNodes.push(lfoGain, lfoShaper)
    instance.debug.frequencyHz = isWail ? 720 : baseHz
    instance.debug.modulation = modulationName
    this.attachAnalogDrift(instance, carrier, 0.05, 3)
    this.attachGainWobble(instance, instance.gainNode.gain, 0.1, 0.02)
    this.attachNoiseLayer(instance, 0.007)
    if (modulationName === 'yelp-lfo' && this.compressor && this.saturator) {
      instance.gainNode.gain.value = 0.46
      this.compressor.threshold.value = -28
      this.compressor.ratio.value = 4.6
      this.saturator.curve = this.makeDistortionCurve(24)
    }
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
    instance.gainNode.gain.setValueAtTime(0.0001, now)
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

  private attachNoiseLayer(instance: SoundInstance, noiseGainValue: number) {
    if (!this.context || !this.noiseBuffer) return
    const noise = this.context.createBufferSource()
    noise.buffer = this.noiseBuffer
    noise.loop = true
    const noiseGain = this.context.createGain()
    noiseGain.gain.value = noiseGainValue
    noise.connect(noiseGain)
    noiseGain.connect(instance.voiceInput)
    noise.start()
    instance.noiseSource = noise
    instance.modulationNodes.push(noiseGain)
  }

  private buildNoiseBuffer() {
    if (!this.context) return undefined
    const sampleRate = this.context.sampleRate
    const buffer = this.context.createBuffer(1, sampleRate, sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) {
      const t = i / sampleRate
      data[i] =
        0.36 * Math.sin(2 * Math.PI * 173 * t) +
        0.22 * Math.sin(2 * Math.PI * 347 * t) +
        0.12 * Math.sin(2 * Math.PI * 911 * t)
    }
    return buffer
  }

  private makeDistortionCurve(amount: number) {
    const n = 44100
    const curve = new Float32Array(n)
    const k = amount
    const deg = Math.PI / 180
    for (let i = 0; i < n; i += 1) {
      const x = (i * 2) / n - 1
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x))
    }
    return curve
  }

  private logDebug(message: string) {
    this.debugLog.push(`${new Date().toISOString()} ${message}`)
    if (this.debugLog.length > 100) this.debugLog.shift()
    console.debug(message)
  }
}

export const audioEngine = new AudioEngine()
