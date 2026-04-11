import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { MasterLevelMeter } from '../components/audio/MasterLevelMeter'
import { ActiveSounds } from '../components/ActiveSounds'
import { AudioDebugPanel } from '../components/AudioDebugPanel'
import { AudioVisualizer } from '../components/AudioVisualizer'
import { PanelLayout } from '../components/PanelLayout'
import { SirenButton } from '../components/SirenButton'
import { VolumeSlider } from '../components/VolumeSlider'
import { audioEngine } from '../audio/engine'
import { useHaptic } from '../hooks/useHaptic'
import { useSirenStore } from '../store/sirenStore'
import type { SoundDefinition } from '../utils/sirenConfig'
import { getScenario } from '../utils/sirenConfig'
import { soundDefinitionIcon } from '../utils/sirenButtonIcons'

type HoldEvent = PointerEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>

const sectionTitleClass = 'mb-2 text-xs uppercase tracking-wider text-slate-500'
const sectionDividerClass = 'border-t border-slate-800 pt-4'

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

  const active = useSirenStore((s) => s.active)
  const masterVolume = useSirenStore((s) => s.masterVolume)
  const toggleSound = useSirenStore((s) => s.toggleSound)
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

  const activeNames = scenario.defs.filter((d) => active[d.id]).map((d) => d.label)

  const sirenDefs = scenario.defs.filter((d) => !(d.kind === 'horn' && d.mode === 'hold'))
  const hornDefs = scenario.defs.filter((d) => d.kind === 'horn' && d.mode === 'hold')

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

  const renderSoundRow = (sound: SoundDefinition) => {
    const isActive = !!active[sound.id]
    const isStop = sound.mode === 'stop'
    if (sound.kind === 'qsiren') {
      return (
        <div key={sound.id} className="grid grid-cols-2 gap-2">
          <SirenButton
            label="Q-SIREN ON/OFF"
            icon={soundDefinitionIcon(sound)}
            active={isActive}
            onClick={() => {
              if (qsirenSuppressClick.current) {
                qsirenSuppressClick.current = false
                return
              }
              vibrate()
              void toggleSound(sound, region, emergency)
            }}
          />
          <SirenButton
            label="Q-SIREN HOLD"
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
      <SirenButton
        key={sound.id}
        label={sound.label}
        icon={soundDefinitionIcon(sound)}
        active={isActive}
        hold={sound.mode === 'hold'}
        danger={isStop}
        disabled={hornDisabled}
        title={hornTooltip}
        onClick={() => {
          if (hornDisabled) return
          if (sound.mode === 'toggle') {
            vibrate()
            void toggleSound(sound, region, emergency)
          }
          if (isStop) {
            vibrate([18, 30, 18])
            stopAll(sound.stopChirp)
          }
        }}
        onHoldStart={
          sound.mode === 'hold' && !hornDisabled
            ? (e: HoldEvent) => {
                void onHoldStart(sound.id, e)
              }
            : undefined
        }
        onHoldEnd={sound.mode === 'hold' ? () => onHoldEnd(sound.id) : undefined}
      />
    )
  }

  return (
    <PanelLayout title="Select siren" subtitle={`${scenario.region.toUpperCase()} / ${scenario.emergency.toUpperCase()}`}>
      <div className="space-y-6">
        <section>
          <h2 className={sectionTitleClass}>SIRENS</h2>
          <div className="space-y-3">{sirenDefs.map((sound) => renderSoundRow(sound))}</div>
        </section>

        {hornDefs.length > 0 ? (
          <section className={sectionDividerClass}>
            <h2 className={sectionTitleClass}>HORNS</h2>
            <div className="space-y-3">{hornDefs.map((sound) => renderSoundRow(sound))}</div>
          </section>
        ) : null}

        <section className={sectionDividerClass}>
          <h2 className={sectionTitleClass}>CONTROL</h2>
          <div className="space-y-6">
            <MasterLevelMeter
              rms={debugSnapshot.masterPostLimiterRms}
              db={debugSnapshot.masterPostLimiterDbFs}
            />
            <VolumeSlider value={masterVolume} onChange={setMasterVolume} />
            <ActiveSounds names={activeNames} />
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
        </section>
      </div>
    </PanelLayout>
  )
}
