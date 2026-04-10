# Moteur audio — contraintes de conception (prod)

Ce document verrouille les règles d’implémentation pour le graphe Web Audio (`src/audio/engine.ts`) et les évolutions futures.

## Loudness

- **Cible abstraite** : calibrer les presets vers une mesure de référence (ex. **RMS ~ -11 dBFS** sur une voix isolée), **sans** utiliser un preset particulier (ex. un id WAIL) comme référence : sinon toute évolution du WAIL casserait le calage global.
- **RMS ≠ loudness perçu** : toute calibration doit être validée **par mesure** et **par écoute comparative** entre presets.
- **Multi-voix** : pas de loudness « temps réel » qui recalcule le mix sur N voix ; stabilité et prévisibilité avant tout. Les niveaux par `kind` sont ajustés pour qu’une voix seule approche la cible.

## Saturation

- **Une seule saturation dominante** sur la chaîne ; l’autre couche reste **subtile**. **Interdit** : deux saturations **fortes** en série.
- **Recommandation** : saturation **dominante = master** (stable quel que soit le preset) ; les voix = **coloration légère** (évite clip sur certains presets et son mou sur d’autres).

## Automation longue durée

- Reschedule basé sur **`audioContext.currentTime`** (horloge audio), pas sur une accumulation de temps JS seule.
- **Marge de sécurité** avant la fin d’un segment planifié (typ. **0,1–0,3 s**) pour ré-enfiler la suite, afin d’éviter trous / glitches si le thread JS est en retard.

## Analyseur

- **Tap principal** : **après le limiteur final** (aligné sur ce que l’utilisateur entend ; viz + mesures produit).
- **Debug** : tap optionnel **pré-EQ finale** (après `masterGain`, avant présence / shelf / DC / limiteur) pour comparer spectre « pré-mastering final » — exposé via l’API debug du moteur, pas utilisé par le visualiseur par défaut.

## EU / US

- Conserver les différences produit si nécessaire, mais les exprimer via **mapping structuré** (config / ids), **pas** via `id.includes(...)` dispersé dans le code.

## Fichiers liés

- Graphe et voix : `src/audio/engine.ts`
- Routage UI / exclusion : `src/store/sirenStore.ts`, `src/utils/sirenConfig.ts`
