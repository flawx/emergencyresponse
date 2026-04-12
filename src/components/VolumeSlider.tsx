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
  const fillPct = `${value * 100}%`

  return (
    <div className="rounded-xl border border-slate-800 bg-panel-800 p-3">
      <div className="flex flex-col gap-2">
        <label
          id={labelId}
          htmlFor={id}
          className="block text-xs uppercase tracking-normal text-slate-500"
        >
          Master Volume
        </label>
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1">
          <input
            id={id}
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={value}
            aria-labelledby={labelId}
            aria-valuetext={`${pct} percent`}
            onChange={(e) => onChange(Number(e.target.value))}
            className="volume-slider col-start-1 row-start-1 w-full min-w-0"
            style={{ ['--volume-fill' as string]: fillPct }}
          />
          <span className="col-start-2 row-start-1 w-12 shrink-0 text-right text-sm text-slate-200 tabular-nums">
            {(value * 100).toFixed(0)}%
          </span>
          <div className="col-start-1 row-start-2 mt-1 flex justify-between text-[10px] text-slate-500">
            <span>0</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </div>
        </div>
      </div>
    </div>
  )
}
