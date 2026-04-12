import { create } from 'zustand'
import { audioEngine } from '../audio/engine'
import {
  EU_AMBU_BASE_MAIN_IDS,
  Q_SIREN_SOUND_ID,
  getAllPlayableSoundIds,
  getScenario,
  getSoundDefinitionById,
  isMainModeToggle,
  sameMainModeFamily,
  type SirenOverlayId,
  type SirenScenario,
  type SoundDefinition,
} from '../utils/sirenConfig'

/** Fade sortie voix précédente : même famille = chevauchement court avec la nouvelle (crossfade). */
const MAIN_MODE_FADE_OUT_SAME_FAMILY_S = 0.038
const MAIN_MODE_FADE_OUT_DIFF_FAMILY_S = 0.058

type ActiveMap = Record<string, boolean>

export type SirenOverlaysState = {
  qSiren?: boolean
  euAmbuWail?: boolean
  euAmbuYelp?: boolean
}

type LayerSnapshot = {
  mainMode: string | null
  overlays: SirenOverlaysState
}

const emptyOverlays = (): SirenOverlaysState => ({})

const cloneOverlays = (o: SirenOverlaysState): SirenOverlaysState => ({ ...o })

function buildActive(
  mainMode: string | null,
  overlays: SirenOverlaysState,
  holdVoiceId: string | null,
): ActiveMap {
  const active: ActiveMap = {}
  if (mainMode) active[mainMode] = true
  if (overlays.qSiren) active[Q_SIREN_SOUND_ID] = true
  if (overlays.euAmbuWail) active['eu-ambu-wail'] = true
  if (overlays.euAmbuYelp) active['eu-ambu-yelp'] = true
  if (holdVoiceId) active[holdVoiceId] = true
  return active
}

function stopLayerVoices(snap: LayerSnapshot) {
  if (snap.mainMode) audioEngine.stop(snap.mainMode)
  if (snap.overlays.qSiren) audioEngine.stop(Q_SIREN_SOUND_ID)
  if (snap.overlays.euAmbuWail) audioEngine.stop('eu-ambu-wail')
  if (snap.overlays.euAmbuYelp) audioEngine.stop('eu-ambu-yelp')
}

function playLayerDef(def: SoundDefinition): boolean {
  return audioEngine.play(def.id, {
    kind: def.kind,
    regionStyle: def.regionStyle,
    variant: def.variant,
  })
}

async function replaySnapshotLayers(snap: LayerSnapshot) {
  if (snap.mainMode) {
    const def = getSoundDefinitionById(snap.mainMode)
    if (def) playLayerDef(def)
  }
  if (snap.overlays.qSiren) {
    const def = getSoundDefinitionById(Q_SIREN_SOUND_ID)
    if (def) playLayerDef(def)
  }
  if (snap.overlays.euAmbuWail) {
    const def = getSoundDefinitionById('eu-ambu-wail')
    if (def) playLayerDef(def)
  }
  if (snap.overlays.euAmbuYelp) {
    const def = getSoundDefinitionById('eu-ambu-yelp')
    if (def) playLayerDef(def)
  }
}

function overlaysCompatibleWithMain(
  mainMode: string | null,
  mainDef: SoundDefinition | undefined,
  overlays: SirenOverlaysState,
): SirenOverlaysState {
  const next = cloneOverlays(overlays)
  const base = mainMode && (EU_AMBU_BASE_MAIN_IDS as readonly string[]).includes(mainMode)
  if (!base) {
    next.euAmbuWail = false
    next.euAmbuYelp = false
  }
  if (mainDef?.kind === 'threeTone' && mainDef.variant === 'ambulance') {
    next.euAmbuWail = false
    next.euAmbuYelp = false
  }
  return next
}

function stopStaleScenarioToggles(scenario: SirenScenario, active: ActiveMap) {
  for (const def of scenario.defs) {
    if (def.mode === 'toggle' && !active[def.id]) {
      audioEngine.stop(def.id)
    }
  }
}

function isHoldOverrideSound(sound: SoundDefinition): boolean {
  return sound.mode === 'hold' && sound.kind !== 'qsiren'
}

