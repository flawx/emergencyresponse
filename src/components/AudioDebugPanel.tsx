type DebugVoice = {
  frequencyHz: number
  holdActive: boolean
  modulation: string
}

type Props = {
  voices: Record<string, DebugVoice>
  logs: string[]
}

export function AudioDebugPanel({ voices, logs }: Props) {
  return (
    <div className="rounded-xl border border-amber-700/60 bg-amber-950/20 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-amber-300">Debug Audio (temporaire)</div>
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
