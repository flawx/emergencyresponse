import type { SirenBuildContext, SoundInstance, WailYelpUnifiedOptions } from '../types'
import { attachGainWobble, attachNoiseLayer } from '../utils/audioUtils'
import { applyAsymmetricWailAutomation } from '../utils/envelopes'
import { connectUnifiedSirenSourceToVoiceInput } from '../routing'

export function createWailUnified(
  ctx: SirenBuildContext,
  instance: SoundInstance,
  _options?: WailYelpUnifiedOptions,
): void {
  const { audioContext: ac } = ctx
  const saw = ac.createOscillator()
  saw.type = 'sawtooth'
  saw.frequency.value = 500
  const sine = ac.createOscillator()
  sine.type = 'sine'
  sine.frequency.value = 500

  const gSaw = ac.createGain()
  gSaw.gain.value = 0.78
  const gSine = ac.createGain()
  gSine.gain.value = 0.22
  const merge = ac.createGain()
  merge.gain.value = 1
  saw.connect(gSaw)
  sine.connect(gSine)
  gSaw.connect(merge)
  gSine.connect(merge)

  const microLfo = ac.createOscillator()
  microLfo.type = 'sine'
  microLfo.frequency.value = 0.28
  const microGain = ac.createGain()
  microGain.gain.value = 3.5
  microLfo.connect(microGain)
  microGain.connect(saw.frequency)
  microGain.connect(sine.frequency)
  microLfo.start()

  connectUnifiedSirenSourceToVoiceInput(ac, instance, merge, { preGain: 1.32, tanhDrive: 2.08 })
  saw.start()
  sine.start()

  instance.mainOsc = saw
  instance.oscillators.push(saw, sine)
  instance.lfoNodes.push(microLfo)
  instance.modulationNodes.push(gSaw, gSine, merge, microGain)
  instance.debug.frequencyHz = 500
  instance.debug.modulation = 'wail-saw-sine-organic'
  attachGainWobble(ac, instance, instance.gainNode.gain, 0.1, 0.02)
  attachNoiseLayer(ac, instance, ctx.noiseBuffer, 0.009)
  applyAsymmetricWailAutomation(ac, instance, [saw, sine])
}
