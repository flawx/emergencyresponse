import { motion } from 'framer-motion'
import { useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import clsx from 'clsx'

type HoldEvent = PointerEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>

type Props = {
  label: string
  icon?: ReactNode
  active?: boolean
  hold?: boolean
  danger?: boolean
  disabled?: boolean
  title?: string
  onClick?: () => void
  onHoldStart?: (e: HoldEvent) => void
  onHoldEnd?: (e?: HoldEvent) => void
}

export function SirenButton({
  label,
  icon,
  active = false,
  hold = false,
  danger = false,
  disabled = false,
  title,
  onClick,
  onHoldStart,
  onHoldEnd,
}: Props) {
  const descId = useId()
  const keyboardHoldRef = useRef(false)

  const ariaLabel = danger ? 'Stop all sounds' : hold ? `${label}, siren, hold to play` : `${label} siren`

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || !hold || !onHoldStart) return
    if (e.key !== ' ' && e.key !== 'Enter') return
    if (e.repeat) return
    e.preventDefault()
    if (keyboardHoldRef.current) return
    keyboardHoldRef.current = true
    onHoldStart(e)
  }

  const handleKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!hold || !onHoldEnd || !keyboardHoldRef.current) return
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    keyboardHoldRef.current = false
    onHoldEnd(e)
  }

  const handleBlur = () => {
    if (keyboardHoldRef.current && hold && onHoldEnd) {
      keyboardHoldRef.current = false
      onHoldEnd()
    }
  }

  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.98 }}
      type="button"
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={danger ? undefined : active}
      aria-describedby={title ? descId : undefined}
      data-active={active ? 'true' : 'false'}
      onClick={onClick}
      onPointerDown={disabled ? undefined : onHoldStart}
      onPointerUp={disabled ? undefined : onHoldEnd}
      onPointerCancel={disabled ? undefined : onHoldEnd}
      onPointerLeave={disabled ? undefined : onHoldEnd}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={handleBlur}
      className={clsx(
        'relative min-h-16 w-full select-none rounded-xl border px-4 py-3 text-left text-base font-semibold transition active:scale-[0.98] disabled:active:scale-100',
        danger
          ? 'border-red-400 bg-red-600 text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.25),0_0_10px_rgba(239,68,68,0.7)] ring-2 ring-red-400 hover:bg-red-500 disabled:hover:bg-red-600'
          : [
              'border-slate-700 bg-slate-900 text-slate-50 shadow-inner',
              active
                ? 'border-lime-400 bg-lime-500/25 text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.35),0_0_8px_rgba(132,204,22,0.6)] ring-2 ring-lime-400'
                : 'hover:border-slate-500 hover:bg-slate-900/95',
            ],
        disabled && 'cursor-not-allowed border-slate-700 opacity-55 contrast-more:opacity-70',
      )}
    >
      {title ? (
        <span id={descId} className="sr-only">
          {title}
        </span>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </div>
        {hold ? (
          <span
            className="rounded-md border border-slate-500 bg-slate-900/80 px-2 py-1 text-xs font-medium text-slate-200"
            aria-hidden
          >
            HOLD
          </span>
        ) : null}
      </div>
      <span className="pointer-events-none absolute right-3 top-3 size-2" aria-hidden>
        <span
          className={clsx(
            'relative block size-2 rounded-full border border-slate-900/50',
            'shadow-[0_0_8px_currentColor,0_0_16px_currentColor]',
            'before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-current before:opacity-30 before:blur-sm before:content-[""]',
            active
              ? 'bg-lime-400 text-lime-300 motion-safe:animate-pulse'
              : 'bg-slate-600 text-slate-500',
          )}
        />
      </span>
    </motion.button>
  )
}
