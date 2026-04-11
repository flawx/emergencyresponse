/**
 * Coefficient multiplicatif par id de bouton, appliqué dans `play()` **après** `buildSynth`,
 * en multipliant `voiceInput.gain` (donc après tout trim interne ex. two-tone FR à 1.41).
 * Le gain de sortie `gainNode` reçoit seulement `normalizePresetVolume × PLAY_HEADROOM × multi-voix`.
 *
 * Les ids absents équivalent à **1.0**.
 */
export const AUDIO_CALIBRATION: Record<string, number> = {
  // America — fire
  'amer-fire-qsiren': 0.98,
  'amer-fire-wail': 0.92,
  'amer-fire-yelp': 1.04,
  'amer-fire-airhorn': 1.06,
  // America — police
  'amer-police-wail': 0.92,
  'amer-police-yelp': 1.04,
  'amer-police-phaser': 0.93,
  'amer-police-horn': 0.88,
  // America — ambulance (HI-LO un peu relevé vs chaîne FR)
  'amer-ambu-hilo': 1.3,
  'amer-ambu-wail': 1.0,
  'amer-ambu-yelp': 1.04,
  // Europe — fire (two-tone)
  'eu-fire-two-a': 1.35,
  'eu-fire-two-m': 1.35,
  // Europe — police
  'eu-police-two-a': 1.35,
  'eu-police-two-m': 1.35,
  // Europe — ambulance
  'eu-ambu-two-tone': 1.35,
  'eu-ambu-umh': 1.35,
  'eu-ambu-three-tone': 1.4,
  'eu-ambu-wail': 0.85,
  'eu-ambu-yelp': 0.85,
}

const PROBE_PREFIX = '__probe-'

/** Résout la calibration pour l’id passé à `play()` (ex. ids `__probe-*` de debug). */
export function resolveAudioCalibration(playId: string): number {
  const key = playId.startsWith(PROBE_PREFIX) ? playId.slice(PROBE_PREFIX.length) : playId
  return AUDIO_CALIBRATION[key] ?? 1
}
