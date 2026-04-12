export type Region = 'america' | 'europe'
export type EmergencyType = 'fire' | 'police' | 'ambulance'
export type ButtonMode = 'toggle' | 'hold' | 'stop'
export type SoundKind =
  | 'wail'
  | 'yelp'
  | 'hilo'
  | 'phaser'
  | 'horn'
  | 'twoToneA'
  | 'twoToneM'
  | 'twoTone'
  | 'twoToneUmh'
  | 'threeTone'
  | 'qsiren'

/** Style de routage timbre / two-tone dans le moteur audio. */
export type RegionStyle = 'us' | 'eu'

/** Service d’urgence (grille UI + routage two-tone EU fire vs police). */
export type SoundVariant = 'fire' | 'police' | 'ambulance'

export type SoundDefinition = {
  id: string
  label: string
  mode: ButtonMode
  kind: SoundKind
  regionStyle: RegionStyle
  variant: SoundVariant
  /** Ids incompatibles sauf cas gérés par `canPlayTogether` / `canIgnoreExplicitExclusive`. */
  exclusiveWith?: string[]
  stopChirp?: boolean
}

/** Overlays persistants (Q-SIREN US, WAIL/YELP ambulance EU sur base two-tone/UMH). */
export type SirenOverlayId = 'qSiren' | 'euAmbuWail' | 'euAmbuYelp'

export const Q_SIREN_SOUND_ID = 'amer-fire-qsiren' as const

export const EU_AMBU_BASE_MAIN_IDS = ['eu-ambu-two-tone', 'eu-ambu-umh'] as const

/** Scénario routé (compatible avec les entrées de `SIREN_CONFIG`). */
export type SirenScenario = {
  region: Region
  emergency: EmergencyType
  defs: readonly SoundDefinition[]
}

const isWailOrYelp = (kind: SoundKind) => kind === 'wail' || kind === 'yelp'
const isFrAmbuTone = (kind: SoundKind) =>
  kind === 'twoTone' || kind === 'threeTone' || kind === 'twoToneUmh'
const isEuAmbulance = (d: SoundDefinition) => d.regionStyle === 'eu' && d.variant === 'ambulance'

/** Matrice de compatibilité (ex. WAIL+YELP ❌, WAIL+Q-SIREN ✔, EU two-tone+WAIL ✔, THREE-TONE+WAIL ❌). */
export const canPlayTogether = (soundA: SoundDefinition, soundB: SoundDefinition) => {
  if (soundA.id === soundB.id) return true
  if (isWailOrYelp(soundA.kind) && isWailOrYelp(soundB.kind)) return false
  if (soundA.kind === 'qsiren' && isWailOrYelp(soundB.kind)) return true
  if (soundB.kind === 'qsiren' && isWailOrYelp(soundA.kind)) return true
  if (isEuAmbulance(soundA) && isEuAmbulance(soundB)) {
    const threeA = soundA.kind === 'threeTone'
    const threeB = soundB.kind === 'threeTone'
    const aWailYelp = isWailOrYelp(soundA.kind)
    const bWailYelp = isWailOrYelp(soundB.kind)
    if ((threeA && bWailYelp) || (threeB && aWailYelp)) return false
    const aTone = isFrAmbuTone(soundA.kind)
    const bTone = isFrAmbuTone(soundB.kind)
    if ((aTone && bWailYelp) || (bTone && aWailYelp)) return true
  }
  return true
}

/** Lorsque `exclusiveWith` entre en conflit mais la superposition est volontaire (Q-SIREN, EU tone+wail/yelp). */
export const canIgnoreExplicitExclusive = (soundA: SoundDefinition, soundB: SoundDefinition) => {
  if (soundA.kind === 'qsiren' && isWailOrYelp(soundB.kind)) return true
  if (soundB.kind === 'qsiren' && isWailOrYelp(soundA.kind)) return true
  if (isEuAmbulance(soundA) && isEuAmbulance(soundB)) {
    const threeA = soundA.kind === 'threeTone'
    const threeB = soundB.kind === 'threeTone'
    const aWailYelp = isWailOrYelp(soundA.kind)
    const bWailYelp = isWailOrYelp(soundB.kind)
    if ((threeA && bWailYelp) || (threeB && aWailYelp)) return false
    const aTone = isFrAmbuTone(soundA.kind)
    const bTone = isFrAmbuTone(soundB.kind)
    if ((aTone && bWailYelp) || (bTone && aWailYelp)) return true
  }
  return false
}

export function getOverlayIdForSound(
  sound: SoundDefinition,
  scenario: SirenScenario,
): SirenOverlayId | null {
  if (scenario.region === 'america' && scenario.emergency === 'fire' && sound.kind === 'qsiren') {
    return 'qSiren'
  }
  if (scenario.region === 'europe' && scenario.emergency === 'ambulance') {
    if (sound.id === 'eu-ambu-wail') return 'euAmbuWail'
    if (sound.id === 'eu-ambu-yelp') return 'euAmbuYelp'
  }
  return null
}

