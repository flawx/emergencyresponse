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
  exclusiveWith?: string[]
  stopChirp?: boolean
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
      { id: 'amer-fire-qsiren', label: 'Q-SIREN', mode: 'toggle', kind: 'qsiren', ...sx('us', 'fire') },
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
        label: 'TWO-TONE (A)',
        mode: 'toggle',
        kind: 'twoToneA',
        exclusiveWith: ['eu-fire-two-m'],
        ...sx('eu', 'fire'),
      },
      {
        id: 'eu-fire-two-m',
        label: 'TWO-TONE (M)',
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
        label: 'TWO-TONE (A)',
        mode: 'toggle',
        kind: 'twoToneA',
        exclusiveWith: ['eu-police-two-m'],
        ...sx('eu', 'police'),
      },
      {
        id: 'eu-police-two-m',
        label: 'TWO-TONE (M)',
        mode: 'hold',
        kind: 'twoToneM',
        exclusiveWith: ['eu-police-two-a'],
        ...sx('eu', 'police'),
      },
      { id: 'eu-police-stop', label: 'STOP', mode: 'stop', kind: 'horn', ...sx('eu', 'police') },
    ]),
    ambulance: cfg('europe', 'ambulance', [
      { id: 'eu-ambu-two-tone', label: 'TWO-TONE', mode: 'toggle', kind: 'twoTone', ...sx('eu', 'ambulance') },
      {
        id: 'eu-ambu-umh',
        label: 'UMH',
        mode: 'toggle',
        kind: 'twoToneUmh',
        exclusiveWith: ['eu-ambu-two-tone', 'eu-ambu-three-tone', 'eu-ambu-wail', 'eu-ambu-yelp'],
        ...sx('eu', 'ambulance'),
      },
      {
        id: 'eu-ambu-three-tone',
        label: 'THREE-TONE',
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
        exclusiveWith: ['eu-ambu-three-tone', 'eu-ambu-umh'],
        ...sx('eu', 'ambulance'),
      },
      {
        id: 'eu-ambu-yelp',
        label: 'YELP',
        mode: 'toggle',
        kind: 'yelp',
        exclusiveWith: ['eu-ambu-three-tone', 'eu-ambu-umh'],
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
