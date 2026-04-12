import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'

type Props = {
  leftDb: number | null
  rightDb: number | null
}

const MIN_DB = -30
const MAX_DB = 0

const DECAY = 0.02
const CLIP_HOLD_MS = 300
/** Lissage visuel des barres (0–1) ; pics et clip restent sur la mesure instantanée. */
const LEVEL_SMOOTHING = 0.2

const GRAD_TICKS = [-30, -20, -10, -6, -3, 0] as const

function normalize(db: number | null): number {
  if (db === null) return 0
  return Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB)))
}

function tickPct(db: number): number {
  return ((db - MIN_DB) / (MAX_DB - MIN_DB)) * 100
}

function VuChannelBar({ fillNorm, peak }: { fillNorm: number; peak: number }) {
  const w = Math.min(1, Math.max(0, fillNorm))
  return (
    <div
      className="relative h-2 w-full overflow-hidden rounded-sm bg-slate-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)] ring-1 ring-black/30"
      style={{
        backgroundImage:
          'linear-gradient(to right, transparent 0%, transparent calc(100% - 1px), rgba(255,255,255,0.05) 100%)',
      }}
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 right-0">
        {GRAD_TICKS.map((d) => (
          <div
            key={d}
            className="absolute bottom-0 top-0 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent"
            style={{ left: `${tickPct(d)}%`, transform: 'translateX(-50%)' }}
          />
        ))}
      </div>
      <div
        className="relative z-10 h-full"
        style={{
          width: `${w * 100}%`,
          background: 'linear-gradient(to right, #84cc16, #a3e635 35%, #eab308 72%, #f59e0b 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
        }}
      />
      <div
        className="pointer-events-none absolute top-0 z-20 h-full w-[2px] bg-white shadow-[0_0_4px_rgba(255,255,255,0.5)]"
        style={{ left: `${peak * 100}%`, transform: 'translateX(-50%)' }}
      />
    </div>
  )
}

function ScaleLabels() {
  return (
    <div className="relative h-3.5 w-full">
      {GRAD_TICKS.map((d) => (
        <span
          key={d}
          className="absolute text-[10px] text-slate-500"
          style={{ left: `${tickPct(d)}%`, transform: 'translateX(-50%)' }}
        >
          {d}
        </span>
      ))}
    </div>
  )
}

function ChannelRow({
  channel,
  db,
  peak,
  fillNorm,
}: {
  channel: string
  db: number | null
  peak: number
  fillNorm: number
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 shrink-0 text-[10px] text-slate-500">{channel}</span>
      <div className="relative min-w-0 flex-1">
        <VuChannelBar fillNorm={fillNorm} peak={peak} />
      </div>
      <span className="w-10 shrink-0 text-right text-[10px] text-slate-200 tabular-nums">
        {db !== null ? db.toFixed(1) : '—'}
      </span>
    </div>
  )
}

export function MasterLevelMeter({ leftDb, rightDb }: Props) {
  const [peakL, setPeakL] = useState(0)
  const [peakR, setPeakR] = useState(0)
  const [smoothL, setSmoothL] = useState(0)
  const [smoothR, setSmoothR] = useState(0)
  const [clipLatch, setClipLatch] = useState(false)

  const leftDbRef = useRef(leftDb)
  const rightDbRef = useRef(rightDb)
  leftDbRef.current = leftDb
  rightDbRef.current = rightDb

  const lastClipAtRef = useRef(0)

  useEffect(() => {
    let id = 0
    const tick = () => {
      const ld = leftDbRef.current
      const rd = rightDbRef.current
      const normalizedL = normalize(ld)
      const normalizedR = normalize(rd)

      setPeakL((prev) => Math.max(normalizedL, prev - DECAY))
      setPeakR((prev) => Math.max(normalizedR, prev - DECAY))

      setSmoothL((prev) => prev + (normalizedL - prev) * LEVEL_SMOOTHING)
      setSmoothR((prev) => prev + (normalizedR - prev) * LEVEL_SMOOTHING)

      const isClippingL = (ld ?? -100) > -1
      const isClippingR = (rd ?? -100) > -1
      if (isClippingL || isClippingR) {
        lastClipAtRef.current = performance.now()
      }
      const showClip = performance.now() - lastClipAtRef.current < CLIP_HOLD_MS
      setClipLatch((prev) => (prev === showClip ? prev : showClip))

      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])

  const title =
    leftDb !== null || rightDb !== null
      ? `L ${leftDb !== null ? `${leftDb.toFixed(1)} dBFS` : '—'} · R ${rightDb !== null ? `${rightDb.toFixed(1)} dBFS` : '—'}`
      : undefined

  return (
    <div className="rounded-xl border border-slate-800 bg-panel-800 p-3" title={title}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs uppercase tracking-normal text-slate-500">Master Level</div>
          <div
            className={clsx(
              'text-[10px] font-bold',
              clipLatch ? 'text-red-500' : 'text-slate-500',
            )}
          >
            CLIP
          </div>
        </div>

        <div className="space-y-2">
          <ChannelRow channel="L" db={leftDb} peak={peakL} fillNorm={smoothL} />
          <ChannelRow channel="R" db={rightDb} peak={peakR} fillNorm={smoothR} />
        </div>

        <div className="mt-1 flex gap-2">
          <span className="w-3 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <ScaleLabels />
            <div className="mt-1 text-center text-[10px] text-slate-500">dBFS</div>
          </div>
          <span className="w-10 shrink-0" aria-hidden />
        </div>
      </div>
    </div>
  )
}