/** Sirène principale exclusive (toggles hors overlays Q-SIREN / EU WAIL-YELP). */
export function isMainModeToggle(sound: SoundDefinition, scenario: SirenScenario): boolean {
  return sound.mode === 'toggle' && getOverlayIdForSound(sound, scenario) == null
}

export function euAmbuHasBaseMain(mainMode: string | null): boolean {
  return mainMode != null && (EU_AMBU_BASE_MAIN_IDS as readonly string[]).includes(mainMode)
}

/** Famille pour transition douce entre modes principaux (même orchestration, crossfade côté store). */
export type MainModeSirenFamily = 'usModulated' | 'frTonal' | 'other'

const US_MODULATED_KINDS: ReadonlySet<SoundKind> = new Set(['wail', 'yelp', 'phaser', 'hilo'])
const FR_TONAL_KINDS: ReadonlySet<SoundKind> = new Set([
  'twoTone',
  'twoToneUmh',
  'threeTone',
  'twoToneA',
  'twoToneM',
])

export function mainModeSirenFamily(def: SoundDefinition): MainModeSirenFamily {
  if (def.regionStyle === 'us' && US_MODULATED_KINDS.has(def.kind)) return 'usModulated'
  if (def.regionStyle === 'eu' && FR_TONAL_KINDS.has(def.kind)) return 'frTonal'
  return 'other'
}

/** Même famille → crossfade court (ex. WAIL→YELP) ; sinon coupure plus nette (stop + play). */
export function sameMainModeFamily(a: SoundDefinition, b: SoundDefinition): boolean {
  const fa = mainModeSirenFamily(a)
  const fb = mainModeSirenFamily(b)
  return fa !== 'other' && fa === fb
}

/** Sous-titre discret sous les modes principaux (terminologie type contrôleur). */
export function getMainModeCaption(sound: SoundDefinition): string | undefined {
  if (sound.kind === 'wail') return 'Continuous'
  if (sound.kind === 'yelp') return 'Fast'
  if (sound.kind === 'phaser') return 'Rapid'
  return undefined
}

const sx = (regionStyle: RegionStyle, variant: SoundVariant) => ({ regionStyle, variant })

const cfg = (region: Region, emergency: EmergencyType, defs: SoundDefinition[]) => ({
  region,
  emergency,
  defs,
})

