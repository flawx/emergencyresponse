import { useId } from 'react'

type Props = {
  value: number
  onChange: (value: number) => void
}

export function VolumeSlider({ value, onChange }: Props) {
  const uid = useId()
  const id = `master-volume-${uid.replace(/:/g, '')}`
  const labelId = `${id}-label`
  const pct = Math.round(value * 100)
  return (
    <div className="rounded-xl border border-slate-800 bg-panel-900 p-3">
      <label
        id={labelId}
        htmlFor={id}
        className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-300"
      >
        Master volume
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        aria-labelledby={labelId}
        aria-valuetext={`${pct} percent`}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan-400"
      />
    </div>
  )
}
