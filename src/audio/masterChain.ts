import { makeDistortionCurve } from './utils/distortion'

/** EQ master : cible « une voix » (présence / air). */
export const MASTER_EQ_PRESENCE_GAIN_SINGLE = 5.2
export const MASTER_EQ_HIGHSHELF_GAIN_SINGLE = 7.2
/** EQ master : plusieurs sirènes — moins de boost dans les mêmes bandes (réduit le masquage). */
export const MASTER_EQ_PRESENCE_GAIN_MULTI = 2.5
export const MASTER_EQ_HIGHSHELF_GAIN_MULTI = 3.5

export type MasterChain = {
  mixGain: GainNode
  saturatorInputGain: GainNode
  saturator: WaveShaperNode
  compressor: DynamicsCompressorNode
  finalLimiter: DynamicsCompressorNode
  masterMakeupGain: GainNode
  masterGain: GainNode
  analyser: AnalyserNode
  analyserDebugPreFinalEq: AnalyserNode
  masterEqHighpass180: BiquadFilterNode
  masterEqPresence: BiquadFilterNode
  masterEqHighShelf: BiquadFilterNode
  dcBlocker: BiquadFilterNode
}

/**
 * Construit la chaîne master (saturation, compresseur, EQ, limiteur, analyseurs).
 * Branche `mixGain` → … → `masterOutput` (ex. `MediaStreamDestination` ou `destination`) ;
 * tap viz sur `finalLimiter` → `analyser`.
 */
export function createMasterChain(ctx: AudioContext, masterOutput: AudioNode): MasterChain {
  const mixGain = ctx.createGain()
  mixGain.gain.value = 1
  const saturatorInputGain = ctx.createGain()
  saturatorInputGain.gain.value = 1.1
  const saturator = ctx.createWaveShaper()
  saturator.curve = new Float32Array(makeDistortionCurve(6))
  saturator.oversample = '4x'
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -10
  compressor.knee.value = 14
  compressor.ratio.value = 3
  compressor.attack.value = 0.003
  compressor.release.value = 0.06
  const masterMakeupGain = ctx.createGain()
  masterMakeupGain.gain.value = 1.41
  const masterGain = ctx.createGain()
  masterGain.gain.value = 0.92
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 128
  const analyserDebugPreFinalEq = ctx.createAnalyser()
  analyserDebugPreFinalEq.fftSize = 128
  const masterEqHighpass180 = ctx.createBiquadFilter()
  masterEqHighpass180.type = 'highpass'
  masterEqHighpass180.frequency.value = 180
  masterEqHighpass180.Q.value = 0.7
  const masterEqPresence = ctx.createBiquadFilter()
  masterEqPresence.type = 'peaking'
  masterEqPresence.frequency.value = 1900
  masterEqPresence.Q.value = 0.9
  masterEqPresence.gain.value = MASTER_EQ_PRESENCE_GAIN_SINGLE
  const masterEqHighShelf = ctx.createBiquadFilter()
  masterEqHighShelf.type = 'highshelf'
  masterEqHighShelf.frequency.value = 3600
  masterEqHighShelf.gain.value = MASTER_EQ_HIGHSHELF_GAIN_SINGLE
  const dcBlocker = ctx.createBiquadFilter()
  dcBlocker.type = 'highpass'
  dcBlocker.frequency.value = 20
  dcBlocker.Q.value = 0.7
  const finalLimiter = ctx.createDynamicsCompressor()
  finalLimiter.threshold.value = -1
  finalLimiter.knee.value = 0
  finalLimiter.ratio.value = 20
  finalLimiter.attack.value = 0.001
  finalLimiter.release.value = 0.05

  mixGain.connect(masterEqHighpass180)
  masterEqHighpass180.connect(saturatorInputGain)
  saturatorInputGain.connect(saturator)
  saturator.connect(compressor)
  compressor.connect(masterMakeupGain)
  masterMakeupGain.connect(masterGain)
  masterGain.connect(masterEqPresence)
  masterGain.connect(analyserDebugPreFinalEq)
  masterEqPresence.connect(masterEqHighShelf)
  masterEqHighShelf.connect(dcBlocker)
  dcBlocker.connect(finalLimiter)
  finalLimiter.connect(masterOutput)
  finalLimiter.connect(analyser)

  return {
    mixGain,
    saturatorInputGain,
    saturator,
    compressor,
    finalLimiter,
    masterMakeupGain,
    masterGain,
    analyser,
    analyserDebugPreFinalEq,
    masterEqHighpass180,
    masterEqPresence,
    masterEqHighShelf,
    dcBlocker,
  }
}
