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
  /**
   * Long press (ms) → momentary play (store) ; court tap → onClick inchangé (ex. 180 ms).
   * Ignoré si `hold` (corne / MAN moteur).
   */
  manualHoldArmMs?: number
  onManualHoldArm?: () => void
  onManualHoldRelease?: () => void
  manualHoldActive?: boolean
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
  manualHoldArmMs,
  onManualHoldArm,
  onManualHoldRelease,
  manualHoldActive = false,
}: Props) {
  const descId = useId()
  const keyboardHoldRef = useRef(false)
  const [isHolding, setIsHolding] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const manualTimerRef = useRef(0)
  const manualHoldingRef = useRef(false)
  const suppressClickAfterManualRef = useRef(false)
  /** Doigt enfoncé sur un bouton « manual hold » (feedback immédiat, avant confirmation). */
  const [isPressing, setIsPressing] = useState(false)
  const manualPressActiveRef = useRef(false)
  const [armBarFill, setArmBarFill] = useState(false)

  const clearManualTimer = useCallback(() => {
    if (manualTimerRef.current) {
      window.clearTimeout(manualTimerRef.current)
      manualTimerRef.current = 0
    }
  }, [])

  useEffect(() => () => clearManualTimer(), [clearManualTimer])

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

  const startManualArm = (e: PointerEvent<HTMLButtonElement>) => {
    if (!manualHoldArmMs || !onManualHoldArm || disabled || danger || hold) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    clearManualTimer()
    manualPressActiveRef.current = true
    setIsPressing(true)
    setArmBarFill(false)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!manualPressActiveRef.current) return
        setArmBarFill(true)
      })
    })
    manualTimerRef.current = window.setTimeout(() => {
      manualTimerRef.current = 0
      manualHoldingRef.current = true
      suppressClickAfterManualRef.current = true
      onManualHoldArm()
    }, manualHoldArmMs)
  }

  const endManualArm = (e?: PointerEvent<HTMLButtonElement>) => {
    if (!manualHoldArmMs || hold) return
    manualPressActiveRef.current = false
    setIsPressing(false)
    setArmBarFill(false)
    clearManualTimer()
    if (manualHoldingRef.current) {
      manualHoldingRef.current = false
      onManualHoldRelease?.()
    }
    if (e && e.currentTarget?.releasePointerCapture) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      } catch {
        // ignore
      }
    }
  }

  const onPointerDownCombined = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (hold && onHoldStart) handlePointerDown(e)
    if (!hold) startManualArm(e)
  }

  const onPointerEndCombined = (e: PointerEvent<HTMLButtonElement>) => {
    if (hold && onHoldEnd) handlePointerEnd(e)
    if (!hold) endManualArm(e)
  }

  const handleButtonClick = () => {
    if (manualHoldArmMs && suppressClickAfterManualRef.current) {
      suppressClickAfterManualRef.current = false
      return
    }
    onClick?.()
  }

  const pulseHold = hold && isHolding && !disabled && !danger
  const manualHoldVisual = manualHoldActive && !hold && !danger
  const manualArmingSquash =
    !!manualHoldArmMs && !!onManualHoldArm && !hold && !danger && isPressing && !manualHoldActive

  return (
    <motion.button
      animate={
        pulseHold
          ? { scale: [1, 1.01, 1] }
          : manualHoldVisual
            ? { scale: 1.02 }
            : manualArmingSquash
              ? { scale: 0.97 }
              : { scale: 1 }
      }
      transition={
        pulseHold
          ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
          : manualArmingSquash || manualHoldVisual
            ? { duration: 0.12, ease: 'easeOut' }
            : exclusiveSlot
              ? { duration: 0.15, ease: 'easeOut' }
              : { duration: 0.2, ease: 'easeOut' }
      }
      whileTap={
        disabled || pulseHold || manualHoldVisual || manualArmingSquash
          ? undefined
          : { scale: 0.98 }
      }
      type="button"
      disabled={disabled}
      title={holdHelpTitle}
      aria-label={ariaLabel}
      aria-pressed={danger ? undefined : active}
      aria-describedby={title ? descId : undefined}
      data-active={active ? 'true' : 'false'}
      onClick={handleButtonClick}
      onPointerDown={
        disabled
          ? undefined
          : hold && onHoldStart
            ? onPointerDownCombined
            : manualHoldArmMs && onManualHoldArm
              ? onPointerDownCombined
              : undefined
      }
      onPointerUp={
        disabled
          ? undefined
          : hold && onHoldEnd
            ? onPointerEndCombined
            : manualHoldArmMs && onManualHoldArm
              ? onPointerEndCombined
              : undefined
      }
      onPointerCancel={
        disabled
          ? undefined
          : hold && onHoldEnd
            ? onPointerEndCombined
            : manualHoldArmMs && onManualHoldArm
              ? onPointerEndCombined
              : undefined
      }
      onPointerLeave={
        disabled
          ? undefined
          : hold && onHoldEnd
            ? onPointerEndCombined
            : manualHoldArmMs && onManualHoldArm
              ? onPointerEndCombined
              : undefined
      }
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={handleBlur}
      className={clsx(
        'relative w-full min-w-0 select-none rounded-xl border px-4 font-semibold tracking-normal disabled:active:scale-100',
        !(manualHoldArmMs && (isPressing || manualHoldActive)) && 'active:scale-[0.98]',
        manualArmingSquash && 'brightness-110',
        exclusiveSlot ? 'transition-all duration-150 ease-out' : 'transition',
        splitLabel
          ? 'min-h-[4.5rem] py-3 text-sm md:min-h-16'
          : exclusiveSlot
            ? 'flex items-center justify-center py-0 text-sm'
            : 'min-h-16 py-2 text-left text-base md:min-h-14 md:py-1.5 md:text-sm',
        danger
          ? 'border-red-500 bg-red-600 text-white shadow-[0_0_12px_rgba(239,68,68,0.7)] ring-2 ring-red-400 hover:bg-red-500 disabled:hover:bg-red-600'
          : exclusiveSlot
            ? [
                'h-14 min-h-0 border transition-all duration-150 ease-out',
                manualHoldVisual
                  ? 'z-[1] border-lime-400/50 bg-lime-400/15 text-white opacity-100 shadow-[0_0_5px_rgba(132,204,22,0.3)] ring-2 ring-white/30'
                  : active
                    ? 'border-lime-400/50 bg-lime-400/15 text-white opacity-100 shadow-[0_0_5px_rgba(132,204,22,0.3)] ring-2 ring-lime-400/70'
                    : 'border-slate-700 bg-slate-900 text-slate-500 opacity-50 shadow-none ring-0 ring-offset-0 hover:border-slate-600 hover:bg-slate-800/90 hover:opacity-[0.65] hover:text-slate-400',
              ]
            : [
                'border-slate-700 bg-slate-900 text-slate-200 shadow-inner',
                active || manualHoldVisual
                  ? isHolding
                    ? 'border-lime-400 bg-lime-500/25 text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.35),0_0_8px_rgba(132,204,22,0.6)] ring-2 ring-lime-300'
                    : manualHoldVisual
                      ? 'z-[1] border-lime-400 bg-lime-500/25 text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.35),0_0_8px_rgba(132,204,22,0.6)] ring-2 ring-white/30'
                      : 'border-lime-400 bg-lime-500/25 text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.35),0_0_8px_rgba(132,204,22,0.6)] ring-2 ring-lime-400'
                  : isHolding
                    ? 'border-lime-400/90 bg-lime-500/15 ring-2 ring-lime-300'
                    : 'hover:border-slate-500 hover:bg-slate-900/95',
              ],
        disabled &&
          (exclusiveSlot
            ? 'cursor-not-allowed opacity-40 contrast-more:opacity-50'
            : 'cursor-not-allowed border-slate-700 opacity-55 contrast-more:opacity-70'),
        splitLabel && 'text-center',
      )}
    >
      {title ? (
        <span id={descId} className="sr-only">
          {title}
        </span>
      ) : null}
      <div
        className={clsx(
          'flex items-center gap-3',
          exclusiveSlot && !hold ? 'justify-center' : 'justify-between',
        )}
      >
        <div
          className={clsx(
            'flex min-w-0 flex-col gap-0.5',
            exclusiveSlot && !hold ? 'min-w-0' : 'flex-1',
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
                    active || manualHoldVisual
                      ? 'text-white'
                      : exclusiveSlot
                        ? 'text-slate-500'
                        : 'text-slate-300',
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
        <p className="pointer-events-none mt-1 text-center text-[10px] leading-snug text-slate-500">{caption}</p>
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
      {manualHoldArmMs && onManualHoldArm && !hold && isPressing && !manualHoldActive ? (
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 z-[2] h-[2px] overflow-hidden rounded-b-xl bg-slate-950/50"
          aria-hidden
        >
          <div
            className="h-full bg-lime-400 ease-linear"
            style={{
              width: armBarFill ? '100%' : '0%',
              transitionProperty: 'width',
              transitionDuration: `${manualHoldArmMs}ms`,
              transitionTimingFunction: 'linear',
            }}
          />
        </div>
      ) : null}
      <span className="pointer-events-none absolute right-3 top-3 size-2" aria-hidden>
        <span
          className={clsx(
            'relative block size-2 rounded-full',
            exclusiveSlot && !active && !manualHoldVisual
              ? 'border border-slate-700 bg-slate-600 text-slate-600'
              : [
                  'border border-slate-900/50',
                  'shadow-[0_0_8px_currentColor,0_0_16px_currentColor]',
                  'before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-current before:opacity-30 before:blur-sm before:content-[""]',
                  active || manualHoldVisual
                    ? exclusiveSlot
                      ? 'bg-lime-300 text-lime-200 shadow-[0_0_5px_rgba(132,204,22,0.55)] motion-safe:animate-pulse'
                      : 'bg-lime-400 text-lime-300 motion-safe:animate-pulse'
                    : 'bg-slate-600 text-slate-500',
                ],
          )}
        />
      </span>
    </motion.button>
  )
}
