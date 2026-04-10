# Changelog

Toutes les notes notables de ce projet sont documentées ici.

## [0.1.0] - 2026-04-10

### Audio Engine Refactor & Stabilization

#### Added

- Mesure **RMS** post-limiteur (analyseur + snapshot debug)
- Système **`AUDIO_CALIBRATION`** par id de bouton
- Panneau **debug audio** conditionnel (`?debug=1`, dev, `VITE_SHOW_AUDIO_DEBUG`)
- **Horns US** entièrement **sample-based** (`public/audio/horn-*-us.*`)
- Utilitaire **`getAssetUrl`** pour chargement d’assets compatible **`BASE_URL`**
- Architecture **modulaire** du moteur (`masterChain`, `routing`, `horns`, `sirens/*`, `utils/*`, `debug`)

#### Changed

- Refactor du moteur : orchestration dans **`engine.ts`**, logique par famille dans des modules dédiés
- Routage sirène : **`regionStyle`** / **`variant`** (fini les `id.includes` / préfixes eu- dans le moteur)
- **Hi-Lo** : alternance de fréquences planifiée sur la **timeline Web Audio** (plus de `setInterval`)
- **AudioVisualizer** : perf (éviter re-renders par frame inutiles)
- **Accessibilité** UI : ARIA, focus visible, contrastes, hold au clavier sur les boutons concernés

#### Removed

- **Horns** : toute voie de synthèse pour police / air horn US (samples obligatoires pour le son)
- **Hi-Lo** : modulation par **`setInterval`**
- Logs **`console.debug`** moteur hors **`?debugAudio=1`** (buffer interne conservé)

#### Fixed

- Cohérence loudness (calibration + cas horns)
- **404** assets en déploiement sous **sous-chemin** (`BASE_URL`)
- Comportement UI lorsque les **samples horn** sont absents