type SirenStore = {
  initialized: boolean
  masterVolume: number
  mainMode: string | null
  overlays: SirenOverlaysState
  /** Horn / MAN (two-tone M) : voix de priorité pendant le maintien. */
  holdVoiceId: string | null
  holdLayersSnapshot: LayerSnapshot | null
  /** Dérivé (compat + debug) : reflet de mainMode + overlays + hold. */
  active: ActiveMap

  ensureReady: () => Promise<void>
  setMasterVolume: (value: number) => void
  setMainMode: (sound: SoundDefinition, region?: string, emergency?: string) => Promise<void>
  toggleOverlay: (overlayId: SirenOverlayId, region?: string, emergency?: string) => Promise<void>
  startHold: (sound: SoundDefinition, region?: string, emergency?: string) => Promise<void>
  endHold: (soundId: string) => void
  updateHoldPressure: (sound: SoundDefinition, pressure: number) => void
  getAudioDebug: () => ReturnType<typeof audioEngine.getDebugSnapshot>
  stopAll: (withChirp?: boolean) => void
}

const applyLayerState = (
  set: (fn: (s: SirenStore) => Partial<SirenStore> | SirenStore) => void,
  partial: Partial<Pick<SirenStore, 'mainMode' | 'overlays' | 'holdVoiceId' | 'holdLayersSnapshot'>>,
) => {
  set((s) => {
    const mainMode = partial.mainMode !== undefined ? partial.mainMode : s.mainMode
    const overlays = partial.overlays !== undefined ? partial.overlays : s.overlays
    const holdVoiceId = partial.holdVoiceId !== undefined ? partial.holdVoiceId : s.holdVoiceId
    const holdLayersSnapshot =
      partial.holdLayersSnapshot !== undefined ? partial.holdLayersSnapshot : s.holdLayersSnapshot
    return {
      mainMode,
      overlays,
      holdVoiceId,
      holdLayersSnapshot,
      active: buildActive(mainMode, overlays, holdVoiceId),
    }
  })
}

