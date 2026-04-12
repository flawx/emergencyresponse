const STORAGE_KEY = 'audioInputDeviceId'

export function loadStoredAudioInputDeviceId(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === null || v === '' ? null : v
  } catch {
    return null
  }
}

export function saveStoredAudioInputDeviceId(deviceId: string): void {
  try {
    if (deviceId === '') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, deviceId)
  } catch {
    /* ignore */
  }
}
