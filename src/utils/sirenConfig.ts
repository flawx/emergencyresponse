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

export type SoundDefinition = {
  id: string
  label: string
  mode: ButtonMode
  kind: SoundKind
  exclusiveWith?: string[]
  stopChirp?: boolean
}

const cfg = (region: Region, emergency: EmergencyType, defs: SoundDefinition[]) => ({
  region,
  emergency,
  defs,
})

export const SIREN_CONFIG = {
  america: {
    fire: cfg('america', 'fire', [
      { id: 'amer-fire-qsiren', label: 'Q-SIREN', mode: 'toggle', kind: 'qsiren' },
      {
        id: 'amer-fire-wail',
        label: 'WAIL',
        mode: 'toggle',
        kind: 'wail',
        exclusiveWith: ['amer-fire-yelp'],
      },
      {
        id: 'amer-fire-yelp',
        label: 'YELP',
        mode: 'toggle',
        kind: 'yelp',
        exclusiveWith: ['amer-fire-wail'],
      },
      { id: 'amer-fire-airhorn', label: 'AIR HORN', mode: 'hold', kind: 'horn' },
      { id: 'amer-fire-stop', label: 'STOP', mode: 'stop', kind: 'horn' },
    ]),
    police: cfg('america', 'police', [
      {
        id: 'amer-police-wail',
        label: 'WAIL',
        mode: 'toggle',
        kind: 'wail',
        exclusiveWith: ['amer-police-yelp', 'amer-police-phaser'],
      },
      {
        id: 'amer-police-yelp',
        label: 'YELP',
        mode: 'toggle',
        kind: 'yelp',
        exclusiveWith: ['amer-police-wail', 'amer-police-phaser'],
      },
      {
        id: 'amer-police-phaser',
        label: 'PHASER',
        mode: 'toggle',
        kind: 'phaser',
        exclusiveWith: ['amer-police-wail', 'amer-police-yelp'],
      },
      { id: 'amer-police-horn', label: 'HORN', mode: 'hold', kind: 'horn' },
      { id: 'amer-police-stop', label: 'STOP', mode: 'stop', kind: 'horn', stopChirp: true },
    ]),
    ambulance: cfg('america', 'ambulance', [
      {
        id: 'amer-ambu-hilo',
        label: 'HI-LO',
        mode: 'toggle',
        kind: 'hilo',
        exclusiveWith: ['amer-ambu-wail', 'amer-ambu-yelp'],
      },
      {
        id: 'amer-ambu-wail',
        label: 'WAIL',
        mode: 'toggle',
        kind: 'wail',
        exclusiveWith: ['amer-ambu-hilo', 'amer-ambu-yelp'],
      },
      {
        id: 'amer-ambu-yelp',
        label: 'YELP',
        mode: 'toggle',
        kind: 'yelp',
        exclusiveWith: ['amer-ambu-hilo', 'amer-ambu-wail'],
      },
      { id: 'amer-ambu-stop', label: 'STOP', mode: 'stop', kind: 'horn' },
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
      },
      {
        id: 'eu-fire-two-m',
        label: 'TWO-TONE (M)',
        mode: 'hold',
        kind: 'twoToneM',
        exclusiveWith: ['eu-fire-two-a'],
      },
      { id: 'eu-fire-stop', label: 'STOP', mode: 'stop', kind: 'horn' },
    ]),
    police: cfg('europe', 'police', [
      {
        id: 'eu-police-two-a',
        label: 'TWO-TONE (A)',
        mode: 'toggle',
        kind: 'twoToneA',
        exclusiveWith: ['eu-police-two-m'],
      },
      {
        id: 'eu-police-two-m',
        label: 'TWO-TONE (M)',
        mode: 'hold',
        kind: 'twoToneM',
        exclusiveWith: ['eu-police-two-a'],
      },
      { id: 'eu-police-stop', label: 'STOP', mode: 'stop', kind: 'horn' },
    ]),
    ambulance: cfg('europe', 'ambulance', [
      { id: 'eu-ambu-two-tone', label: 'TWO-TONE', mode: 'toggle', kind: 'twoTone' },
      {
        id: 'eu-ambu-umh',
        label: 'UMH',
        mode: 'toggle',
        kind: 'twoToneUmh',
        exclusiveWith: ['eu-ambu-two-tone', 'eu-ambu-three-tone', 'eu-ambu-wail', 'eu-ambu-yelp'],
      },
      {
        id: 'eu-ambu-three-tone',
        label: 'THREE-TONE',
        mode: 'toggle',
        kind: 'threeTone',
        exclusiveWith: ['eu-ambu-two-tone', 'eu-ambu-umh', 'eu-ambu-wail', 'eu-ambu-yelp'],
      },
      {
        id: 'eu-ambu-wail',
        label: 'WAIL',
        mode: 'toggle',
        kind: 'wail',
        exclusiveWith: ['eu-ambu-three-tone', 'eu-ambu-umh'],
      },
      {
        id: 'eu-ambu-yelp',
        label: 'YELP',
        mode: 'toggle',
        kind: 'yelp',
        exclusiveWith: ['eu-ambu-three-tone', 'eu-ambu-umh'],
      },
      { id: 'eu-ambu-stop', label: 'STOP', mode: 'stop', kind: 'horn' },
    ]),
  },
} as const

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
