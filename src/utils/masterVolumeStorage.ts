const STORAGE_KEY = 'masterVolume'
const DEFAULT_VOLUME = 0.85

function clamp01(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_VOLUME
  return Math.min(1, Math.max(0, n))
}

export function loadStoredMasterVolume(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null || raw === '') return DEFAULT_VOLUME
    const n = Number.parseFloat(raw)
    return clamp01(n)
  } catch {
    return DEFAULT_VOLUME
  }
}

export function saveStoredMasterVolume(value: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clamp01(value)))
  } catch {
    /* ignore */
  }
}
