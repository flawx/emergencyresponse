import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { ActiveSounds } from '../components/ActiveSounds'
import { AudioDebugPanel } from '../components/AudioDebugPanel'
import { AudioVisualizer } from '../components/AudioVisualizer'
import { PanelLayout } from '../components/PanelLayout'
import { SirenButton } from '../components/SirenButton'
import { VolumeSlider } from '../components/VolumeSlider'
import { useHaptic } from '../hooks/useHaptic'
import { useSirenStore } from '../store/sirenStore'
import { getScenario } from '../utils/sirenConfig'

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
  const [debugSnapshot, setDebugSnapshot] = useState(getAudioDebug())
  const qsirenHoldStartedAt = useRef<number | null>(null)
  const qsirenSuppressClick = useRef(false)

  if (!scenario) return <Navigate to="/" replace />

  const activeNames = scenario.defs.filter((d) => active[d.id]).map((d) => d.label)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDebugSnapshot(getAudioDebug())
    }, 120)
    return () => window.clearInterval(timer)
  }, [getAudioDebug])

  const onHoldStart = async (soundId: string, e: PointerEvent<HTMLButtonElement>) => {
    const sound = scenario.defs.find((def) => def.id === soundId)
    if (!sound) return
    const target = e.currentTarget
    const pointerId = e.pointerId
    vibrate([14])
    await startHold(sound, region, emergency)
    if (sound.kind === 'qsiren') qsirenHoldStartedAt.current = Date.now()
    if (target && typeof target.setPointerCapture === 'function' && target.isConnected) {
      try {
        target.setPointerCapture(pointerId)
      } catch {
        // Peut échouer si le pointer n'est plus actif.
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

  return (
    <PanelLayout title="Select siren" subtitle={`${scenario.region.toUpperCase()} / ${scenario.emergency.toUpperCase()}`}>
      <div className="space-y-3">
        {scenario.defs.map((sound) => {
          const isActive = !!active[sound.id]
          const isStop = sound.mode === 'stop'
          if (sound.kind === 'qsiren') {
            return (
              <div key={sound.id} className="grid grid-cols-2 gap-2">
                <SirenButton
                  label="Q-SIREN ON/OFF"
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
                  active={isActive}
                  hold
                  onHoldStart={(e) => {
                    void onHoldStart(sound.id, e)
                  }}
                  onHoldEnd={() => onHoldEnd(sound.id)}
                />
              </div>
            )
          }
          return (
            <SirenButton
              key={sound.id}
              label={sound.label}
              active={isActive}
              hold={sound.mode === 'hold'}
              danger={isStop}
              onClick={() => {
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
                sound.mode === 'hold'
                  ? (e) => {
                      void onHoldStart(sound.id, e)
                    }
                  : undefined
              }
              onHoldEnd={sound.mode === 'hold' ? () => onHoldEnd(sound.id) : undefined}
            />
          )
        })}
      </div>

      <div className="mt-4 space-y-3">
        <AudioVisualizer />
        <VolumeSlider value={masterVolume} onChange={setMasterVolume} />
        <ActiveSounds names={activeNames} />
        <AudioDebugPanel voices={debugSnapshot.voices} logs={debugSnapshot.logs} />
      </div>
    </PanelLayout>
  )
}
