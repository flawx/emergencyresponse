import { motion } from 'framer-motion'
import clsx from 'clsx'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

type HoldEvent = PointerEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>

const HOLD_HINT_KEY = 'er_hold_onboarding_done'
const HOLD_HINT_EVENT = 'er-dismiss-hold-hint'

type SplitLabel = { line1: string; line2: string }

type Props = {
  label: string
  /** Libellé sur deux lignes (ex. MAN + HOLD), sans troncature. */
  splitLabel?: SplitLabel
  icon?: ReactNode
  active?: boolean
  hold?: boolean
  danger?: boolean
  disabled?: boolean
  /** Sélecteur de mode exclusif : actif mis en avant, inactifs atténués. */
  exclusiveSlot?: boolean
  /** Légende sous le libellé (ex. Continuous / Fast). */
  caption?: string
  title?: string
  onClick?: () => void
  onHoldStart?: (e: HoldEvent) => void
  onHoldEnd?: (e?: HoldEvent) => void
}

export function SirenButton({
  label,
  splitLabel,
  icon,
  active = false,
  hold = false,
  danger = false,
  disabled = false,
  exclusiveSlot = false,
  caption,
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

  const labelForA11y = splitLabel ? `${splitLabel.line1} ${splitLabel.line2}` : label
  const ariaLabel = danger
    ? 'Stop all sounds'
    : hold
      ? `${labelForA11y}, siren, hold to play`
      : `${labelForA11y} siren`

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
        'relative w-full min-w-0 select-none rounded-xl border px-4 font-semibold tracking-normal transition active:scale-[0.98] disabled:active:scale-100',
        splitLabel
          ? 'min-h-[4.5rem] py-3 text-sm md:min-h-16'
          : 'min-h-16 py-2 text-left text-base md:min-h-14 md:py-1.5 md:text-sm',
        danger
          ? 'border-red-400 bg-red-600 text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.25),0_0_10px_rgba(239,68,68,0.7)] ring-2 ring-red-400 hover:bg-red-500 disabled:hover:bg-red-600'
          : exclusiveSlot
            ? [
                active
                  ? isHolding
                    ? 'border-lime-300 bg-lime-400/35 text-white shadow-[inset_0_2px_6px_rgba(0,0,0,0.3),0_0_14px_rgba(132,204,22,0.55),0_0_28px_rgba(132,204,22,0.35)] ring-[3px] ring-lime-300/95'
                    : 'border-lime-300 bg-lime-400/35 text-white shadow-[inset_0_2px_6px_rgba(0,0,0,0.28),0_0_18px_rgba(132,204,22,0.65),0_0_32px_rgba(132,204,22,0.4)] ring-4 ring-lime-300/90'
                  : isHolding
                    ? 'border-lime-400/70 bg-lime-500/10 text-slate-200 ring-2 ring-lime-400/50'
                    : 'border-slate-800/95 bg-slate-950/70 text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ring-1 ring-slate-800/80 hover:border-slate-600 hover:bg-slate-900/85 hover:text-slate-300',
              ]
            : [
                'border-slate-700 bg-slate-900 text-slate-200 shadow-inner',
                active
                  ? isHolding
                    ? 'border-lime-400 bg-lime-500/25 text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.35),0_0_8px_rgba(132,204,22,0.6)] ring-2 ring-lime-300'
                    : 'border-lime-400 bg-lime-500/25 text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.35),0_0_8px_rgba(132,204,22,0.6)] ring-2 ring-lime-400'
                  : isHolding
                    ? 'border-lime-400/90 bg-lime-500/15 ring-2 ring-lime-300'
                    : 'hover:border-slate-500 hover:bg-slate-900/95',
              ],
        disabled && 'cursor-not-allowed border-slate-700 opacity-55 contrast-more:opacity-70',
        splitLabel && 'text-center',
      )}
    >
      {title ? (
        <span id={descId} className="sr-only">
          {title}
        </span>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div
          className={clsx(
            'flex min-w-0 flex-1 flex-col gap-0.5',
            splitLabel && 'items-center justify-center text-center',
          )}
        >
          {splitLabel ? (
            <div className="flex w-full items-center justify-center gap-2">
              {icon}
              <span className="flex flex-col items-center leading-tight whitespace-normal">
                <span className="font-semibold">{splitLabel.line1}</span>
                <span
                  className={clsx(
                    'font-semibold',
                    active ? 'text-white' : exclusiveSlot ? 'text-slate-500' : 'text-slate-300',
                  )}
                >
                  {splitLabel.line2}
                </span>
              </span>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              {icon}
              <span className="truncate">{label}</span>
            </div>
          )}
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
      {caption ? (
        <p className="pointer-events-none mt-1 text-center text-xs leading-snug text-slate-500">{caption}</p>
      ) : null}
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
              ? exclusiveSlot
                ? 'bg-lime-300 text-lime-200 shadow-[0_0_10px_rgba(190,242,100,0.95),0_0_22px_rgba(132,204,22,0.75),0_0_36px_rgba(132,204,22,0.45)] motion-safe:animate-pulse'
                : 'bg-lime-400 text-lime-300 motion-safe:animate-pulse'
              : exclusiveSlot
                ? 'bg-slate-700 text-slate-600 shadow-none'
                : 'bg-slate-600 text-slate-500',
          )}
        />
      </span>
    </motion.button>
  )
}
