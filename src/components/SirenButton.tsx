import { motion } from 'framer-motion'
import clsx from 'clsx'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

type HoldEvent = PointerEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>

const HOLD_HINT_KEY = 'er_hold_onboarding_done'
const HOLD_HINT_EVENT = 'er-dismiss-hold-hint'

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
  const [isHolding, setIsHolding] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)

  const dismissHoldHint = useCallback(() => {
    if (typeof window === 'undefined') return
    sessionStorage.setItem(HOLD_HINT_KEY, '1')
    setHintVisible(false)
    window.dispatchEvent(new CustomEvent(HOLD_HINT_EVENT))
  }, [])

  useEffect(() => {
    if (!hold) return
    const onDismiss = () => setHintVisible(false)
    window.addEventListener(HOLD_HINT_EVENT, onDismiss)
    return () => window.removeEventListener(HOLD_HINT_EVENT, onDismiss)
  }, [hold])

  useEffect(() => {
    if (!hold || typeof window === 'undefined') return
    if (sessionStorage.getItem(HOLD_HINT_KEY) === '1') return
    setHintVisible(true)
  }, [hold])

  useEffect(() => {
    if (!hintVisible) return
    const t = window.setTimeout(() => dismissHoldHint(), 2500)
    return () => window.clearTimeout(t)
  }, [hintVisible, dismissHoldHint])

  const ariaLabel = danger ? 'Stop all sounds' : hold ? `${label}, siren, hold to play` : `${label} siren`

  const holdHelpTitle =
    hold && !disabled ? [title, 'HOLD to activate'].filter(Boolean).join(' · ') : title

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || !hold || !onHoldStart) return
    if (e.key !== ' ' && e.key !== 'Enter') return
    if (e.repeat) return
    e.preventDefault()
    if (keyboardHoldRef.current) return
    keyboardHoldRef.current = true
    setIsHolding(true)
    dismissHoldHint()
    onHoldStart(e)
  }

  const handleKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!hold || !onHoldEnd || !keyboardHoldRef.current) return
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    keyboardHoldRef.current = false
    setIsHolding(false)
    onHoldEnd(e)
  }

  const handleBlur = () => {
    if (keyboardHoldRef.current && hold && onHoldEnd) {
      keyboardHoldRef.current = false
      setIsHolding(false)
      onHoldEnd()
    }
  }

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!hold || !onHoldStart || disabled) return
    setIsHolding(true)
    dismissHoldHint()
    onHoldStart(e)
  }

  const handlePointerEnd = (e?: PointerEvent<HTMLButtonElement>) => {
    if (!hold || !onHoldEnd) return
    setIsHolding(false)
    onHoldEnd(e)
  }

  const pulseHold = hold && isHolding && !disabled && !danger

  return (
    <motion.button
      animate={pulseHold ? { scale: [1, 1.01, 1] } : { scale: 1 }}
      transition={{ duration: 1.2, repeat: pulseHold ? Infinity : 0, ease: 'easeInOut' }}
      whileTap={disabled || pulseHold ? undefined : { scale: 0.98 }}
      type="button"
      disabled={disabled}
      title={holdHelpTitle}
      aria-label={ariaLabel}
      aria-pressed={danger ? undefined : active}
      aria-describedby={title ? descId : undefined}
      data-active={active ? 'true' : 'false'}
      onClick={onClick}
      onPointerDown={disabled ? undefined : hold && onHoldStart ? handlePointerDown : undefined}
      onPointerUp={disabled ? undefined : hold && onHoldEnd ? (e) => handlePointerEnd(e) : undefined}
      onPointerCancel={disabled ? undefined : hold && onHoldEnd ? (e) => handlePointerEnd(e) : undefined}
      onPointerLeave={disabled ? undefined : hold && onHoldEnd ? (e) => handlePointerEnd(e) : undefined}
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
                ? isHolding
                  ? 'border-lime-400 bg-lime-500/25 text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.35),0_0_8px_rgba(132,204,22,0.6)] ring-2 ring-lime-300'
                  : 'border-lime-400 bg-lime-500/25 text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.35),0_0_8px_rgba(132,204,22,0.6)] ring-2 ring-lime-400'
                : isHolding
                  ? 'border-lime-400/90 bg-lime-500/15 ring-2 ring-lime-300'
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
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            <span className="truncate">{label}</span>
          </div>
          {hold && hintVisible ? (
            <span className="text-[10px] font-medium text-slate-500">Press and hold</span>
          ) : null}
        </div>
        {hold ? (
          <span
            className="shrink-0 rounded-md border border-slate-500 bg-slate-900/80 px-2 py-1 text-xs font-medium text-slate-200"
            aria-hidden
          >
            HOLD
          </span>
        ) : null}
      </div>
      {hold ? (
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden rounded-b-xl bg-slate-950/60"
          aria-hidden
        >
          <div
            className="h-full bg-lime-400 transition-[width] duration-150 ease-out"
            style={{ width: isHolding ? '100%' : '0%' }}
          />
        </div>
      ) : null}
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
