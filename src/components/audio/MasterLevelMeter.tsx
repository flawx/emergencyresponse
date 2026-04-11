type Props = {
  rms: number | null
  db: number | null
}

const MIN_DB = -30
const MAX_DB = 0

export function MasterLevelMeter({ rms, db }: Props) {
  const normalized =
    db !== null ? Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB))) : 0

  return (
    <div
      className="rounded-xl border border-slate-800 bg-panel-800 p-3"
      title={rms !== null ? `RMS ${rms.toFixed(4)} (post-limiter)` : undefined}
    >
      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-slate-500">Master level</div>
        <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
          <div
            className="h-full transition-all duration-75"
            style={{
              width: `${normalized * 100}%`,
              background: 'linear-gradient(to right, #22c55e, #f59e0b, #ef4444)',
            }}
          />
        </div>
        <div className="text-xs text-slate-400">
          {db !== null ? `${db.toFixed(1)} dBFS` : '—'}
        </div>
      </div>
    </div>
  )
}
