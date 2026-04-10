# Moteur audio — contraintes de conception (prod)

Ce document verrouille les règles d’implémentation pour le graphe Web Audio (`src/audio/engine.ts`) et les évolutions futures.

## Loudness

- **Cible abstraite** : calibrer les presets vers une mesure de référence (ex. **RMS ~ -11 dBFS** sur une voix isolée, **après le limiteur**), **sans** utiliser un preset particulier comme référence : sinon toute évolution de ce preset casserait le calage global.
- **RMS ≠ loudness perçu** : toute calibration doit être validée **par mesure** et **par écoute comparative** entre presets.
- **Multi-voix** : pas de loudness « temps réel » qui recalcule le mix sur N voix ; stabilité et prévisibilité avant tout.
- **Implémentation** : le gain par voix vient de **`getUnifiedGain(kind)`** × **`staticCompensation[kind]`** (constantes versionnées dans le code). **Pas d’apprentissage runtime** (`Map` qui modifie le niveau entre deux lectures) : même rendu quelle que soit l’ordre des lectures ou le nombre de voix compatibles.

## Saturation

- **Une seule saturation dominante** sur la chaîne ; l’autre couche reste **subtile**. **Interdit** : deux saturations **fortes** en série.
- **Recommandation** : saturation **dominante = master** (stable quel que soit le preset) ; les voix = **coloration légère** (évite clip sur certains presets et son mou sur d’autres).

## Automation longue durée

- Les enveloppes de fréquence / gain des sirènes concernées sont **planifiées en une fois** sur un **horizon fixe** (boucles synchrones dans `play`), entièrement sur la **timeline Web Audio** (`setValueAtTime`, rampes, etc.) — **pas** de re-planification périodique via `setTimeout` pour la modulation.
- Limite : au-delà de l’horizon (ex. plusieurs minutes de lecture continue), la courbe ne s’étend pas ; en pratique les lectures sont plus courtes que ces horizons.

## Analyseur

- **Tap principal** : **après le limiteur final** (aligné sur ce que l’utilisateur entend ; viz + mesures produit).
- **Debug** : tap optionnel **pré-EQ finale** (après `masterGain`, avant présence / shelf / DC / limiteur) pour comparer spectre « pré-mastering final » — exposé via l’API debug du moteur, pas utilisé par le visualiseur par défaut.

## EU / US

- Conserver les différences produit si nécessaire, mais les exprimer via **mapping structuré** (config / ids), **pas** via `id.includes(...)` dispersé dans le code.

## Fichiers liés

- Graphe et voix : `src/audio/engine.ts`
- Routage UI / exclusion : `src/store/sirenStore.ts`, `src/utils/sirenConfig.ts`
