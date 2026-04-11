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
    <div className="rounded-xl border border-slate-800 bg-panel-800 p-3">
      <div className="flex flex-col gap-2">
      <label
        id={labelId}
        htmlFor={id}
        className="block text-xs uppercase tracking-wider text-slate-500"
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
    </div>
  )
}
