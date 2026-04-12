import { create } from 'zustand'
import { audioEngine } from '../audio/engine'
import {
  EU_AMBU_BASE_MAIN_IDS,
  Q_SIREN_SOUND_ID,
  canIgnoreExplicitExclusive,
  canPlayTogether,
  getAllPlayableSoundIds,
  getScenario,
  getSoundDefinitionById,
  isMainModeToggle,
  sameMainModeFamily,
  type SirenOverlayId,
  type SirenScenario,
  type SoundDefinition,
} from '../utils/sirenConfig'
import { loadStoredMasterVolume, saveStoredMasterVolume } from '../utils/masterVolumeStorage'

const AUDIO_ERR_LAYER_LIMIT =
  'Could not start sound — too many layers at once, or it is already playing.'
const AUDIO_ERR_LAYER_COMPAT = 'These siren layers cannot be combined.'

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
  manualHoldSoundId: string | null = null,
): ActiveMap {
  const active: ActiveMap = {}
  if (mainMode) active[mainMode] = true
  if (overlays.qSiren) active[Q_SIREN_SOUND_ID] = true
  if (overlays.euAmbuWail) active['eu-ambu-wail'] = true
  if (overlays.euAmbuYelp) active['eu-ambu-yelp'] = true
  if (holdVoiceId) active[holdVoiceId] = true
  if (manualHoldSoundId) active[manualHoldSoundId] = true
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

function collectOverlaySoundDefinitions(overlays: SirenOverlaysState): SoundDefinition[] {
  const out: SoundDefinition[] = []
  if (overlays.qSiren) {
    const d = getSoundDefinitionById(Q_SIREN_SOUND_ID)
    if (d) out.push(d)
  }
  if (overlays.euAmbuWail) {
    const d = getSoundDefinitionById('eu-ambu-wail')
    if (d) out.push(d)
  }
  if (overlays.euAmbuYelp) {
    const d = getSoundDefinitionById('eu-ambu-yelp')
    if (d) out.push(d)
  }
  return out
}

/** Vérifie la matrice `canPlayTogether` / exceptions avant d’activer un mode principal avec overlays restants. */
function canCombineMainWithOverlays(main: SoundDefinition, overlays: SirenOverlaysState): boolean {
  for (const o of collectOverlaySoundDefinitions(overlays)) {
    if (!canPlayTogether(main, o) && !canIgnoreExplicitExclusive(main, o)) return false
  }
  return true
}

/** Vérifie qu’un overlay peut coexister avec le mode principal et les autres overlays déjà actifs. */
function canAddOverlayToLayers(
  mainMode: string | null,
  overlays: SirenOverlaysState,
  overlayDef: SoundDefinition,
): boolean {
  if (mainMode) {
    const main = getSoundDefinitionById(mainMode)
    if (main && !canPlayTogether(main, overlayDef) && !canIgnoreExplicitExclusive(main, overlayDef)) {
      return false
    }
  }
  for (const o of collectOverlaySoundDefinitions(overlays)) {
    if (o.id === overlayDef.id) continue
    if (!canPlayTogether(o, overlayDef) && !canIgnoreExplicitExclusive(o, overlayDef)) return false
  }
  return true
}

type SirenStore = {
  initialized: boolean
  masterVolume: number
  mainMode: string | null
  overlays: SirenOverlaysState
  /** Horn / MAN (two-tone M) : voix de priorité pendant le maintien. */
  holdVoiceId: string | null
  holdLayersSnapshot: LayerSnapshot | null
  /** Hold-to-play temporaire (WAIL/YELP/two-tone) ; restaure les couches au relâchement. */
  manualHoldSoundId: string | null
  manualHoldSnapshot: LayerSnapshot | null
  /** Dérivé (compat + debug) : reflet de mainMode + overlays + hold. */
  active: ActiveMap

  ensureReady: () => Promise<void>
  setMasterVolume: (value: number) => void
  setMainMode: (sound: SoundDefinition, region?: string, emergency?: string) => Promise<void>
  toggleOverlay: (overlayId: SirenOverlayId, region?: string, emergency?: string) => Promise<void>
  startManualHold: (sound: SoundDefinition, region?: string, emergency?: string) => Promise<void>
  stopManualHold: () => void
  startHold: (sound: SoundDefinition, region?: string, emergency?: string) => Promise<void>
  endHold: (soundId: string) => void
  updateHoldPressure: (sound: SoundDefinition, pressure: number) => void
  getAudioDebug: () => ReturnType<typeof audioEngine.getDebugSnapshot>
  stopAll: (withChirp?: boolean) => void
  /** Message court affiché en UI (échec play, incompatibilité couches). */
  audioError: string | null
  clearAudioError: () => void
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
      active: buildActive(mainMode, overlays, holdVoiceId, s.manualHoldSoundId),
    }
  })
}

