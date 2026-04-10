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
- **État actuel** : `SIREN_CONFIG` (`src/utils/sirenConfig.ts`) est déjà structuré (`id`, `kind`, région / urgence). En revanche, **`buildSynth` / `createHorn`** dans `engine.ts` **parsent encore l’`id`** (`includes('eu-police')`, `startsWith('eu-')`, `includes('amer-fire')`, etc.) — voir section *Reste à faire*.

---

## État au dépôt (comparé à ce document)

Synthèse factuelle par rapport au code actuel (`src/audio/engine.ts`, store, config).

| Sujet | Statut | Détail |
|--------|--------|--------|
| Loudness statique (`getUnifiedGain` × `staticCompensation`) | **Fait** | Pas d’apprentissage runtime ; logs `[loudness]` avec référence `loudnessTargetDb`. |
| Cible RMS ~-11 dBFS « voix isolée post-limiteur » | **Partiel** | Constante et intention documentées ; **aucune** procédure de mesure systématique ni test auto dans le dépôt pour vérifier l’alignement preset par preset. |
| Saturation (une dominante, voix légères) | **Fait** | Chaîne master + voix conforme à l’esprit du doc. |
| Automation longue durée | **Fait** | Horizons synchrones Web Audio (plus de re-planif `setTimeout` pour WAIL/YELP/FR). |
| Tableau des horizons | **Fait** | Section *Horizons planifiés* ; **à resynchroniser** si les constantes changent dans `engine.ts`. |
| Tap analyseur post-limiteur (viz) | **Fait** | `finalLimiter → analyser` ; `AudioVisualizer` consomme `getAnalyser()`. |
| Tap debug pré-EQ finale | **Fait** | `getAnalyserDebugPreFinalEq()`, méthodes debug spectre / bande basse. |
| Audit *infinite automation* + revert | **Fait** | Comportement stable = horizons synchrones (ex. commit `7b9f4df`). |
| Refactor EU / US sans `id.includes` dans le moteur | **Non fait** | `engine.ts` : `buildSynth` (deux tons FR police vs pompiers) et `createHorn` utilisent encore `includes` / `startsWith` sur `instance.id`. |
| Store : règles de mixage | **Partiel** | Logique surtout par `kind` ; exception `isFrAmbuId` = `id.startsWith('eu-ambu-')` (acceptable mais couplée au préfixe). |
| Tests automatisés audio | **Absent** | Pas de suite de tests (Vitest, etc.) pour régression loudness / graphe. |

---

## Audit (rappel — avril 2026)

### Ce qui a posé problème

- Un mode **« infinite automation »** s’appuyait sur **`setTimeout`** + re-planification avant la fin d’un segment audio, pour enchaîner des **chunks** de `setValueAtTime` / rampes.
- **Symptôme** : modulation qui semblait **se figer** (note tenue) sur plusieurs presets — la courbe audible dépendait trop du **thread JS** pour prolonger la timeline, au lieu d’avoir toute la modulation déjà enqueue dans Web Audio.

### Décision retenue

- **Retour** à une planification **synchrone** au moment du `play` : boucles **`horizonCycles` / `horizonSteps`** qui remplissent la timeline Web Audio d’un coup (voir section *Automation longue durée*).
- Commit de référence côté dépôt : **`7b9f4df`** (*restore synchronous Web Audio automation horizons*).

### Pistes écartées (pour l’instant)

- Re-planification JS **sans** garantie de déclenchement à temps (onglet en arrière-plan, charge main thread) reste **à risque** pour la continuité perçue.
- Toute future approche « infinie » devrait idéalement **ne pas** dépendre du timer JS pour la **forme** de la modulation (ex. courbe très longue, `AudioWorklet` + param, ou stratégie validée par tests navigateur).

---

## Plan d’action — reste à faire (à jour)

Les lignes ci-dessous remplacent l’ancien tableau unique : elles indiquent ce qui est **encore ouvert** ou **à entretenir**, et ce qui est **déjà couvert** ailleurs dans ce doc.

### Entretien / QA (P1)

