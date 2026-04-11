/**
 * Coefficient multiplicatif appliqué **après** `normalizePresetVolume` dans `play()`,
 * puis headroom global et compensation multi-voix dans `engine.play()`.
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
  'amer-ambu-hilo': 1.12,
  'amer-ambu-wail': 1.0,
  'amer-ambu-yelp': 1.04,
  // Europe — fire (two-tone)
  'eu-fire-two-a': 1.12,
  'eu-fire-two-m': 1.12,
  // Europe — police
  'eu-police-two-a': 1.12,
  'eu-police-two-m': 1.12,
  // Europe — ambulance
  'eu-ambu-two-tone': 1.12,
  'eu-ambu-umh': 1.12,
  'eu-ambu-three-tone': 1.15,
  'eu-ambu-wail': 0.85,
  'eu-ambu-yelp': 0.85,
}
