/**
 * Coefficient multiplicatif appliqué **après** `normalizePresetVolume` dans `play()`.
 *
 * **Référence (cible)** : `amer-police-wail` et `amer-fire-wail` à **1.0** — les jouer seuls,
 * noter RMS / dBFS post-limiteur (debug), puis ajuster les autres presets pour se rapprocher
 * de la même lecture **en conditions identiques** (une voix à la fois).
 *
 * Règle d’ajustement : petits pas (souvent 0.02–0.08) ; trop fort → baisser le coef., trop faible → l’augmenter.
 * Les ids absents du tableau équivalent à **1.0**.
 */
export const AUDIO_CALIBRATION: Record<string, number> = {
  // America — fire (réf. wail = 1.0)
  'amer-fire-qsiren': 0.98,
  'amer-fire-wail': 1.0,
  'amer-fire-yelp': 1.04,
  'amer-fire-airhorn': 1.06,
  // America — police
  'amer-police-wail': 1.0,
  'amer-police-yelp': 1.04,
  'amer-police-phaser': 0.93,
  'amer-police-horn': 0.88,
  // America — ambulance
  'amer-ambu-hilo': 1.06,
  'amer-ambu-wail': 1.0,
  'amer-ambu-yelp': 1.04,
  // Europe — fire (chaîne FR : +voiceInput / EQ → souvent plus présent que WAIL US)
  'eu-fire-two-a': 0.9,
  'eu-fire-two-m': 0.9,
  // Europe — police
  'eu-police-two-a': 0.9,
  'eu-police-two-m': 0.9,
  // Europe — ambulance
  'eu-ambu-two-tone': 0.9,
  'eu-ambu-umh': 0.9,
  'eu-ambu-three-tone': 1.06,
  'eu-ambu-wail': 1.0,
  'eu-ambu-yelp': 1.04,
}
