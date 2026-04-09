type Props = {
  names: string[]
}

export function ActiveSounds({ names }: Props) {
  return (
    <div className="rounded-xl border border-slate-800 bg-panel-900 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Active Sounds</div>
      {names.length === 0 ? (
        <p className="text-sm text-slate-500">None</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {names.map((name) => (
            <span key={name} className="rounded-full border border-lime-400/60 bg-lime-500/10 px-2 py-1 text-xs text-lime-300">
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
