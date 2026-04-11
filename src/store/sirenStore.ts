import { create } from 'zustand'
import { audioEngine } from '../audio/engine'
import { getAllPlayableSoundIds, getScenario, type SoundDefinition } from '../utils/sirenConfig'

type ActiveMap = Record<string, boolean>

const isWailOrYelp = (kind: SoundDefinition['kind']) => kind === 'wail' || kind === 'yelp'
const isFrAmbuTone = (kind: SoundDefinition['kind']) => kind === 'twoTone' || kind === 'threeTone' || kind === 'twoToneUmh'
const isEuAmbulance = (d: SoundDefinition) => d.regionStyle === 'eu' && d.variant === 'ambulance'

const EU_AMBU_AUX_IDS = ['eu-ambu-two-tone', 'eu-ambu-umh'] as const
const EU_AMBU_ORPHAN_WAIL_IDS = ['eu-ambu-wail', 'eu-ambu-yelp'] as const

/** Ambulance EU uniquement : coupe WAIL/YELP s’il n’y a ni TWO-TONE ni UMH actif. */
function snapEuAmbulanceWailYelpIfOrphaned(active: ActiveMap) {
  const hasAux = EU_AMBU_AUX_IDS.some((id) => active[id])
  if (hasAux) return
  for (const id of EU_AMBU_ORPHAN_WAIL_IDS) {
    if (active[id]) {
      audioEngine.stop(id)
      active[id] = false
    }
  }
}

const isEuAmbuWailOrYelp = (sound: SoundDefinition) =>
  isEuAmbulance(sound) && (sound.id === 'eu-ambu-wail' || sound.id === 'eu-ambu-yelp')

const canPlayTogether = (soundA: SoundDefinition, soundB: SoundDefinition) => {
  if (soundA.id === soundB.id) return true
  if (isWailOrYelp(soundA.kind) && isWailOrYelp(soundB.kind)) return false
  if (soundA.kind === 'qsiren' && isWailOrYelp(soundB.kind)) return true
  if (soundB.kind === 'qsiren' && isWailOrYelp(soundA.kind)) return true
  if (isEuAmbulance(soundA) && isEuAmbulance(soundB)) {
    const threeA = soundA.kind === 'threeTone'
    const threeB = soundB.kind === 'threeTone'
    const aWailYelp = isWailOrYelp(soundA.kind)
    const bWailYelp = isWailOrYelp(soundB.kind)
    if ((threeA && bWailYelp) || (threeB && aWailYelp)) return false
    const aTone = isFrAmbuTone(soundA.kind)
    const bTone = isFrAmbuTone(soundB.kind)
    if ((aTone && bWailYelp) || (bTone && aWailYelp)) return true
  }
  return true
}

const canIgnoreExplicitExclusive = (soundA: SoundDefinition, soundB: SoundDefinition) => {
  if (soundA.kind === 'qsiren' && isWailOrYelp(soundB.kind)) return true
  if (soundB.kind === 'qsiren' && isWailOrYelp(soundA.kind)) return true
  if (isEuAmbulance(soundA) && isEuAmbulance(soundB)) {
    const threeA = soundA.kind === 'threeTone'
    const threeB = soundB.kind === 'threeTone'
    const aWailYelp = isWailOrYelp(soundA.kind)
    const bWailYelp = isWailOrYelp(soundB.kind)
    if ((threeA && bWailYelp) || (threeB && aWailYelp)) return false
    const aTone = isFrAmbuTone(soundA.kind)
    const bTone = isFrAmbuTone(soundB.kind)
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
      set((state) => {
        const next = { ...state.active, [sound.id]: false }
        const auxTurnedOff =
          scenario.region === 'europe' &&
          scenario.emergency === 'ambulance' &&
          (sound.id === 'eu-ambu-two-tone' || sound.id === 'eu-ambu-umh')
        if (auxTurnedOff) {
          snapEuAmbulanceWailYelpIfOrphaned(next)
        }
        return { active: next }
      })
      return
    }

    const activeBefore = get().active
    const isEuAmbu = scenario.region === 'europe' && scenario.emergency === 'ambulance'
    const isEuAmbuWailYelp = isEuAmbuWailOrYelp(sound)
    const hasAuxActive = !!(activeBefore['eu-ambu-two-tone'] || activeBefore['eu-ambu-umh'])
    if (isEuAmbu && isEuAmbuWailYelp && !hasAuxActive) {
      return
    }

    set((state) => {
      const next = { ...state.active }
      stopIncompatibleActive(next, defsById, sound)
      setSound(next, sound.id, true)
      return { active: next }
    })

    const played = audioEngine.play(sound.id, {
      kind: sound.kind,
      regionStyle: sound.regionStyle,
      variant: sound.variant,
    })
    if (!played) {
      set((state) => ({ active: { ...state.active, [sound.id]: false } }))
      return
    }

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
        const ok = audioEngine.play(sound.id, {
          kind: sound.kind,
          regionStyle: sound.regionStyle,
          variant: sound.variant,
        })
        if (ok) {
          set((state) => ({ active: { ...state.active, [sound.id]: true } }))
        }
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
    const hornOk = audioEngine.play(sound.id, {
      kind: sound.kind,
      regionStyle: sound.regionStyle,
      variant: sound.variant,
    })
    if (!hornOk) {
      set((state) => ({ active: { ...state.active, [sound.id]: false } }))
    }
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
