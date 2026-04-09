type Props = {
  value: number
  onChange: (value: number) => void
}

export function VolumeSlider({ value, onChange }: Props) {
  return (
    <div className="rounded-xl border border-slate-800 bg-panel-900 p-3">
      <label className="mb-2 block text-xs uppercase tracking-wide text-slate-400">Master Volume</label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan-400"
      />
    </div>
  )
}
