type DebugVoice = {
  frequencyHz: number
  holdActive: boolean
  modulation: string
}

type Props = {
  voices: Record<string, DebugVoice>
  logs: string[]
  /** RMS linéaire post-limiteur (analyseur produit), null si indisponible. */
  masterPostLimiterRms: number | null
  /** dBFS approximatif : 20·log10(RMS), null si silence / indisponible. */
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
    <div className="rounded-xl border border-amber-700/60 bg-amber-950/20 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-amber-300">Debug Audio (temporaire)</div>
      <div className="mb-2 rounded bg-black/20 px-2 py-1.5 font-mono text-[11px] text-amber-200">
        <span className="text-amber-400/90">Post-limiteur (master)</span>
        <span className="mx-2 text-amber-600">|</span>
        RMS {rmsLabel}
        <span className="mx-2 text-amber-600">|</span>
        {dbLabel}
      </div>
      <div className="space-y-1 text-xs text-amber-100">
        {Object.entries(voices).length === 0 ? (
          <div>Aucune voix active</div>
        ) : (
          Object.entries(voices).map(([id, v]) => (
            <div key={id} className="rounded bg-black/20 px-2 py-1">
              {id} | {v.frequencyHz.toFixed(1)} Hz | HOLD: {v.holdActive ? 'ON' : 'OFF'} | {v.modulation}
            </div>
          ))
        )}
      </div>
      <div className="mt-2 max-h-24 overflow-auto rounded bg-black/20 p-2 text-[11px] text-amber-200">
        {logs.length === 0 ? <div>Pas de logs</div> : logs.map((line, idx) => <div key={`${idx}-${line}`}>{line}</div>)}
      </div>
    </div>
  )
}