| Action | Statut | Critère de done |
|--------|--------|------------------|
| **Validation listening** (régression post-revert horizons) | ⬜ *manuel* | WAIL, YELP, deux tons / trois tons FR, horn EU/US : modulation audible, pas de fige ; loudness cohérent entre presets. Aucune trace dans le dépôt : à documenter (notes de release ou checklist interne) si besoin. |
| **Aligner le tableau *Horizons planifiés*** avec `engine.ts` | 🟡 *maintenance* | À chaque changement de `horizonCycles`, `horizonSteps`, `cycleSec`, `everyMs` dans le code, mettre à jour la table plus bas. |

### Mesure & calibration (P2)

| Action | Statut | Critère de done |
|--------|--------|------------------|
| **Procédure RMS post-limiteur** | ⬜ | Définir comment mesurer (outil externe, durée d’échantillon, voix seule, même gain UI) et consigner les résultats cibles par `SoundKind` ou par id critique ; option : exposer une aide dans l’app debug (moyenne RMS sur N ms sur le tap post-limiteur). |
| **Tests de non-régression** (optionnel mais utile) | ⬜ | Ex. Vitest + mock minimal, ou script manuel documenté : au moins un test qui vérifie que `buildSynth` ne jette pas et que les constantes d’horizon restent dans des bornes attendues. |

### Architecture produit (P2)

| Action | Statut | Critère de done |
|--------|--------|------------------|
| **Refactor `engine.ts` : fin des `id.includes` / `startsWith`** | ⬜ | Passer la **variante** nécessaire au moteur via `SoundPreset` ou données dérivées de `SoundDefinition` (ex. `region`, `emergency`, ou `variant: 'police-fr' \| 'fire-fr'`) pour `buildSynth` et `createHorn`, sans parser la chaîne `id`. |
| **Store** : réduire `startsWith('eu-ambu-')` si possible | ⬜ *faible* | Exprimer la règle ambu FR avec `kind` + métadonnées de config (ex. groupe « ambu EU ») pour limiter le couplage aux préfixes d’`id`. |

### Long terme (P3)

| Action | Statut | Critère de done |
|--------|--------|------------------|
| **Modulation « infinie »** si besoin produit | ⬜ | Spécification + approche **sans** dépendance aux timers JS pour la forme de la courbe (worklet, très longue courbe unique validée navigateurs, etc.). |

### Déjà traité (ne pas re-prioriser sans nouvelle régression)

- Revert *infinite automation* → horizons Web Audio synchrones.
- Loudness statique par `kind` (sans apprentissage runtime).
- Double tap analyseur (prod / debug) et viz branchée sur le tap prod.

### Horizons planifiés (référence code actuelle)

Constantes dans `engine.ts` ; durées **indicatives** quand le cycle intègre du jitter (WAIL / YELP).

| Voix / famille | Constante | Formule indicative | Ordre de grandeur |
|----------------|-----------|--------------------|-------------------|
| Trois tons FR | `horizonCycles = 220` | `220 × cycleSec`, `cycleSec = (3 × 180 ms) + 1,1 s` | **~6 min** |
| WAIL (asymétrique) | `horizonCycles = 90` | `90 × baseCycleSec` (4 s × jitter ~±0,9 %) | **~6 min** |
| YELP (continu) | `horizonCycles = 720` | `720 × baseCycleSec` (0,25 s × jitter ~±1,2 %) | **~3 min** |
| Deux tons FR / police | `horizonSteps = 600` | `600 × (everyMs / 1000)` selon preset (ex. 560–1200 ms) | **~5,6 à 12 min** |
| `createSwitchedTone` | — | `setInterval(everyMs)` (hors horizon Web Audio fixe) | Tant que la voix est active |

---

## Fichiers liés

- Graphe et voix : `src/audio/engine.ts`
- Routage UI / exclusion : `src/store/sirenStore.ts`, `src/utils/sirenConfig.ts`
- **Horns — réalisme (audit, design, plan)** : [`docs/horn-realism.md`](horn-realism.md)
