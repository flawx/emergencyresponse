import { motion } from 'framer-motion'
import { useId, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import clsx from 'clsx'

type HoldEvent = PointerEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>

type Props = {
  label: string
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
      whileTap={disabled ? undefined : { scale: 0.96 }}
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
        'relative min-h-16 w-full select-none rounded-xl border-2 px-4 py-3 text-left text-base font-semibold tracking-wide transition',
        danger
          ? 'border-red-400 bg-red-600 text-white shadow-danger'
          : 'border-slate-600 bg-panel-800 text-slate-50',
        active &&
          !danger &&
          'border-lime-400 bg-lime-500/25 text-white shadow-led ring-2 ring-lime-400/90 ring-offset-2 ring-offset-panel-950',
        !active && !danger && 'hover:border-slate-500',
        disabled && 'cursor-not-allowed border-slate-700 opacity-55 contrast-more:opacity-70',
      )}
    >
      {title ? (
        <span id={descId} className="sr-only">
          {title}
        </span>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <span className={clsx(active && !danger && 'font-bold')}>{label}</span>
        {hold ? (
          <span
            className="rounded-md border border-slate-500 bg-slate-900/80 px-2 py-1 text-xs font-medium text-slate-200"
            aria-hidden
          >
            HOLD
          </span>
        ) : null}
      </div>
      <span
        className={clsx(
          'absolute right-3 top-3 h-2.5 w-2.5 rounded-full border border-slate-900/50',
          active ? 'bg-lime-400 shadow-led motion-safe:animate-pulse' : 'bg-slate-500',
        )}
        aria-hidden
      />
    </motion.button>
  )
}
