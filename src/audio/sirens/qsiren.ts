import type { SirenBuildContext, SoundInstance } from '../types'
import { attachAnalogDrift, attachGainWobble, attachNoiseLayer } from '../utils/audioUtils'
import { connectOscWithTimbre } from '../routing'

export function createQSiren(ctx: SirenBuildContext, instance: SoundInstance): void {
  const { audioContext: ac } = ctx
  const osc = ac.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = 300
  connectOscWithTimbre(ac, instance, osc, 2800, 16)
  osc.start()

  const baseTone = ac.createConstantSource()
  baseTone.offset.value = 200
  baseTone.connect(osc.frequency)
  baseTone.start()

  const holdOffset = ac.createConstantSource()
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

  attachAnalogDrift(ac, instance, osc, 0.05, 3)
  attachGainWobble(ac, instance, instance.gainNode.gain, 0.1, 0.02)
  attachNoiseLayer(ac, instance, ctx.noiseBuffer, 0.008)
  const now = ac.currentTime
  osc.frequency.setValueAtTime(300, now)
  osc.frequency.setTargetAtTime(200, now, 3.5)
}
