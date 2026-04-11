import { useId } from 'react'

type Props = {
  names: string[]
}

export function ActiveSounds({ names }: Props) {
  const headingId = `active-sounds-${useId().replace(/:/g, '')}`
  return (
    <div className="rounded-xl border border-slate-800 bg-panel-900 p-3">
      <div className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wider text-slate-500" id={headingId}>
        Active sounds
      </div>
      {names.length === 0 ? (
        <p className="text-sm text-slate-400">None</p>
      ) : (
        <ul
          className="flex flex-wrap gap-2"
          aria-labelledby={headingId}
          aria-live="polite"
          aria-atomic="true"
        >
          {names.map((name) => (
            <li key={name} className="list-none">
              <span className="inline-flex rounded-full border-2 border-lime-400/80 bg-lime-500/15 px-2 py-1 text-xs font-medium text-lime-200">
                {name}
              </span>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  )
}