export const useSirenStore = create<SirenStore>((set, get) => ({
  initialized: false,
  masterVolume: 0.85,
  mainMode: null,
  overlays: emptyOverlays(),
  holdVoiceId: null,
  holdLayersSnapshot: null,
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

  setMainMode: async (sound, region, emergency) => {
    await get().ensureReady()
    if (get().holdVoiceId) return
    if (sound.mode !== 'toggle') return

    const scenario = getScenario(region, emergency)
    if (!scenario) return
    if (!isMainModeToggle(sound, scenario)) return

    const { mainMode, overlays } = get()
    const turningOff = mainMode === sound.id

    if (turningOff) {
      audioEngine.stop(sound.id)
      const nextOverlays = overlaysCompatibleWithMain(null, undefined, overlays)
      if (overlays.euAmbuWail && !nextOverlays.euAmbuWail) audioEngine.stop('eu-ambu-wail')
      if (overlays.euAmbuYelp && !nextOverlays.euAmbuYelp) audioEngine.stop('eu-ambu-yelp')
      applyLayerState(set, {
        mainMode: null,
        overlays: nextOverlays,
      })
      stopStaleScenarioToggles(scenario, buildActive(null, nextOverlays, get().holdVoiceId))
      return
    }

    const nextMainId = sound.id
    const prevMain = mainMode
    if (prevMain && prevMain !== nextMainId) {
      const prevDef = getSoundDefinitionById(prevMain)
      const intraFamily = !!(prevDef && sameMainModeFamily(prevDef, sound))
      audioEngine.stop(
        prevMain,
        intraFamily ? MAIN_MODE_FADE_OUT_SAME_FAMILY_S : MAIN_MODE_FADE_OUT_DIFF_FAMILY_S,
      )
    }

    const mainDef = getSoundDefinitionById(nextMainId)
    const nextOverlays = overlaysCompatibleWithMain(nextMainId, mainDef, overlays)
    if (overlays.euAmbuWail && !nextOverlays.euAmbuWail) audioEngine.stop('eu-ambu-wail')
    if (overlays.euAmbuYelp && !nextOverlays.euAmbuYelp) audioEngine.stop('eu-ambu-yelp')

    applyLayerState(set, {
      mainMode: nextMainId,
      overlays: nextOverlays,
    })

    const played = playLayerDef(sound)
    if (!played) {
      applyLayerState(set, {
        mainMode: prevMain ?? null,
        overlays,
      })
      return
    }

    const active = buildActive(nextMainId, nextOverlays, get().holdVoiceId)
    stopStaleScenarioToggles(scenario, active)
  },

  toggleOverlay: async (overlayId, region, emergency) => {
    await get().ensureReady()
    if (get().holdVoiceId) return

    const scenario = getScenario(region, emergency)
    if (!scenario) return

    const { mainMode, overlays } = get()

    if (overlayId === 'qSiren') {
      if (scenario.region !== 'america' || scenario.emergency !== 'fire') return
      const def = getSoundDefinitionById(Q_SIREN_SOUND_ID)
      if (!def) return
      const on = !!overlays.qSiren
      if (on) {
        audioEngine.stop(Q_SIREN_SOUND_ID)
        applyLayerState(set, { overlays: { ...overlays, qSiren: false } })
      } else {
        const played = playLayerDef(def)
        if (!played) return
        applyLayerState(set, { overlays: { ...overlays, qSiren: true } })
      }
      stopStaleScenarioToggles(scenario, buildActive(mainMode, get().overlays, get().holdVoiceId))
      return
    }

    if (overlayId === 'euAmbuWail' || overlayId === 'euAmbuYelp') {
      if (scenario.region !== 'europe' || scenario.emergency !== 'ambulance') return

      const key = overlayId === 'euAmbuWail' ? 'euAmbuWail' : 'euAmbuYelp'
      const soundId = overlayId === 'euAmbuWail' ? 'eu-ambu-wail' : 'eu-ambu-yelp'
      const def = getSoundDefinitionById(soundId)
      if (!def) return

      const currentlyOn = !!overlays[key]
      if (currentlyOn) {
        audioEngine.stop(soundId)
        const next = { ...overlays, [key]: false } as SirenOverlaysState
        applyLayerState(set, { overlays: next })
        stopStaleScenarioToggles(scenario, buildActive(mainMode, next, get().holdVoiceId))
        return
      }

      const baseOk =
        mainMode != null && (EU_AMBU_BASE_MAIN_IDS as readonly string[]).includes(mainMode)
      if (!baseOk) return

      const otherKey = overlayId === 'euAmbuWail' ? 'euAmbuYelp' : 'euAmbuWail'
      const otherId = overlayId === 'euAmbuWail' ? 'eu-ambu-yelp' : 'eu-ambu-wail'
      let next = { ...overlays, [key]: true as boolean }
      if (overlays[otherKey]) {
        audioEngine.stop(otherId)
        next = { ...next, [otherKey]: false }
      }

      const played = playLayerDef(def)
      if (!played) return
      applyLayerState(set, { overlays: next })
      stopStaleScenarioToggles(scenario, buildActive(mainMode, next, get().holdVoiceId))
    }
  },

  startHold: async (sound, region, emergency) => {
    await get().ensureReady()

    const scenario = getScenario(region, emergency)
    if (!scenario) return

    if (sound.kind === 'qsiren') {
      if (!get().overlays.qSiren) {
        const ok = audioEngine.play(sound.id, {
          kind: sound.kind,
          regionStyle: sound.regionStyle,
          variant: sound.variant,
        })
        if (ok) {
          applyLayerState(set, {
            overlays: { ...get().overlays, qSiren: true },
          })
        }
      }
      audioEngine.setQSirenBoost(sound.id, 1)
      return
    }

    if (!isHoldOverrideSound(sound)) return

    if (get().holdVoiceId) return

    const snap: LayerSnapshot = {
      mainMode: get().mainMode,
      overlays: cloneOverlays(get().overlays),
    }
    stopLayerVoices(snap)

    const hornOk = audioEngine.play(sound.id, {
      kind: sound.kind,
      regionStyle: sound.regionStyle,
      variant: sound.variant,
    })
    if (!hornOk) return

    applyLayerState(set, {
      holdLayersSnapshot: snap,
      holdVoiceId: sound.id,
    })
    stopStaleScenarioToggles(scenario, get().active)
  },

  endHold: (soundId) => {
    if (soundId.includes('qsiren')) {
      audioEngine.setQSirenBoost(soundId, 0)
      return
    }

    if (get().holdVoiceId !== soundId) return

    audioEngine.stop(soundId, 0.04)
    const snap = get().holdLayersSnapshot

    applyLayerState(set, {
      holdVoiceId: null,
      holdLayersSnapshot: null,
    })

    if (snap) {
      void get().ensureReady().then(() => replaySnapshotLayers(snap))
    }
  },

  updateHoldPressure: (sound, pressure) => {
    if (sound.kind === 'qsiren') {
      audioEngine.setQSirenBoost(sound.id, pressure)
    }
  },

  getAudioDebug: () => audioEngine.getDebugSnapshot(),

  stopAll: (withChirp = false) => {
    audioEngine.stopAll(withChirp)
    set({
      mainMode: null,
      overlays: emptyOverlays(),
      holdVoiceId: null,
      holdLayersSnapshot: null,
      active: {},
    })
  },
}))
