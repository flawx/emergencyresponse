import type { RegionStyle, SoundKind, SoundVariant } from '../utils/sirenConfig'

export type SoundPreset = {
  kind: SoundKind
  gain?: number
  regionStyle?: RegionStyle
  variant?: SoundVariant
}

export type DebugVoice = {
  frequencyHz: number
  holdActive: boolean
  modulation: string
}

export type SilenceDiagnostics = {
  rms: number
  activeVoiceCount: number
  activeVoiceIds: string[]
  suspicious: string[]
}

export type FrVoiceOptions = {
  withDrift?: boolean
  withWobble?: boolean
  withNoise?: boolean
  noiseGain?: number
  withEq?: boolean
  withGateCompressor?: boolean
}

/** Réservé aux extensions futures ; WAIL/YELP sont identiques pour tous les ids (pas de variante régionale). */
export type WailYelpUnifiedOptions = Record<string, never>

export type SoundInstance = {
  id: string
  gainNode: GainNode
  voiceInput: GainNode
  oscillators: OscillatorNode[]
  lfoNodes: OscillatorNode[]
  modulationNodes: AudioNode[]
  noiseSource?: AudioBufferSourceNode
  timer?: number
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

/** Contexte passé aux builders de sirènes (pas de dépendance à la classe AudioEngine). */
export type SirenBuildContext = {
  audioContext: AudioContext
  frDebugIsolation: boolean
  noiseBuffer?: AudioBuffer
  logDebug: (message: string) => void
}
