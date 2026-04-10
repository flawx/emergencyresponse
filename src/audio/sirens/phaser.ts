import type { SirenBuildContext, SoundInstance } from '../types'
import { attachAnalogDrift, attachGainWobble, attachNoiseLayer } from '../utils/audioUtils'
import { makeWailBiasCurve } from '../utils/distortion'
import { connectOscWithTimbre } from '../routing'

export function createPhaser(ctx: SirenBuildContext, instance: SoundInstance): void {
  const { audioContext: ac } = ctx
  const baseHz = 860
  const lfoHz = 14
  const depth = 220
  const carrier = ac.createOscillator()
  carrier.type = 'square'
  carrier.frequency.value = baseHz
  const lfo = ac.createOscillator()
  lfo.type = 'triangle'
  lfo.frequency.value = lfoHz
  const lfoGain = ac.createGain()
  lfoGain.gain.value = depth
  const lfoShaper = ac.createWaveShaper()
  lfoShaper.curve = makeWailBiasCurve()
  lfo.connect(lfoShaper)
  lfoShaper.connect(lfoGain)
  lfoGain.connect(carrier.frequency)
  connectOscWithTimbre(ac, instance, carrier, 3600, 10)
  carrier.start()
  lfo.start()

  instance.mainOsc = carrier
  instance.oscillators.push(carrier)
  instance.lfoNodes.push(lfo)
  instance.modulationNodes.push(lfoGain, lfoShaper)
  instance.debug.frequencyHz = baseHz
  instance.debug.modulation = 'phaser-lfo'
  attachAnalogDrift(ac, instance, carrier, 0.05, 3)
  attachGainWobble(ac, instance, instance.gainNode.gain, 0.1, 0.02)
  attachNoiseLayer(ac, instance, ctx.noiseBuffer, 0.007)
}
