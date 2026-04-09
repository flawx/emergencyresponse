import { create } from 'zustand'
import { audioEngine } from '../audio/engine'
import { getAllPlayableSoundIds, getScenario, type SoundDefinition } from '../utils/sirenConfig'

type ActiveMap = Record<string, boolean>

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

const clearExclusive = (active: ActiveMap, ids: string[] = []) => {
  for (const id of ids) active[id] = false
}

const setSound = (active: ActiveMap, id: string, value: boolean) => {
  active[id] = value
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

    const isActive = !!get().active[sound.id]
    if (isActive) {
      audioEngine.stop(sound.id)
      set((state) => ({ active: { ...state.active, [sound.id]: false } }))
      return
    }

    set((state) => {
      const next = { ...state.active }
      clearExclusive(next, sound.exclusiveWith)
      for (const ex of sound.exclusiveWith ?? []) audioEngine.stop(ex)
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
      clearExclusive(next, sound.exclusiveWith)
      for (const ex of sound.exclusiveWith ?? []) audioEngine.stop(ex)
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
