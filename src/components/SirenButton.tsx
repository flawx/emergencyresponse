import { motion } from 'framer-motion'
import type { PointerEvent } from 'react'
import clsx from 'clsx'

type Props = {
  label: string
  active?: boolean
  hold?: boolean
  danger?: boolean
  onClick?: () => void
  onHoldStart?: (e: PointerEvent<HTMLButtonElement>) => void
  onHoldEnd?: (e: PointerEvent<HTMLButtonElement>) => void
}

export function SirenButton({
  label,
  active = false,
  hold = false,
  danger = false,
  onClick,
  onHoldStart,
  onHoldEnd,
}: Props) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      type="button"
      onClick={onClick}
      onPointerDown={onHoldStart}
      onPointerUp={onHoldEnd}
      onPointerCancel={onHoldEnd}
      onPointerLeave={onHoldEnd}
      className={clsx(
        'relative min-h-16 w-full select-none rounded-xl border px-4 py-3 text-left text-base font-semibold tracking-wide transition',
        danger
          ? 'border-red-400 bg-red-600/80 text-white shadow-danger'
          : 'border-slate-700 bg-panel-800 text-slate-100',
        active && !danger && 'border-lime-400 bg-lime-500/20 shadow-led',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        {hold ? (
          <span className="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-300">HOLD</span>
        ) : null}
      </div>
      <span
        className={clsx(
          'absolute right-3 top-3 h-2.5 w-2.5 rounded-full',
          active ? 'bg-lime-400 shadow-led' : 'bg-slate-600',
        )}
      />
    </motion.button>
  )
}
