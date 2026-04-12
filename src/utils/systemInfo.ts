/** Nom de navigateur approximatif à partir du user-agent. */
export function parseBrowserName(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\/|Opera/.test(ua)) return 'Opera'
  if (/Chrome\//.test(ua) && !/Edg/.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return 'Safari'
  if (/Firefox\//.test(ua)) return 'Firefox'
  return 'Unknown'
}

/** OS approximatif à partir du user-agent. */
export function parseOsFromUa(ua: string): string {
  if (/Windows NT/.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS'
  if (/CrOS/.test(ua)) return 'Chrome OS'
  if (/Linux/.test(ua) && !/Android/.test(ua)) return 'Linux'
  if (/Android/.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  return 'Unknown'
}

export type SystemInfoSnapshot = {
  browser: string
  os: string
  userAgentShort: string
  fullUserAgent: string
  platform: string
  language: string
  sampleRate: number | undefined
  isMobile: boolean
  deviceType: 'Mobile' | 'Desktop'
  baseLatencySec: number | undefined
  outputLatencySec: number | undefined
}

export function getSystemInfo(audioContext: AudioContext | null): SystemInfoSnapshot {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isMobile = /Mobi|Android/i.test(ua)
  const short =
    ua.length > 140 ? `${ua.slice(0, 137)}…` : ua

  let baseLatencySec: number | undefined
  let outputLatencySec: number | undefined
  if (audioContext) {
    const bl = audioContext.baseLatency
    const ol = audioContext.outputLatency
    if (typeof bl === 'number' && Number.isFinite(bl)) baseLatencySec = bl
    if (typeof ol === 'number' && Number.isFinite(ol)) outputLatencySec = ol
  }

  return {
    browser: parseBrowserName(ua),
    os: parseOsFromUa(ua),
    userAgentShort: short,
    fullUserAgent: ua,
    platform: typeof navigator !== 'undefined' ? navigator.platform : '',
    language: typeof navigator !== 'undefined' ? navigator.language : '',
    sampleRate: audioContext?.sampleRate,
    isMobile,
    deviceType: isMobile ? 'Mobile' : 'Desktop',
    baseLatencySec,
    outputLatencySec,
  }
}

export function supportsSetSinkId(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
}
