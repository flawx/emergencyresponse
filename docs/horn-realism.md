# Horns (klaxons / air horns)

## État actuel

Les **horns US** ne sont **plus** synthétisés dans le moteur : le rendu repose sur des **fichiers audio** bouclés pour un réalisme maximal et une maintenance simple.

- **Police US** (`amer-police-horn`) : sample `horn-police-us.wav` ou `.mp3` dans `public/audio/`. Sans fichier : **aucun son** (bouton désactivé dans l’UI si le buffer n’est pas chargé).
- **Air horn pompiers US** (`amer-fire-airhorn`) : sample `horn-fire-us.wav` ou `.mp3` dans `public/audio/`. Même comportement si absent.

La chaîne de lecture (gain interne, filtres, multiplicateurs `HORN_POLICE_GAIN` / `HORN_FIRE_GAIN` après normalisation) est décrite dans le code : `createHorn`, `setupHornUsPoliceFromSample`, `setupHornUsFireFromSample` dans `src/audio/engine.ts`.

Les **klaxons européens** ont été retirés du produit (plus de boutons HORN EU dans `SIREN_CONFIG`).

## Assets et calibration

- Emplacement et noms de fichiers : `public/audio/README.md`.
- Niveau relatif aux autres presets : coefficients par id dans `src/audio/audioCalibration.ts` (voir aussi `docs/audio-engine.md`, section Loudness).

## Historique

Les anciennes pistes de design (synthèse multi-oscillateurs, burst air, variantes EU) ne s’appliquent plus au code actuel ; ce fichier sert uniquement de **référence produit** pour l’approche **sample-only** des horns US.
