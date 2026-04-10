import type { DebugVoice, SoundInstance } from './types'
import { measureRMS } from './utils/audioUtils'

const DEBUG_LOG_MAX = 100

export function pushAudioDebugLog(buffer: string[], message: string): void {
  buffer.push(`${new Date().toISOString()} ${message}`)
  if (buffer.length > DEBUG_LOG_MAX) buffer.shift()
}

export function logAudioDebug(buffer: string[], consoleEnabled: boolean, message: string): void {
  pushAudioDebugLog(buffer, message)
  if (consoleEnabled) {
    console.debug(message)
  }
}

export function buildDebugSnapshot(
  active: Map<string, SoundInstance>,
  debugLog: string[],
  analyser: AnalyserNode | undefined,
): {
  voices: Record<string, DebugVoice>
  logs: string[]
  masterPostLimiterRms: number | null
  masterPostLimiterDbFs: number | null
} {
  const voices: Record<string, DebugVoice> = {}
  for (const [id, instance] of active.entries()) voices[id] = { ...instance.debug }
  let masterPostLimiterRms: number | null = null
  let masterPostLimiterDbFs: number | null = null
  if (analyser) {
    const rms = measureRMS(analyser)
    masterPostLimiterRms = rms
    masterPostLimiterDbFs = rms > 1e-12 ? 20 * Math.log10(rms) : null
  }
  return {
    voices,
    logs: debugLog.slice(-25),
    masterPostLimiterRms,
    masterPostLimiterDbFs,
  }
}

export function logMasterDestinationRouting(logDebug: (message: string) => void): void {
  const routing = [
    'Audio route: source -> mixGain -> preEQ(HP180) -> preGain -> saturator -> compressor -> makeupGain -> masterGain -> presenceEQ -> highShelf -> DCBlocker -> limiter -> destination',
    'Analyzer (product): finalLimiter -> analyser (parallel, no destination)',
    'Analyzer (debug): masterGain -> analyserDebugPreFinalEq (parallel, no destination)',
    'Nodes connected to destination: finalLimiter only',
  ]
  routing.forEach((line) => logDebug(`[routing] ${line}`))
}