export const useSirenStore = create<SirenStore>((set, get) => ({
  initialized: false,
  masterVolume: loadStoredMasterVolume(),
  mainMode: null,
  overlays: emptyOverlays(),
  holdVoiceId: null,
  holdLayersSnapshot: null,
  manualHoldSoundId: null,
  manualHoldSnapshot: null,
  active: {},
  audioError: null,

  clearAudioError: () => set({ audioError: null }),

  ensureReady: async () => {
    if (get().initialized) {
      await audioEngine.resume()
      return
    }
    await audioEngine.init()
    await audioEngine.resume()
    await audioEngine.preloadSamples(getAllPlayableSoundIds())
    audioEngine.setMasterVolume(get().masterVolume)
    set({ initialized: true })
  },

  setMasterVolume: (value) => {
    saveStoredMasterVolume(value)
    audioEngine.setMasterVolume(value)
    set({ masterVolume: value })
  },

  setMainMode: async (sound, region, emergency) => {
    await get().ensureReady()
    if (get().holdVoiceId) return
    if (get().manualHoldSoundId) return
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
      stopStaleScenarioToggles(
        scenario,
        buildActive(null, nextOverlays, get().holdVoiceId, get().manualHoldSoundId),
      )
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

    if (!canCombineMainWithOverlays(sound, nextOverlays)) {
      set({ audioError: AUDIO_ERR_LAYER_COMPAT })
      return
    }

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
      set({ audioError: AUDIO_ERR_LAYER_LIMIT })
      return
    }

    const active = buildActive(nextMainId, nextOverlays, get().holdVoiceId, get().manualHoldSoundId)
    stopStaleScenarioToggles(scenario, active)
  },

  startManualHold: async (sound, region, emergency) => {
    await get().ensureReady()
    if (get().holdVoiceId) return
    if (get().manualHoldSoundId) return

    const scenario = getScenario(region, emergency)
    if (!scenario || !scenario.defs.some((d) => d.id === sound.id)) return

    if (sound.id === 'eu-ambu-wail' || sound.id === 'eu-ambu-yelp') {
      const m = get().mainMode
      if (!m || !(EU_AMBU_BASE_MAIN_IDS as readonly string[]).includes(m)) return
    }

    const snap: LayerSnapshot = {
      mainMode: get().mainMode,
      overlays: cloneOverlays(get().overlays),
    }
    stopLayerVoices(snap)

    const played = playLayerDef(sound)
    if (!played) {
      void replaySnapshotLayers(snap)
      set({ audioError: AUDIO_ERR_LAYER_LIMIT })
      return
    }

    set((s) => ({
      manualHoldSoundId: sound.id,
      manualHoldSnapshot: snap,
      active: buildActive(s.mainMode, s.overlays, s.holdVoiceId, sound.id),
    }))
    stopStaleScenarioToggles(scenario, get().active)
  },

  stopManualHold: () => {
    const id = get().manualHoldSoundId
    const snap = get().manualHoldSnapshot
    if (!id) return
    audioEngine.stop(id, 0.04)
    set((s) => ({
      manualHoldSoundId: null,
      manualHoldSnapshot: null,
      active: buildActive(s.mainMode, s.overlays, s.holdVoiceId, null),
    }))
    if (snap) {
      void get().ensureReady().then(() => replaySnapshotLayers(snap))
    }
  },

  toggleOverlay: async (overlayId, region, emergency) => {
    await get().ensureReady()
    if (get().holdVoiceId) return
    if (get().manualHoldSoundId) return

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
        if (!canAddOverlayToLayers(mainMode, overlays, def)) {
          set({ audioError: AUDIO_ERR_LAYER_COMPAT })
          return
        }
        const played = playLayerDef(def)
        if (!played) {
          set({ audioError: AUDIO_ERR_LAYER_LIMIT })
          return
        }
        applyLayerState(set, { overlays: { ...overlays, qSiren: true } })
      }
      stopStaleScenarioToggles(
        scenario,
        buildActive(mainMode, get().overlays, get().holdVoiceId, get().manualHoldSoundId),
      )
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
        stopStaleScenarioToggles(
          scenario,
          buildActive(mainMode, next, get().holdVoiceId, get().manualHoldSoundId),
        )
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

      if (!canAddOverlayToLayers(mainMode, next, def)) {
        set({ audioError: AUDIO_ERR_LAYER_COMPAT })
        return
      }

      const played = playLayerDef(def)
      if (!played) {
        set({ audioError: AUDIO_ERR_LAYER_LIMIT })
        return
      }
      applyLayerState(set, { overlays: next })
      stopStaleScenarioToggles(
        scenario,
        buildActive(mainMode, next, get().holdVoiceId, get().manualHoldSoundId),
      )
    }
  },

  startHold: async (sound, region, emergency) => {
    await get().ensureReady()

    const scenario = getScenario(region, emergency)
    if (!scenario) return

    if (get().manualHoldSoundId) {
      get().stopManualHold()
    }

    if (sound.kind === 'qsiren') {
      if (!get().overlays.qSiren) {
        if (!canAddOverlayToLayers(get().mainMode, get().overlays, sound)) {
          set({ audioError: AUDIO_ERR_LAYER_COMPAT })
          return
        }
        const ok = audioEngine.play(sound.id, {
          kind: sound.kind,
          regionStyle: sound.regionStyle,
          variant: sound.variant,
        })
        if (!ok) {
          set({ audioError: AUDIO_ERR_LAYER_LIMIT })
          return
        }
        applyLayerState(set, {
          overlays: { ...get().overlays, qSiren: true },
        })
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
    if (!hornOk) {
      set({ audioError: AUDIO_ERR_LAYER_LIMIT })
      return
    }

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
    audioEngine.setMicrophoneActive(false)
    audioEngine.setSirensDucking(false)
    audioEngine.setMicrophoneBoost(false)
    set({
      mainMode: null,
      overlays: emptyOverlays(),
      holdVoiceId: null,
      holdLayersSnapshot: null,
      manualHoldSoundId: null,
      manualHoldSnapshot: null,
      active: {},
      audioError: null,
    })
  },
}))
