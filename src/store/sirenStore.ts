import { create } from 'zustand'
import { audioEngine } from '../audio/engine'
import { getAllPlayableSoundIds, getScenario, type SoundDefinition } from '../utils/sirenConfig'

type ActiveMap = Record<string, boolean>

const isWailOrYelp = (kind: SoundDefinition['kind']) => kind === 'wail' || kind === 'yelp'
const isFrAmbuTone = (kind: SoundDefinition['kind']) => kind === 'twoTone' || kind === 'threeTone' || kind === 'twoToneUmh'
const isFrAmbuId = (id: string) => id.startsWith('eu-ambu-')

const canPlayTogether = (soundA: SoundDefinition, soundB: SoundDefinition) => {
  if (soundA.id === soundB.id) return true
  if (isWailOrYelp(soundA.kind) && isWailOrYelp(soundB.kind)) return false
  if (soundA.kind === 'qsiren' && isWailOrYelp(soundB.kind)) return true
  if (soundB.kind === 'qsiren' && isWailOrYelp(soundA.kind)) return true
  if (isFrAmbuId(soundA.id) && isFrAmbuId(soundB.id)) {
    const aTone = isFrAmbuTone(soundA.kind)
    const bTone = isFrAmbuTone(soundB.kind)
    const aWailYelp = isWailOrYelp(soundA.kind)
    const bWailYelp = isWailOrYelp(soundB.kind)
    if ((aTone && bWailYelp) || (bTone && aWailYelp)) return true
  }
  return true
}

const canIgnoreExplicitExclusive = (soundA: SoundDefinition, soundB: SoundDefinition) => {
  if (soundA.kind === 'qsiren' && isWailOrYelp(soundB.kind)) return true
  if (soundB.kind === 'qsiren' && isWailOrYelp(soundA.kind)) return true
  if (isFrAmbuId(soundA.id) && isFrAmbuId(soundB.id)) {
    const aTone = isFrAmbuTone(soundA.kind)
    const bTone = isFrAmbuTone(soundB.kind)
    const aWailYelp = isWailOrYelp(soundA.kind)
    const bWailYelp = isWailOrYelp(soundB.kind)
    if ((aTone && bWailYelp) || (bTone && aWailYelp)) return true
  }
  return false
}

type SirenStore = {
  initialized: boolean
  masterVolume: number
  active: ActiveMap
  ensureReady: () => Promise<void>
  setMasterVolume: (value: number) => void
  toggleSound: (sound: SoundDefinition, region?: string, emergency?: string) => Promise<void>
  startHold: (sound: SoundDefinition, region?: string, emergency?: string) => Promise<void>
  endHold: (soundId: string) => void
  updateHoldPressure: (sound: SoundDefinition, pressure: number) => void
  getAudioDebug: () => ReturnType<typeof audioEngine.getDebugSnapshot>
  stopAll: (withChirp?: boolean) => void
}

const setSound = (active: ActiveMap, id: string, value: boolean) => {
  active[id] = value
}

const stopIncompatibleActive = (
  next: ActiveMap,
  defsById: Record<string, SoundDefinition>,
  incoming: SoundDefinition,
) => {
  for (const [activeId, enabled] of Object.entries(next)) {
    if (!enabled || activeId === incoming.id) continue
    const activeDef = defsById[activeId]
    if (!activeDef) continue
    const explicitExclusive =
      (incoming.exclusiveWith ?? []).includes(activeId) || (activeDef.exclusiveWith ?? []).includes(incoming.id)
    const compatible = canPlayTogether(incoming, activeDef)
    if (!compatible || (explicitExclusive && !canIgnoreExplicitExclusive(incoming, activeDef))) {
      next[activeId] = false
      audioEngine.stop(activeId)
    }
  }
}

export const useSirenStore = create<SirenStore>((set, get) => ({
  initialized: false,
  masterVolume: 0.85,
  active: {},

  ensureReady: async () => {
    if (get().initialized) {
      await audioEngine.resume()
      return
    }
    await audioEngine.init()
    await audioEngine.resume()
    await audioEngine.preloadSamples(getAllPlayableSoundIds())
    set({ initialized: true })
  },

  setMasterVolume: (value) => {
    audioEngine.setMasterVolume(value)
    set({ masterVolume: value })
  },

  toggleSound: async (sound, region, emergency) => {
    await get().ensureReady()
    if (sound.mode !== 'toggle') return

    const scenario = getScenario(region, emergency)
    if (!scenario) return
    const defsById = Object.fromEntries(scenario.defs.map((def) => [def.id, def]))

    const isActive = !!get().active[sound.id]
    if (isActive) {
      audioEngine.stop(sound.id)
      set((state) => ({ active: { ...state.active, [sound.id]: false } }))
      return
    }

    set((state) => {
      const next = { ...state.active }
      stopIncompatibleActive(next, defsById, sound)
      setSound(next, sound.id, true)
      return { active: next }
    })

    audioEngine.play(sound.id, { kind: sound.kind })

    // Ensure dangling toggles from previous page are removed.
    for (const def of scenario.defs) {
      if (def.mode === 'toggle' && def.id !== sound.id && !get().active[def.id]) {
        audioEngine.stop(def.id)
      }
    }
  },

  startHold: async (sound, region, emergency) => {
    await get().ensureReady()
    if (sound.mode !== 'hold' && sound.kind !== 'qsiren') return

    const scenario = getScenario(region, emergency)
    if (!scenario) return
    const defsById = Object.fromEntries(scenario.defs.map((def) => [def.id, def]))

    if (sound.kind === 'qsiren') {
      if (!get().active[sound.id]) {
        audioEngine.play(sound.id, { kind: sound.kind })
        set((state) => ({ active: { ...state.active, [sound.id]: true } }))
      }
      audioEngine.setQSirenBoost(sound.id, 1)
      return
    }

    if (get().active[sound.id]) return
    set((state) => {
      const next = { ...state.active }
      stopIncompatibleActive(next, defsById, sound)
      setSound(next, sound.id, true)
      return { active: next }
    })
    audioEngine.play(sound.id, { kind: sound.kind, gain: 0.42 })
  },

  endHold: (soundId) => {
    const activeSound = get().active[soundId]
    if (!activeSound) return
    if (soundId.includes('qsiren')) {
      audioEngine.setQSirenBoost(soundId, 0)
      return
    }
    audioEngine.stop(soundId, 0.04)
    set((state) => ({ active: { ...state.active, [soundId]: false } }))
  },

  updateHoldPressure: (sound, pressure) => {
    if (sound.kind === 'qsiren') {
      audioEngine.setQSirenBoost(sound.id, pressure)
    }
  },

  getAudioDebug: () => audioEngine.getDebugSnapshot(),

  stopAll: (withChirp = false) => {
    audioEngine.stopAll(withChirp)
    set({ active: {} })
  },
}))
