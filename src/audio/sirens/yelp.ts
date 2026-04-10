import type { SirenBuildContext, SoundInstance, WailYelpUnifiedOptions } from '../types'
import { attachAnalogDrift, attachGainWobble, attachNoiseLayer } from '../utils/audioUtils'
import { applyContinuousYelpAutomation } from '../utils/envelopes'
import { connectUnifiedSirenSourceToVoiceInput } from '../routing'

export function createYelpUnified(
  ctx: SirenBuildContext,
  instance: SoundInstance,
  _options?: WailYelpUnifiedOptions,
): void {
  const { audioContext: ac } = ctx
  const carrier = ac.createOscillator()
  carrier.type = 'sawtooth'
  carrier.frequency.value = 900
  connectUnifiedSirenSourceToVoiceInput(ac, instance, carrier)
  carrier.start()

  instance.mainOsc = carrier
  instance.oscillators.push(carrier)
  instance.debug.frequencyHz = 900
  attachAnalogDrift(ac, instance, carrier, 0.06, 3.5)
  attachGainWobble(ac, instance, instance.gainNode.gain, 0.12, 0.022)
  attachNoiseLayer(ac, instance, ctx.noiseBuffer, 0.009)
  applyContinuousYelpAutomation(ac, instance, carrier)
}
