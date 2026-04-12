import clsx from 'clsx'
import { AlertTriangle, Mic, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { MasterLevelMeter } from '../components/audio/MasterLevelMeter'
import { AudioDebugPanel } from '../components/AudioDebugPanel'
import { ActiveSounds } from '../components/ActiveSounds'
import { AudioVisualizer } from '../components/AudioVisualizer'
import { PanelLayout } from '../components/PanelLayout'
import { SettingsNavButton } from '../components/SettingsNavButton'
import { SirenButton } from '../components/SirenButton'
import { VolumeSlider } from '../components/VolumeSlider'
import { audioEngine } from '../audio/engine'
import { useHaptic } from '../hooks/useHaptic'
import { useSirenStore } from '../store/sirenStore'
import type { SoundDefinition } from '../utils/sirenConfig'
import {
  euAmbuHasBaseMain,
  getMainModeCaption,
  getOverlayIdForSound,
  getScenario,
  getSoundDefinitionById,
  isMainModeToggle,
  isManualHoldCapable,
} from '../utils/sirenConfig'
import { soundDefinitionIcon } from '../utils/sirenButtonIcons'
import { loadStoredAudioInputDeviceId } from '../utils/audioInputDeviceStorage'

type HoldEvent = PointerEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>

const sectionTitleClass = 'mb-2 text-xs uppercase tracking-normal text-slate-500'
const sectionDividerClass = 'border-t border-slate-800 pt-4'

const zoneOverlaysClass =
  'rounded-xl border border-slate-800/90 bg-panel-800/95 p-3 shadow-[inset_0_1px_0_rgba(163,230,53,0.04)]'
const zoneHornsClass =
  'rounded-xl border border-slate-800/90 bg-[#0a1424] p-3 shadow-[inset_0_1px_0_rgba(56,189,248,0.06)]'
const zonePaClass =
  'rounded-xl border border-slate-800/90 bg-[#120f0a] p-3 shadow-[inset_0_1px_0_rgba(251,146,60,0.05)]'
const zoneControlClass =
  'rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-[inset_0_2px_8px_rgba(0,0,0,0.35)]'

function isAudioDebugEnabled() {
  return (
    (typeof window !== 'undefined' && window.location.search.includes('debug=1')) ||
    import.meta.env.DEV ||
    import.meta.env.VITE_SHOW_AUDIO_DEBUG === 'true'
  )
}

export function SirenControlPage() {
  const { region, emergency } = useParams()
  const scenario = getScenario(region, emergency)
  const { vibrate } = useHaptic()

  const mainMode = useSirenStore((s) => s.mainMode)
  const overlays = useSirenStore((s) => s.overlays)
  const holdVoiceId = useSirenStore((s) => s.holdVoiceId)
  const masterVolume = useSirenStore((s) => s.masterVolume)
  const setMainMode = useSirenStore((s) => s.setMainMode)
  const toggleOverlay = useSirenStore((s) => s.toggleOverlay)
  const startHold = useSirenStore((s) => s.startHold)
  const endHold = useSirenStore((s) => s.endHold)
  const stopAll = useSirenStore((s) => s.stopAll)
  const manualHoldSoundId = useSirenStore((s) => s.manualHoldSoundId)
  const startManualHold = useSirenStore((s) => s.startManualHold)
  const stopManualHold = useSirenStore((s) => s.stopManualHold)
  const setMasterVolume = useSirenStore((s) => s.setMasterVolume)
  const updateHoldPressure = useSirenStore((s) => s.updateHoldPressure)
  const getAudioDebug = useSirenStore((s) => s.getAudioDebug)
  const ensureReady = useSirenStore((s) => s.ensureReady)
  const audioError = useSirenStore((s) => s.audioError)
  const clearAudioError = useSirenStore((s) => s.clearAudioError)
  const active = useSirenStore((s) => s.active)
  const [, bumpHornUi] = useState(0)
  const [debugSnapshot, setDebugSnapshot] = useState(getAudioDebug())
  const qsirenHoldStartedAt = useRef<number | null>(null)
  const qsirenSuppressClick = useRef(false)
  const scenarioKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!region || !emergency) return
    const key = `${region}/${emergency}`
    if (scenarioKeyRef.current !== null && scenarioKeyRef.current !== key) {
      stopAll(false)
    }
    scenarioKeyRef.current = key
  }, [region, emergency, stopAll])

  useEffect(() => {
    if (!audioError) return
    const t = window.setTimeout(() => clearAudioError(), 5200)
    return () => window.clearTimeout(t)
  }, [audioError, clearAudioError])

  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState(
    () => loadStoredAudioInputDeviceId() ?? '',
  )
  const [micPttPressed, setMicPttPressed] = useState(false)
  const micPttActivateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const micPttStillDownRef = useRef(false)

  const syncMicFromStorage = useCallback(() => {
    const id = loadStoredAudioInputDeviceId() ?? ''
    setSelectedMicDeviceId(id)
    return id
  }, [])

  const clearMicPttTimer = useCallback(() => {
    if (micPttActivateTimerRef.current != null) {
      window.clearTimeout(micPttActivateTimerRef.current)
      micPttActivateTimerRef.current = null
    }
  }, [])

  const endMicPttHold = useCallback(() => {
    micPttStillDownRef.current = false
    clearMicPttTimer()
    setMicPttPressed(false)
    audioEngine.setMicrophoneActive(false)
    audioEngine.setSirensDucking(false)
    audioEngine.setMicrophoneBoost(false)
  }, [clearMicPttTimer])

  useEffect(() => {
    return () => {
      clearMicPttTimer()
      audioEngine.setMicrophoneActive(false)
      audioEngine.setSirensDucking(false)
      audioEngine.setMicrophoneBoost(false)
    }
  }, [clearMicPttTimer])

  useEffect(() => {
    const id = syncMicFromStorage()
    if (!id) return
    void ensureReady().then(() => void audioEngine.enableMicrophone(id).catch(() => {}))
  }, [ensureReady, syncMicFromStorage])

  useEffect(() => {
    const onFocus = () => {
      const id = syncMicFromStorage()
      if (id) void ensureReady().then(() => void audioEngine.enableMicrophone(id).catch(() => {}))
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [ensureReady, syncMicFromStorage])

  useEffect(() => {
    void ensureReady().then(() => bumpHornUi((n) => n + 1))
  }, [ensureReady])

  const isDebug = isAudioDebugEnabled()

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDebugSnapshot(getAudioDebug())
    }, 100)
    return () => window.clearInterval(timer)
  }, [getAudioDebug])

  const hasPoliceHorn = audioEngine.hasPoliceHorn()
  const hasAirHorn = audioEngine.hasAirHorn()

  const mainModeDefs = useMemo((): SoundDefinition[] => {
    if (!scenario) return []
    return scenario.defs.filter((d) => d.mode === 'toggle' && isMainModeToggle(d, scenario))
  }, [scenario])

  const activeSoundLabels = useMemo(() => {
    return Object.entries(active)
      .filter(([, on]) => on)
      .map(([id]) => getSoundDefinitionById(id)?.label ?? id)
      .sort((a, b) => a.localeCompare(b))
  }, [active])

  const modeGridRef = useRef<HTMLDivElement>(null)
  const modeCellRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [modeHighlight, setModeHighlight] = useState({ x: 0, y: 0, w: 0, h: 0 })

  /** Priorité visuelle : override manuel > mode latché (grille principale uniquement). */
  const modeHighlightTarget = manualHoldSoundId ?? mainMode

  const updateModeHighlight = useCallback(() => {
    const grid = modeGridRef.current
    if (!grid) return
    if (!modeHighlightTarget) {
      setModeHighlight((prev) => ({ ...prev, w: 0, h: 0 }))
      return
    }
    const cell = modeCellRefs.current.get(modeHighlightTarget)
    if (!cell) {
      setModeHighlight((prev) => ({ ...prev, w: 0, h: 0 }))
      return
    }
    const gr = grid.getBoundingClientRect()
    const cr = cell.getBoundingClientRect()
    setModeHighlight({
      x: cr.left - gr.left,
      y: cr.top - gr.top,
      w: cr.width,
      h: cr.height,
    })
  }, [modeHighlightTarget])

  useLayoutEffect(() => {
    updateModeHighlight()
  }, [updateModeHighlight, mainModeDefs, modeHighlightTarget])

  useEffect(() => {
    const grid = modeGridRef.current
    if (!grid) return undefined
    const ro = new ResizeObserver(() => updateModeHighlight())
    ro.observe(grid)
    window.addEventListener('resize', updateModeHighlight)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', updateModeHighlight)
    }
  }, [updateModeHighlight])

  if (!scenario) return <Navigate to="/" replace />
  const overlayDefs = scenario.defs.filter((d) => getOverlayIdForSound(d, scenario) !== null)
  const qsirenDef = overlayDefs.find((d) => d.kind === 'qsiren')
  const euAmbuOverlayDefs = overlayDefs.filter(
    (d) => d.id === 'eu-ambu-wail' || d.id === 'eu-ambu-yelp',
  )
  const stopDef = scenario.defs.find((d) => d.mode === 'stop')
  const hornDefs = scenario.defs.filter((d) => d.kind === 'horn' && d.mode === 'hold')
  const hasOverlaySection = overlayDefs.length > 0

  const onHoldStart = async (soundId: string, e: HoldEvent) => {
    const sound = scenario.defs.find((def) => def.id === soundId)
    if (!sound) return
    const target = e.currentTarget
    const pointerId = 'pointerId' in e ? e.pointerId : undefined
    vibrate([14])
    await startHold(sound, region, emergency)
    if (sound.kind === 'qsiren') qsirenHoldStartedAt.current = Date.now()
    if (
      pointerId != null &&
      target &&
      typeof target.setPointerCapture === 'function' &&
      target.isConnected
    ) {
      try {
        target.setPointerCapture(pointerId)
      } catch {
        // May fail if the pointer is no longer active.
      }
    }
  }

  const onHoldEnd = (soundId: string) => {
    const sound = scenario.defs.find((def) => def.id === soundId)
    if (sound?.kind === 'qsiren') {
      const started = qsirenHoldStartedAt.current
      if (started && Date.now() - started > 120) qsirenSuppressClick.current = true
      qsirenHoldStartedAt.current = null
      updateHoldPressure(sound, 0)
    }
    endHold(soundId)
  }

  const renderMainModeButton = (sound: SoundDefinition) => {
    const cap = getMainModeCaption(sound)
    const manualCapable = isManualHoldCapable(sound, scenario, mainMode)
    const manualOverrideUi = manualHoldSoundId != null
    const dimModeSelector =
      manualOverrideUi && manualHoldSoundId !== sound.id
    const modeActiveVisual =
      manualOverrideUi ? manualHoldSoundId === sound.id : mainMode === sound.id
    return (
      <div
        key={sound.id}
        className={clsx(
          'relative z-10 flex min-w-0 flex-col transition-opacity duration-150',
          dimModeSelector && 'opacity-40',
        )}
      >
        <div
          ref={(el) => {
            if (el) modeCellRefs.current.set(sound.id, el)
            else modeCellRefs.current.delete(sound.id)
          }}
          className="w-full min-w-0"
        >
          <SirenButton
            label={sound.label}
            icon={soundDefinitionIcon(sound)}
            active={modeActiveVisual}
            exclusiveSlot
            manualHoldArmMs={manualCapable ? 180 : undefined}
            onManualHoldArm={() => void startManualHold(sound, region, emergency)}
            onManualHoldRelease={() => stopManualHold()}
            manualHoldActive={manualHoldSoundId === sound.id}
            onClick={() => {
              vibrate()
              void setMainMode(sound, region, emergency)
            }}
          />
        </div>
        {cap ? (
          <p className="mt-1 text-center text-[10px] leading-tight text-slate-500">{cap}</p>
        ) : null}
      </div>
    )
  }

  const renderOverlayButton = (sound: SoundDefinition) => {
    const overlayId = getOverlayIdForSound(sound, scenario)
    if (!overlayId) return null
    const isActive =
      overlayId === 'qSiren'
        ? !!overlays.qSiren
        : overlayId === 'euAmbuWail'
          ? !!overlays.euAmbuWail
          : !!overlays.euAmbuYelp
    const euAmbuAuxOn = euAmbuHasBaseMain(mainMode)
    const isEuAmbuWailYelp =
      scenario.region === 'europe' &&
      scenario.emergency === 'ambulance' &&
      (sound.id === 'eu-ambu-wail' || sound.id === 'eu-ambu-yelp')
    const euAmbuWailYelpBlocked = isEuAmbuWailYelp && !euAmbuAuxOn && !isActive
    const euAmbuWailYelpNeedsBase =
      isEuAmbuWailYelp && !euAmbuAuxOn ? 'Requires TONE or ALT' : undefined
    const manualCapable = isManualHoldCapable(sound, scenario, mainMode)

    return (
      <div key={sound.id} className="min-w-0">
        <SirenButton
          label={sound.label}
          icon={soundDefinitionIcon(sound)}
          active={isActive || manualHoldSoundId === sound.id}
          disabled={euAmbuWailYelpBlocked}
          title={euAmbuWailYelpBlocked ? euAmbuWailYelpNeedsBase : undefined}
          manualHoldArmMs={manualCapable && !euAmbuWailYelpBlocked ? 180 : undefined}
          onManualHoldArm={() => void startManualHold(sound, region, emergency)}
          onManualHoldRelease={() => stopManualHold()}
          manualHoldActive={manualHoldSoundId === sound.id}
          onClick={() => {
            if (euAmbuWailYelpBlocked) return
            vibrate()
            void toggleOverlay(overlayId, region, emergency)
          }}
        />
        {euAmbuWailYelpBlocked ? (
          <p className="mt-1 text-[11px] text-slate-500" role="status">
            {euAmbuWailYelpNeedsBase}
          </p>
        ) : null}
      </div>
    )
  }

  const renderQsirenRow = (sound: SoundDefinition) => {
    const isActive = !!overlays.qSiren
    return (
      <div className="col-span-full grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SirenButton
          label={sound.label}
          icon={soundDefinitionIcon(sound)}
          active={isActive}
          onClick={() => {
            if (qsirenSuppressClick.current) {
              qsirenSuppressClick.current = false
              return
            }
            vibrate()
            void toggleOverlay('qSiren', region, emergency)
          }}
        />
        <SirenButton
          label="MAN (HOLD)"
          splitLabel={{ line1: 'MAN', line2: '(HOLD)' }}
          icon={soundDefinitionIcon(sound)}
          active={isActive}
          hold
          onHoldStart={(e: HoldEvent) => {
            void onHoldStart(sound.id, e)
          }}
          onHoldEnd={() => onHoldEnd(sound.id)}
        />
      </div>
    )
  }

  const renderHornRow = (sound: SoundDefinition) => {
    const isActive = holdVoiceId === sound.id
    const hornSampleMissing =
      (sound.id === 'amer-police-horn' && !hasPoliceHorn) ||
      (sound.id === 'amer-fire-airhorn' && !hasAirHorn)
    const hornDisabled = hornSampleMissing && sound.mode === 'hold' && sound.kind === 'horn'
    const hornTooltip = hornSampleMissing
      ? sound.id === 'amer-police-horn'
        ? 'Police horn sample missing — add public/audio/horn-police-us.wav (or .mp3)'
        : 'Air horn sample missing — add public/audio/horn-fire-us.wav (or .mp3)'
      : undefined

    return (
      <div key={sound.id} className="w-full min-w-0">
        <SirenButton
          label={sound.label}
          icon={soundDefinitionIcon(sound)}
          active={isActive}
          hold
          disabled={hornDisabled}
          title={hornTooltip}
          onHoldStart={
            !hornDisabled
              ? (e: HoldEvent) => {
                  void onHoldStart(sound.id, e)
                }
              : undefined
          }
          onHoldEnd={() => onHoldEnd(sound.id)}
        />
        {hornDisabled ? (
          <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-500">
            <AlertTriangle className="size-3 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
            <span>Audio file required — see README</span>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <PanelLayout
      title="Select siren"
      subtitle={`${scenario.region.toUpperCase()} / ${scenario.emergency.toUpperCase()}`}
      headerActions={<SettingsNavButton />}
    >
      <div className="space-y-6">
        {audioError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-amber-500/45 bg-amber-950/35 px-3 py-2.5 text-amber-100 shadow-[inset_0_1px_0_rgba(251,191,36,0.12)]"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" strokeWidth={2} aria-hidden />
            <p className="min-w-0 flex-1 text-sm leading-snug">{audioError}</p>
            <button
              type="button"
              onClick={() => clearAudioError()}
              className="shrink-0 rounded-md p-1 text-amber-200/90 hover:bg-amber-500/20 hover:text-amber-50"
              aria-label="Dismiss message"
            >
              <X className="size-4" strokeWidth={2} aria-hidden />
            </button>
          </div>
        ) : null}
        <section>
          <h2 className={sectionTitleClass}>Siren</h2>
          <p className="mb-2 text-[11px] text-slate-500">Select a siren mode</p>
          {manualHoldSoundId != null ? (
            <div className="mb-2 text-[10px] text-white/40 uppercase tracking-wider transition-opacity duration-150">
              Manual override
            </div>
          ) : null}
          <div className="mode-selector relative rounded-xl border border-slate-700 bg-slate-950 p-3 shadow-inner">
            <div
              ref={modeGridRef}
              className="mode-grid relative grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              <div
                aria-hidden
                className={clsx(
                  'mode-highlight pointer-events-none absolute left-0 top-0 z-0 rounded-lg will-change-transform transition-colors duration-150',
                  manualHoldSoundId != null ? 'bg-white/10' : 'bg-lime-400/20',
                )}
                style={{
                  transform: `translate3d(${modeHighlight.x}px, ${modeHighlight.y}px, 0)`,
                  width: modeHighlight.w,
                  height: modeHighlight.h,
                  transition:
                    'transform 150ms ease-out, width 150ms ease-out, height 150ms ease-out, background-color 150ms ease-out',
                }}
              />
              {mainModeDefs.map((sound) => renderMainModeButton(sound))}
            </div>
          </div>
          {stopDef ? (
            <div className="mt-3">
              <SirenButton
                label={stopDef.label}
                icon={soundDefinitionIcon(stopDef)}
                active={false}
                danger
                onClick={() => {
                  vibrate([18, 30, 18])
                  stopAll(stopDef.stopChirp)
                }}
              />
            </div>
          ) : null}
        </section>

        {hasOverlaySection ? (
          <section className={sectionDividerClass}>
            <h2 className={sectionTitleClass}>Aux</h2>
            <p className="mb-2 text-[11px] text-slate-500">
              AUX on the selected mode: MAN (manual); EU ambulance WAIL/YELP when TONE or ALT is on.
            </p>
            <div className={zoneOverlaysClass}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {qsirenDef ? renderQsirenRow(qsirenDef) : null}
                {euAmbuOverlayDefs.length > 0 ? (
                  <div
                    className={
                      qsirenDef
                        ? 'col-span-full grid grid-cols-2 gap-2 sm:grid-cols-2'
                        : 'col-span-full grid grid-cols-2 gap-2'
                    }
                  >
                    {euAmbuOverlayDefs.map((s) => renderOverlayButton(s))}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {hornDefs.length > 0 ? (
          <section className={sectionDividerClass}>
            <h2 className={sectionTitleClass}>Manual / horn</h2>
            <div className={zoneHornsClass}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {hornDefs.map((sound) => renderHornRow(sound))}
              </div>
            </div>
          </section>
        ) : null}

        <section className={sectionDividerClass}>
          <h2 className={sectionTitleClass}>PA / Radio</h2>
          <p className="mb-2 text-[11px] text-slate-500">
            Press and hold to transmit. Configure input device in Settings.
          </p>
          <div className={zonePaClass}>
            <button
              type="button"
              disabled={!selectedMicDeviceId}
              className={clsx(
                'relative flex w-full min-h-16 min-w-0 select-none items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left font-semibold tracking-normal transition-colors',
                !selectedMicDeviceId &&
                  'cursor-not-allowed border-slate-800 bg-slate-950/80 text-slate-500 opacity-50',
                selectedMicDeviceId &&
                  !micPttPressed &&
                  'border-slate-700 bg-slate-900 text-slate-200 shadow-inner hover:border-slate-500 hover:bg-slate-900/95 active:scale-[0.98]',
                selectedMicDeviceId &&
                  micPttPressed &&
                  'border-orange-500/80 bg-orange-950/50 text-orange-50 shadow-[inset_0_2px_4px_rgba(0,0,0,0.35),0_0_10px_rgba(251,146,60,0.35)] ring-2 ring-orange-400/60',
              )}
              aria-pressed={micPttPressed}
              onPointerDown={(e) => {
                if (!selectedMicDeviceId) return
                void ensureReady()
                micPttStillDownRef.current = true
                setMicPttPressed(true)
                try {
                  e.currentTarget.setPointerCapture(e.pointerId)
                } catch {
                  /* ignore */
                }
                clearMicPttTimer()
                micPttActivateTimerRef.current = window.setTimeout(() => {
                  micPttActivateTimerRef.current = null
                  if (micPttStillDownRef.current) {
                    audioEngine.setMicrophoneActive(true)
                    audioEngine.setSirensDucking(true)
                    audioEngine.setMicrophoneBoost(true)
                  }
                }, 80)
              }}
              onPointerUp={endMicPttHold}
              onPointerCancel={endMicPttHold}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Mic
                  className={clsx(
                    'size-6 shrink-0',
                    !selectedMicDeviceId
                      ? 'text-slate-600'
                      : micPttPressed
                        ? 'text-orange-300'
                        : 'text-slate-400',
                  )}
                  strokeWidth={2}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-col items-start justify-center leading-tight">
                  <span className="text-base">PA</span>
                  {micPttPressed ? (
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-orange-200/95">
                      TRANSMIT
                    </span>
                  ) : null}
                </div>
              </div>
              <span
                className={clsx(
                  'shrink-0 rounded-md border px-2 py-1 text-xs font-medium',
                  !selectedMicDeviceId
                    ? 'border-slate-700 bg-slate-900/50 text-slate-600'
                    : micPttPressed
                      ? 'border-orange-400/60 bg-orange-950/60 text-orange-100'
                      : 'border-slate-500 bg-slate-900/80 text-slate-200',
                )}
                aria-hidden
              >
                HOLD
              </span>
            </button>
            {!selectedMicDeviceId ? (
              <p className="mt-2 text-[11px] text-slate-500" role="status">
                No microphone selected
              </p>
            ) : null}
          </div>
        </section>

        <section className={sectionDividerClass}>
          <h2 className={sectionTitleClass}>System</h2>
          <div className={zoneControlClass}>
            <div className="space-y-6">
              <ActiveSounds names={activeSoundLabels} />
              <VolumeSlider value={masterVolume} onChange={setMasterVolume} />
              <MasterLevelMeter
                leftDb={debugSnapshot.masterPostLimiterDbFs}
                rightDb={debugSnapshot.masterPostLimiterDbFs}
              />
              {/* Test A/B : désactivé pour isoler l’impact rAF + analyser sur les glitches — remettre `true` pour réactiver */}
              {false && <AudioVisualizer />}
              {isDebug ? (
                <AudioDebugPanel
                  voices={debugSnapshot.voices}
                  logs={debugSnapshot.logs}
                  masterPostLimiterRms={debugSnapshot.masterPostLimiterRms}
                  masterPostLimiterDbFs={debugSnapshot.masterPostLimiterDbFs}
                />
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </PanelLayout>
  )
}