export const SIREN_CONFIG = {
  america: {
    fire: cfg('america', 'fire', [
      { id: 'amer-fire-qsiren', label: 'MAN', mode: 'toggle', kind: 'qsiren', ...sx('us', 'fire') },
      {
        id: 'amer-fire-wail',
        label: 'WAIL',
        mode: 'toggle',
        kind: 'wail',
        exclusiveWith: ['amer-fire-yelp'],
        ...sx('us', 'fire'),
      },
      {
        id: 'amer-fire-yelp',
        label: 'YELP',
        mode: 'toggle',
        kind: 'yelp',
        exclusiveWith: ['amer-fire-wail'],
        ...sx('us', 'fire'),
      },
      { id: 'amer-fire-airhorn', label: 'AIR HORN', mode: 'hold', kind: 'horn', ...sx('us', 'fire') },
      { id: 'amer-fire-stop', label: 'STOP', mode: 'stop', kind: 'horn', ...sx('us', 'fire') },
    ]),
    police: cfg('america', 'police', [
      {
        id: 'amer-police-wail',
        label: 'WAIL',
        mode: 'toggle',
        kind: 'wail',
        exclusiveWith: ['amer-police-yelp', 'amer-police-phaser'],
        ...sx('us', 'police'),
      },
      {
        id: 'amer-police-yelp',
        label: 'YELP',
        mode: 'toggle',
        kind: 'yelp',
        exclusiveWith: ['amer-police-wail', 'amer-police-phaser'],
        ...sx('us', 'police'),
      },
      {
        id: 'amer-police-phaser',
        label: 'PHASER',
        mode: 'toggle',
        kind: 'phaser',
        exclusiveWith: ['amer-police-wail', 'amer-police-yelp'],
        ...sx('us', 'police'),
      },
      { id: 'amer-police-horn', label: 'HORN', mode: 'hold', kind: 'horn', ...sx('us', 'police') },
      {
        id: 'amer-police-stop',
        label: 'STOP',
        mode: 'stop',
        kind: 'horn',
        stopChirp: true,
        ...sx('us', 'police'),
      },
    ]),
    ambulance: cfg('america', 'ambulance', [
      {
        id: 'amer-ambu-hilo',
        label: 'HI-LO',
        mode: 'toggle',
        kind: 'hilo',
        exclusiveWith: ['amer-ambu-wail', 'amer-ambu-yelp'],
        ...sx('us', 'ambulance'),
      },
      {
        id: 'amer-ambu-wail',
        label: 'WAIL',
        mode: 'toggle',
        kind: 'wail',
        exclusiveWith: ['amer-ambu-hilo', 'amer-ambu-yelp'],
        ...sx('us', 'ambulance'),
      },
      {
        id: 'amer-ambu-yelp',
        label: 'YELP',
        mode: 'toggle',
        kind: 'yelp',
        exclusiveWith: ['amer-ambu-hilo', 'amer-ambu-wail'],
        ...sx('us', 'ambulance'),
      },
      { id: 'amer-ambu-stop', label: 'STOP', mode: 'stop', kind: 'horn', ...sx('us', 'ambulance') },
    ]),
  },
  europe: {
    fire: cfg('europe', 'fire', [
      {
        id: 'eu-fire-two-a',
        label: 'TONE 1',
        mode: 'toggle',
        kind: 'twoToneA',
        exclusiveWith: ['eu-fire-two-m'],
        ...sx('eu', 'fire'),
      },
      {
        id: 'eu-fire-two-m',
        label: 'MAN (HOLD)',
        mode: 'hold',
        kind: 'twoToneM',
        exclusiveWith: ['eu-fire-two-a'],
        ...sx('eu', 'fire'),
      },
      { id: 'eu-fire-stop', label: 'STOP', mode: 'stop', kind: 'horn', ...sx('eu', 'fire') },
    ]),
    police: cfg('europe', 'police', [
      {
        id: 'eu-police-two-a',
        label: 'TONE 1',
        mode: 'toggle',
        kind: 'twoToneA',
        exclusiveWith: ['eu-police-two-m'],
        ...sx('eu', 'police'),
      },
      {
        id: 'eu-police-two-m',
        label: 'MAN (HOLD)',
        mode: 'hold',
        kind: 'twoToneM',
        exclusiveWith: ['eu-police-two-a'],
        ...sx('eu', 'police'),
      },
      { id: 'eu-police-stop', label: 'STOP', mode: 'stop', kind: 'horn', ...sx('eu', 'police') },
    ]),
    ambulance: cfg('europe', 'ambulance', [
      { id: 'eu-ambu-two-tone', label: 'TONE', mode: 'toggle', kind: 'twoTone', ...sx('eu', 'ambulance') },
      {
        id: 'eu-ambu-umh',
        label: 'ALT',
        mode: 'toggle',
        kind: 'twoToneUmh',
        exclusiveWith: ['eu-ambu-two-tone', 'eu-ambu-three-tone'],
        ...sx('eu', 'ambulance'),
      },
      {
        id: 'eu-ambu-three-tone',
        label: 'TONE 2',
        mode: 'toggle',
        kind: 'threeTone',
        exclusiveWith: ['eu-ambu-two-tone', 'eu-ambu-umh', 'eu-ambu-wail', 'eu-ambu-yelp'],
        ...sx('eu', 'ambulance'),
      },
      {
        id: 'eu-ambu-wail',
        label: 'WAIL',
        mode: 'toggle',
        kind: 'wail',
        exclusiveWith: ['eu-ambu-three-tone'],
        ...sx('eu', 'ambulance'),
      },
      {
        id: 'eu-ambu-yelp',
        label: 'YELP',
        mode: 'toggle',
        kind: 'yelp',
        exclusiveWith: ['eu-ambu-three-tone'],
        ...sx('eu', 'ambulance'),
      },
      { id: 'eu-ambu-stop', label: 'STOP', mode: 'stop', kind: 'horn', ...sx('eu', 'ambulance') },
    ]),
  },
} as const

function collectAllSoundDefinitions(): SoundDefinition[] {
  return Object.values(SIREN_CONFIG).flatMap((region) =>
    Object.values(region).flatMap((scenario) => [...scenario.defs]),
  ) as SoundDefinition[]
}

/** Accès O(1) par id pour le moteur audio (source de vérité unique). */
export const SOUND_DEF_BY_ID: ReadonlyMap<string, SoundDefinition> = new Map(
  collectAllSoundDefinitions().map((d) => [d.id, d]),
)

export function getSoundDefinitionById(id: string): SoundDefinition | undefined {
  return SOUND_DEF_BY_ID.get(id)
}

export const REGIONS: { id: Region; label: string; flag: string }[] = [
  { id: 'america', label: 'AMERICA', flag: '🇺🇸' },
  { id: 'europe', label: 'EUROPE', flag: '🇪🇺' },
]

export const EMERGENCIES: { id: EmergencyType; label: string }[] = [
  { id: 'fire', label: 'FIRE' },
  { id: 'police', label: 'POLICE' },
  { id: 'ambulance', label: 'AMBULANCE' },
]

export const getScenario = (region?: string, emergency?: string) => {
  if (!region || !emergency) return null
  if (!['america', 'europe'].includes(region)) return null
  if (!['fire', 'police', 'ambulance'].includes(emergency)) return null

  return SIREN_CONFIG[region as Region][emergency as EmergencyType]
}

export const getAllPlayableSoundIds = () =>
  Object.values(SIREN_CONFIG).flatMap((region) =>
    Object.values(region)
      .flatMap((scenario) => scenario.defs)
      .filter((d) => d.mode !== 'stop')
      .map((d) => d.id),
  )
