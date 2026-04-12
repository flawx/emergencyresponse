import { AlertTriangle } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { MasterLevelMeter } from '../components/audio/MasterLevelMeter'
import { AudioDebugPanel } from '../components/AudioDebugPanel'
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
  isMainModeToggle,
} from '../utils/sirenConfig'
import { soundDefinitionIcon } from '../utils/sirenButtonIcons'

type HoldEvent = PointerEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>

const sectionTitleClass = 'mb-2 text-xs uppercase tracking-normal text-slate-500'
const sectionDividerClass = 'border-t border-slate-800 pt-4'

const zoneSirensClass =
  'rounded-xl border border-slate-800 bg-panel-800 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
const zoneOverlaysClass =
  'rounded-xl border border-slate-800/90 bg-panel-800/95 p-3 shadow-[inset_0_1px_0_rgba(163,230,53,0.04)]'
const zoneHornsClass =
  'rounded-xl border border-slate-800/90 bg-[#0a1424] p-3 shadow-[inset_0_1px_0_rgba(56,189,248,0.06)]'
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
  const setMasterVolume = useSirenStore((s) => s.setMasterVolume)
  const updateHoldPressure = useSirenStore((s) => s.updateHoldPressure)
  const getAudioDebug = useSirenStore((s) => s.getAudioDebug)
  const ensureReady = useSirenStore((s) => s.ensureReady)
  const [, bumpHornUi] = useState(0)
  const [debugSnapshot, setDebugSnapshot] = useState(getAudioDebug())
  const qsirenHoldStartedAt = useRef<number | null>(null)
  const qsirenSuppressClick = useRef(false)

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

  if (!scenario) return <Navigate to="/" replace />

  const mainModeDefs = scenario.defs.filter(
    (d) => d.mode === 'toggle' && isMainModeToggle(d, scenario),
  )
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

  const renderMainModeButton = (sound: SoundDefinition) => (
    <div key={sound.id} className="min-w-0">
      <SirenButton
        label={sound.label}
        caption={getMainModeCaption(sound)}
        icon={soundDefinitionIcon(sound)}
        active={mainMode === sound.id}
        exclusiveSlot
        onClick={() => {
          vibrate()
          void setMainMode(sound, region, emergency)
        }}
      />
    </div>
  )

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

    return (
      <div key={sound.id} className="min-w-0">
        <SirenButton
          label={sound.label}
          icon={soundDefinitionIcon(sound)}
          active={isActive}
          disabled={euAmbuWailYelpBlocked}
          title={euAmbuWailYelpBlocked ? euAmbuWailYelpNeedsBase : undefined}
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
        <section>
          <h2 className={sectionTitleClass}>Siren</h2>
          <p className="mb-2 text-[11px] text-slate-500">Select a siren mode</p>
          <div className={zoneSirensClass}>
            <div className="mode-selector grid grid-cols-2 gap-2 sm:grid-cols-3">
              {mainModeDefs.map((sound) => renderMainModeButton(sound))}
            </div>
            {stopDef ? (
              <div className="mt-3 border-t border-slate-800/90 pt-3">
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
          </div>
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
          <h2 className={sectionTitleClass}>System</h2>
          <div className={zoneControlClass}>
            <div className="space-y-6">
              <VolumeSlider value={masterVolume} onChange={setMasterVolume} />
              <MasterLevelMeter
                leftDb={debugSnapshot.masterPostLimiterDbFs}
                rightDb={debugSnapshot.masterPostLimiterDbFs}
              />
              <AudioVisualizer />
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
