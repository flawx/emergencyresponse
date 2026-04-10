import { motion } from 'framer-motion'
import type { PointerEvent } from 'react'
import clsx from 'clsx'

type Props = {
  label: string
  active?: boolean
  hold?: boolean
  danger?: boolean
  disabled?: boolean
  title?: string
  onClick?: () => void
  onHoldStart?: (e: PointerEvent<HTMLButtonElement>) => void
  onHoldEnd?: (e: PointerEvent<HTMLButtonElement>) => void
}

export function SirenButton({
  label,
  active = false,
  hold = false,
  danger = false,
  disabled = false,
  title,
  onClick,
  onHoldStart,
  onHoldEnd,
}: Props) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.96 }}
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      onPointerDown={disabled ? undefined : onHoldStart}
      onPointerUp={disabled ? undefined : onHoldEnd}
      onPointerCancel={disabled ? undefined : onHoldEnd}
      onPointerLeave={disabled ? undefined : onHoldEnd}
      className={clsx(
        'relative min-h-16 w-full select-none rounded-xl border px-4 py-3 text-left text-base font-semibold tracking-wide transition',
        danger
          ? 'border-red-400 bg-red-600/80 text-white shadow-danger'
          : 'border-slate-700 bg-panel-800 text-slate-100',
        active && !danger && 'border-lime-400 bg-lime-500/20 shadow-led',
        disabled && 'cursor-not-allowed opacity-40',
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
