import { useCallback, useEffect, useMemo, useState } from 'react'
import { PanelLayout } from '../components/PanelLayout'
import { audioEngine } from '../audio/engine'
import { useSirenStore } from '../store/sirenStore'
import { getSystemInfo, supportsSetSinkId } from '../utils/systemInfo'

const STORAGE_KEY = 'audioOutputDeviceId'

function loadStoredSinkId(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === null || v === '' ? null : v
  } catch {
    return null
  }
}

function saveStoredSinkId(deviceId: string) {
  try {
    if (deviceId === '') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, deviceId)
  } catch {
    /* ignore */
  }
}

export function SettingsPage() {
  const ensureReady = useSirenStore((s) => s.ensureReady)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [sinkError, setSinkError] = useState<string | null>(null)
  const [permissionHint, setPermissionHint] = useState(false)
  const [tick, setTick] = useState(0)

  const canSelectSink = supportsSetSinkId()

  const refreshDevices = useCallback(() => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevices([])
      return
    }
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        setDevices(list.filter((d) => d.kind === 'audiooutput'))
        const labels = list.filter((d) => d.kind === 'audiooutput' && d.label)
        setPermissionHint(list.some((d) => d.kind === 'audiooutput') && labels.length === 0)
      })
      .catch(() => setDevices([]))
  }, [])

  useEffect(() => {
    refreshDevices()
    const md = navigator.mediaDevices
    if (!md?.addEventListener) return undefined
    const onChange = () => refreshDevices()
    md.addEventListener('devicechange', onChange)
    return () => md.removeEventListener('devicechange', onChange)
  }, [refreshDevices])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await ensureReady()
      if (cancelled) return
      setTick((n) => n + 1)
      refreshDevices()
      const stored = loadStoredSinkId()
      if (canSelectSink && stored !== null) {
        try {
          await audioEngine.enableMediaStreamOutput(stored)
          setSelectedDeviceId(stored)
        } catch {
          setSelectedDeviceId(audioEngine.getOutputSinkId() || '')
        }
      } else {
        setSelectedDeviceId(audioEngine.getOutputSinkId() || '')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ensureReady, refreshDevices, canSelectSink])

  const ctx = useMemo(() => {
    void tick
    return audioEngine.getAudioContext() ?? null
  }, [tick])

  const system = useMemo(() => getSystemInfo(ctx), [ctx])

  const requestMicForLabels = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
    } catch {
      /* user denied or unsupported */
    }
    refreshDevices()
  }

  const onSelectDevice = async (deviceId: string) => {
    setSinkError(null)
    if (!canSelectSink) return
    try {
      await ensureReady()
      if (!deviceId) {
        await audioEngine.disableMediaStreamOutput()
      } else {
        await audioEngine.enableMediaStreamOutput(deviceId)
      }
      setSelectedDeviceId(deviceId)
      saveStoredSinkId(deviceId)
    } catch (e) {
      setSinkError(e instanceof Error ? e.message : 'Could not set audio output')
    }
  }

  const latencyLine =
    system.baseLatencySec !== undefined || system.outputLatencySec !== undefined
      ? `Base: ${system.baseLatencySec !== undefined ? `${(system.baseLatencySec * 1000).toFixed(1)} ms` : '—'} · Output: ${system.outputLatencySec !== undefined ? `${(system.outputLatencySec * 1000).toFixed(1)} ms` : '—'}`
      : 'Not reported by this browser'

  return (
    <PanelLayout title="Settings" subtitle="Audio Output and Device Info">
      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Audio Output</h2>
          {!canSelectSink ? (
            <p className="text-sm text-slate-400">
              Audio output selection is not supported in this browser (e.g. Safari). Audio uses the default system
              output.
            </p>
          ) : (
            <>
              {permissionHint ? (
                <p className="mb-2 text-sm text-amber-200/90">
                  Device names are hidden until the browser has permission. Use the button below once if labels show as
                  &quot;Audio device&quot; only.
                </p>
              ) : null}
              <div className="mb-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void ensureReady().then(() => refreshDevices())
                  }}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:border-slate-500"
                >
                  Refresh list
                </button>
                <button
                  type="button"
                  onClick={() => requestMicForLabels()}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:border-slate-500"
                >
                  Allow labels (mic prompt)
                </button>
              </div>
              <label htmlFor="audio-output-select" className="mb-1 block text-sm text-slate-400">
                Device
              </label>
              <select
                id="audio-output-select"
                className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2.5 text-base text-slate-100"
                value={selectedDeviceId ?? ''}
                onChange={(e) => onSelectDevice(e.target.value)}
              >
                <option value="">Default</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Audio device'}
                  </option>
                ))}
              </select>
              {sinkError ? <p className="mt-2 text-sm text-red-400">{sinkError}</p> : null}
            </>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">System info</h2>
          <dl className="space-y-2 text-sm text-slate-300">
            <div className="flex justify-between gap-4 border-b border-slate-800 py-2">
              <dt className="text-slate-500">Browser</dt>
              <dd className="text-right font-medium text-slate-200">{system.browser}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-slate-800 py-2">
              <dt className="text-slate-500">OS (approx.)</dt>
              <dd className="text-right font-medium text-slate-200">{system.os}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-slate-800 py-2">
              <dt className="text-slate-500">Device type</dt>
              <dd className="text-right font-medium text-slate-200">{system.deviceType}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-slate-800 py-2">
              <dt className="text-slate-500">Language</dt>
              <dd className="text-right font-medium text-slate-200">{system.language || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-slate-800 py-2">
              <dt className="text-slate-500">Sample rate</dt>
              <dd className="text-right font-medium text-slate-200">
                {system.sampleRate != null ? `${system.sampleRate} Hz` : '— (init audio first)'}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-slate-800 py-2">
              <dt className="text-slate-500">Latency (estimated)</dt>
              <dd className="max-w-[60%] text-right text-slate-200">{latencyLine}</dd>
            </div>
            <div className="pt-2">
              <dt className="mb-1 text-slate-500">User agent (short)</dt>
              <dd className="break-all font-mono text-xs text-slate-400">{system.userAgentShort || '—'}</dd>
            </div>
            <div className="pt-2">
              <dt className="mb-1 text-slate-500">Platform</dt>
              <dd className="font-mono text-xs text-slate-400">{system.platform || '—'}</dd>
            </div>
          </dl>
        </section>
      </div>
    </PanelLayout>
  )
}
