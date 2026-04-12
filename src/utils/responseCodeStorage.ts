import type { ResponseCode } from './responseCodes'

const STORAGE_KEY = 'responseCodeByScenario'

const VALID: ReadonlySet<ResponseCode> = new Set(['code1', 'code2', 'code3', 'manual'])

function parseCode(v: unknown): ResponseCode | null {
  if (typeof v !== 'string') return null
  if (!VALID.has(v as ResponseCode)) return null
  return v as ResponseCode
}

export function loadStoredResponseCode(scenarioKey: string): ResponseCode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw) as Record<string, unknown>
    return parseCode(obj[scenarioKey])
  } catch {
    return null
  }
}

export function saveStoredResponseCode(scenarioKey: string, code: ResponseCode): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const obj: Record<string, string> = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    obj[scenarioKey] = code
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch {
    /* ignore */
  }
}
