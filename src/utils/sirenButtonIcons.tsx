import { Flame, OctagonAlert, Shield, Siren, Truck } from 'lucide-react'
import type { SoundDefinition } from './sirenConfig'

const iconClass = 'h-4 w-4 shrink-0 opacity-80'

/** Icône Lucide pour un bouton de sirène (scan visuel + cohérence variante). */
export function soundDefinitionIcon(sound: SoundDefinition) {
  if (sound.mode === 'stop') {
    return <OctagonAlert className={iconClass} strokeWidth={2} aria-hidden />
  }
  if (sound.kind === 'horn') {
    return <Siren className={iconClass} strokeWidth={2} aria-hidden />
  }
  switch (sound.variant) {
    case 'police':
      return <Shield className={iconClass} strokeWidth={2} aria-hidden />
    case 'fire':
      return <Flame className={iconClass} strokeWidth={2} aria-hidden />
    case 'ambulance':
      return <Truck className={iconClass} strokeWidth={2} aria-hidden />
    default:
      return null
  }
}
