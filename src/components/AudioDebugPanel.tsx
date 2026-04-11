type DebugVoice = {
  frequencyHz: number
  holdActive: boolean
  modulation: string
}

type Props = {
  voices: Record<string, DebugVoice>
  logs: string[]
  /** Linear RMS after master limiter (analyser tap), null if unavailable. */
  masterPostLimiterRms: number | null
  /** Approximate dBFS: 20·log10(RMS), null if silent / unavailable. */
  masterPostLimiterDbFs: number | null
}

export function AudioDebugPanel({
  voices,
  logs,
  masterPostLimiterRms,
  masterPostLimiterDbFs,
}: Props) {
  const rmsLabel =
    masterPostLimiterRms === null ? '—' : masterPostLimiterRms.toFixed(4)
  const dbLabel =
    masterPostLimiterDbFs === null ? '—' : `${masterPostLimiterDbFs.toFixed(2)} dBFS`

  return (
    <div className="rounded-xl border border-slate-800 bg-panel-900 p-3">
      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-slate-500">Audio debug</div>
        <div className="rounded-lg bg-slate-950/80 px-2 py-2 font-mono text-[11px] text-slate-300">
          <span className="text-slate-500">Master post-limiter</span>
          <span className="mx-2 text-slate-600">|</span>
          RMS {rmsLabel}
          <span className="mx-2 text-slate-600">|</span>
          {dbLabel}
        </div>
        <div className="space-y-1 text-xs text-slate-400">
          {Object.entries(voices).length === 0 ? (
            <div>No active sounds</div>
          ) : (
            Object.entries(voices).map(([id, v]) => (
              <div key={id} className="rounded-lg bg-slate-950/80 px-2 py-1.5">
                {id} | {v.frequencyHz.toFixed(1)} Hz | HOLD: {v.holdActive ? 'ON' : 'OFF'} | {v.modulation}
              </div>
            ))
          )}
        </div>
        <div className="max-h-24 overflow-auto rounded-lg bg-slate-950/80 p-2 text-[11px] text-slate-400">
          {logs.length === 0 ? <div>No logs</div> : logs.map((line, idx) => <div key={`${idx}-${line}`}>{line}</div>)}
        </div>
      </div>
    </div>
  )
}
