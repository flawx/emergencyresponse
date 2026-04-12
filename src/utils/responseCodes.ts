import {
  getScenario,
  getSoundDefinitionById,
  isMainModeToggle,
  type SirenOverlayId,
  type SoundDefinition,
} from './sirenConfig'

export type ResponseCode = 'code1' | 'code2' | 'code3' | 'manual'

/** Overlays à activer après le mode principal (couches sirène déjà coupées). */
export type ResponsePresetOverlays = {
  qSiren?: boolean
  euAmbuWail?: boolean
  euAmbuYelp?: boolean
}

export type ResponsePreset = {
  mainMode: string | null
  overlays?: ResponsePresetOverlays
}

export type ScenarioResponsePresets = Partial<Record<'code2' | 'code3', ResponsePreset>>

/**
 * Code 1 = silence sirènes uniquement (via store, sans `stopAll` → micro / PTT inchangés).
 * Code 2 / 3 = escaliers selon IDs `sirenConfig`.
 */
export const RESPONSE_CODE_CONFIG: Record<string, ScenarioResponsePresets> = {
  'america/fire': {
    code2: { mainMode: 'amer-fire-wail' },
    code3: { mainMode: 'amer-fire-wail', overlays: { qSiren: true } },
  },
  'america/police': {
    code2: { mainMode: 'amer-police-wail' },
    code3: { mainMode: 'amer-police-yelp' },
  },
  'america/ambulance': {
    code2: { mainMode: 'amer-ambu-wail' },
    code3: { mainMode: 'amer-ambu-yelp' },
  },
  'europe/fire': {
    code2: { mainMode: 'eu-fire-two-a' },
    code3: { mainMode: 'eu-fire-two-a' },
  },
  'europe/police': {
    code2: { mainMode: 'eu-police-two-a' },
    code3: { mainMode: 'eu-police-two-a' },
  },
  'europe/ambulance': {
    code2: { mainMode: 'eu-ambu-two-tone' },
    code3: { mainMode: 'eu-ambu-two-tone', overlays: { euAmbuWail: true } },
  },
}

export function scenarioKeyFromParams(region: string, emergency: string): string {
  return `${region}/${emergency}`
}

export function getPresetForCode(scenarioKey: string, code: ResponseCode): ResponsePreset | null {
  if (code === 'code1' || code === 'manual') return null
  const row = RESPONSE_CODE_CONFIG[scenarioKey]
  if (!row) return null
  return row[code] ?? null
}

/** Pour UI : code 2 et 3 identiques (ex. EU fire / police). */
export function isResponseCode3SameAsCode2(scenarioKey: string): boolean {
  const row = RESPONSE_CODE_CONFIG[scenarioKey]
  const a = row?.code2
  const b = row?.code3
  if (!a || !b) return false
  const oa = a.overlays ?? {}
  const ob = b.overlays ?? {}
  return (
    a.mainMode === b.mainMode &&
    !!oa.qSiren === !!ob.qSiren &&
    !!oa.euAmbuWail === !!ob.euAmbuWail &&
    !!oa.euAmbuYelp === !!ob.euAmbuYelp
  )
}

/** Incrémenté à chaque nouvelle demande `setResponseCode` pour invalider transitions en cours. */
let responseCodeApplyGen = 0

export function bumpResponseCodeApplyGeneration(): number {
  responseCodeApplyGen += 1
  return responseCodeApplyGen
}

export function getResponseCodeApplyGeneration(): number {
  return responseCodeApplyGen
}

function delayResponseTransitionMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export type ResponseCodeApplyApi = {
  clearMainAndOverlaysOnly: (region?: string, emergency?: string) => Promise<boolean>
  setMainMode: (sound: SoundDefinition, region?: string, emergency?: string) => Promise<boolean>
  toggleOverlay: (overlayId: SirenOverlayId, region?: string, emergency?: string) => Promise<boolean>
}

/**
 * Applique un response code via le store uniquement.
 * `applyGen` : snapshot pour ignorer les fins de transition obsolètes.
 */
export async function applyResponseCode(
  code: ResponseCode,
  scenarioKey: string,
  params: { region: string; emergency: string },
  api: ResponseCodeApplyApi,
  applyGen: number,
): Promise<{ ok: boolean }> {
  const { region, emergency } = params

  if (code === 'manual') return { ok: true }

  if (code === 'code1') {
    const cleared = await api.clearMainAndOverlaysOnly(region, emergency)
    return { ok: cleared }
  }

  const scenario = getScenario(region, emergency)
  if (!scenario) return { ok: false }

  const preset = getPresetForCode(scenarioKey, code)
  if (!preset) return { ok: false }

  const cleared = await api.clearMainAndOverlaysOnly(region, emergency)
  if (!cleared) return { ok: false }

  await delayResponseTransitionMs(80)
  if (getResponseCodeApplyGeneration() !== applyGen) return { ok: false }

  if (preset.mainMode) {
    const def = getSoundDefinitionById(preset.mainMode)
    if (!def || !isMainModeToggle(def, scenario)) {
      return { ok: false }
    }
    const mainOk = await api.setMainMode(def, region, emergency)
    if (!mainOk) return { ok: false }
    if (getResponseCodeApplyGeneration() !== applyGen) return { ok: false }
  }

  const o = preset.overlays
  if (o?.qSiren) {
    const tOk = await api.toggleOverlay('qSiren', region, emergency)
    if (!tOk) return { ok: false }
    if (getResponseCodeApplyGeneration() !== applyGen) return { ok: false }
  }
  if (o?.euAmbuWail) {
    const tOk = await api.toggleOverlay('euAmbuWail', region, emergency)
    if (!tOk) return { ok: false }
    if (getResponseCodeApplyGeneration() !== applyGen) return { ok: false }
  }
  if (o?.euAmbuYelp) {
    const tOk = await api.toggleOverlay('euAmbuYelp', region, emergency)
    if (!tOk) return { ok: false }
    if (getResponseCodeApplyGeneration() !== applyGen) return { ok: false }
  }

  return { ok: true }
}
