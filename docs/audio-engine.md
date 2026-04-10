# Moteur audio — contraintes de conception (prod)

Ce document décrit le graphe Web Audio, la configuration (`src/utils/sirenConfig.ts`), le store et les pratiques de loudness. Il est aligné sur l’implémentation **actuelle**.

## Architecture modulaire (`src/audio/`)

| Module | Rôle |
|--------|------|
| **`engine.ts`** | Orchestration : `AudioContext`, `init` / chargement buffers horns, `play` / `stop`, normalisation + `AUDIO_CALIBRATION`, dispatch vers les builders. |
| **`masterChain.ts`** | `createMasterChain` : bus `mixGain` → pré-EQ → saturateur → compresseur → makeup → `masterGain` → présence / shelf → DC blocker → **limiteur final** ; branchements vers `destination` et analyseurs. |
| **`routing.ts`** | **`connectOscWithTimbre`** (sirènes US / génériques, timbre EU = paramètres drive/LP) ; **`connectFrOscWithTimbre`** / **`connectFrSourceWithTimbre`** (chaîne FR dédiée pour two-tone / trois tons — ne pas mélanger avec l’autre pour une voix FR). |
| **`horns.ts`** | Samples US uniquement : `createHorn`, `setupHornUs*`, gains horn post-calibration. |
| **`debug.ts`** | Buffer de logs, `buildDebugSnapshot`, routage documentaire master. |
| **`types.ts`** | `SoundPreset`, `SoundInstance`, `SirenBuildContext`, etc. |
| **`audioCalibration.ts`** | Table `AUDIO_CALIBRATION` par id. |
| **`sirens/`** | `wail`, `yelp`, `phaser`, `hiLo` (timeline Web Audio), `twoTone` (FR + police + trois tons), `qsiren`. |
| **`utils/`** | `distortion` (courbes), **`audioUtils`** (`measureRMS`, **`getAssetUrl`** pour `import.meta.env.BASE_URL`, bruit, jitter, attaches drift/wobble), `envelopes` (WAIL / YELP). |

Les **`fetch`** d’assets (horns publics, `preloadSamples`) passent par **`getAssetUrl()`** afin de respecter le **base path** Vite en production (sous-dossier).

## Loudness

- **Cible documentée** : calibrer les presets vers une mesure de référence (ex. **RMS ~ −11 dBFS** sur une voix isolée, **après le limiteur**), sans utiliser un seul preset comme référence figée pour toute l’évolution du produit.
- **RMS ≠ loudness perçu** : valider par **mesure** (debug panel : RMS / dBFS post-limiteur) et par **écoute comparative** entre presets.
- **Multi-voix** : pas de loudness « temps réel » qui recalcule le mix sur N voix ; stabilité et prévisibilité avant tout.
- **Pipeline par voix** (dans l’ordre) :
  1. **`getUnifiedGain(kind)`** × **`staticCompensation[kind]`** dans `normalizePresetVolume` (avec **clamp** sur le résultat — bornes versionnées dans le code).
  2. **`AUDIO_CALIBRATION[id]`** (`src/audio/audioCalibration.ts`) : coefficient **par id de bouton**, appliqué **après** la normalisation. Id absent → **1.0**. Permet d’aligner les niveaux perçus sans toucher à la chaîne master.
  3. Cas particulier **horns US en sample** : multiplicateurs **`HORN_POLICE_GAIN`** / **`HORN_FIRE_GAIN`** en plus, sur le gain de voix (voir `play()`).
- **Pas d’apprentissage runtime** sur le gain : pas de `Map` qui modifie le niveau entre deux lectures.

**Master** : saturation + compresseur + EQ + limiteur final — le **limiteur** évite les dépassements grossiers sur le bus de sortie ; le tap **analyseur** principal est **après** ce limiteur (viz + mesures debug).

## Saturation

- **Une seule saturation dominante** sur la chaîne ; l’autre couche reste **subtile**. **Interdit** : deux saturations **fortes** en série.
- **Recommandation** : saturation **dominante = master** ; les voix = **coloration légère** (WAIL/YELP : pré-traitement local tanh + LP, sans chaîne EQ/comp dédiée post-voix).

## Routing EU / US (moteur)

- **Source de vérité** : chaque entrée de **`SIREN_CONFIG`** expose **`regionStyle`** (`'us' | 'eu'`) et **`variant`** (`'fire' | 'police' | 'ambulance'`).
- **`getSoundDefinitionById(id)`** / **`SOUND_DEF_BY_ID`** : résolution par id pour compléter le preset dans **`play()`** si besoin.
- **`buildSynth`** :
  - **twoToneA / twoToneM** : routage FR **pompiers** vs **police** via `preset.regionStyle === 'eu'` et `preset.variant === 'fire' | 'police'` (fréquences / helpers `createTwoToneFr` / `createPoliceFrTwoTone`). Sinon défaut US `[700, 900]`.
  - Plus de **`id.includes('eu-police')`** ni **`startsWith('eu-')`** dans le moteur.
- **`connectOscWithTimbre`** (`routing.ts`) : timbre « Europe » lorsque **`preset.regionStyle === 'eu'`** (drive / cutoff / Q ajustés sur la **même** chaîne shaper+LP que les US — distinct de la chaîne FR **`connectFrOscWithTimbre`** utilisée par `sirens/twoTone.ts`).
- **Store** : **`audioEngine.play`** reçoit **`kind`**, **`regionStyle`**, **`variant`** depuis la définition ; règles de mixage ambu EU : **`isEuAmbulance(def)`** (`regionStyle === 'eu'` && `variant === 'ambulance'`), plus de **`startsWith('eu-ambu-')`**.

## Horns

- **Uniquement des samples** pour les boutons US concernés :
  - **`amer-police-horn`** → `horn-police-us.*`
  - **`amer-fire-airhorn`** → `horn-fire-us.*`
- Pas de synthèse de repli : si le fichier manque, pas de sortie audio (UI : bouton désactivé + tooltip lorsque les buffers ne sont pas chargés).
- Détails produit / fichiers : **`docs/horn-realism.md`**, **`public/audio/README.md`**.

## Automation longue durée

- Les enveloppes de fréquence / gain des sirènes concernées sont **planifiées en une fois** sur un **horizon fixe** (boucles synchrones au moment du `play`), sur la **timeline Web Audio** — pas de re-planification périodique via **`setTimeout`** / **`setInterval`** pour la **modulation** de ces sirènes (y compris **HI-LO** : `createSwitchedTone` dans `sirens/hiLo.ts`).
- Limite : au-delà de l’horizon planifié, la courbe ne s’étend pas ; les lectures continues très longues peuvent nécessiter une évolution future (voir historique *infinite automation* ci-dessous).

## Analyseur & debug

- **Tap principal** : **après le limiteur final** (`finalLimiter → analyser`) — aligné sur ce que l’utilisateur entend ; **`AudioVisualizer`** consomme **`getAnalyser()`**.
- **Debug** : tap **pré-EQ finale** via **`getAnalyserDebugPreFinalEq()`** ; snapshot **`getDebugSnapshot()`** inclut **RMS** / **dBFS** approximatif post-limiteur (**`measureRMS`** sur le tampon temporel).
- **Logs moteur** : **`logDebug`** alimente un buffer interne ; **`console.debug`** uniquement si **`?debugAudio=1`** au chargement (voir `init()`).
- **UI** : panneau debug audio affiché seulement en **`import.meta.env.DEV`**, **`?debug=1`**, ou **`VITE_SHOW_AUDIO_DEBUG=true`**.
- **Récap déclencheurs** : `?debug=1` ou dev ou `VITE_SHOW_AUDIO_DEBUG` → panneau UI ; `?debugAudio=1` (URL au **`init`**) → `console.debug` côté moteur en plus du buffer interne.

## État au dépôt (synthèse)

| Sujet | Statut | Détail |
|--------|--------|--------|
| Loudness `getUnifiedGain` × `staticCompensation` + clamp | **Fait** | `normalizePresetVolume` |
| **`AUDIO_CALIBRATION` par id** | **Fait** | Après normalisation, avant cas horn |
| Cible RMS ~−11 dBFS documentée | **Partiel** | Procédure de mesure manuelle ; debug panel aide au calage |
| Saturation (une dominante master) | **Fait** | |
| Horizons Web Audio (WAIL/YELP/FR) | **Fait** | |
| Routing **`regionStyle` / `variant`** | **Fait** | `sirenConfig` + `play()` + store |
| Horns sample-only US | **Fait** | Pas de horns EU en config |
| Tap analyseur post-limiteur | **Fait** | |
| Tests automatisés audio | **Absent** | |

## Audit (rappel — infinite automation)

Un ancien mode s’appuyait sur **`setTimeout`** pour prolonger la modulation ; cela pouvait **figer** la courbe audible. La décision retenue : planification **synchrone** au **`play`** (horizons **`horizonCycles` / `horizonSteps`**). Référence historique de dépôt : commit **`7b9f4df`**.

## Plan d’action — suivi

### Entretien (P1)

| Action | Critère de done |
|--------|------------------|
| Validation listening après changements de presets | Checklist manuelle (modulation, loudness) |
| Aligner le tableau *Horizons* ci-dessous si les constantes changent dans `engine.ts` | Table = reflet du code |

### Mesure & calibration (P2)

| Action | Critère de done |
|--------|------------------|
| Affiner **`AUDIO_CALIBRATION`** avec RMS debug post-limiteur | Table versionnée + notes de cible dBFS si besoin |
| Tests non-régression (optionnel) | Vitest / script manuel documenté |

### Horizons planifiés (référence code)

| Voix / famille | Constante | Ordre de grandeur |
|----------------|-----------|-------------------|
| Trois tons FR | `horizonCycles = 220` | ~6 min |
| WAIL (asymétrique) | `horizonCycles = 90` | ~6 min |
| YELP (continu) | `horizonCycles = 720` | ~3 min |
| Deux tons FR / police | `horizonSteps = 600` | ~5,6 à 12 min |
| HI-LO | `HILO_HORIZON_STEPS = 600` | ~5 min (pas 500 ms) |

---

## Fichiers liés

- Orchestration : `src/audio/engine.ts`
- Chaîne master : `src/audio/masterChain.ts`
- Routage timbre / voix FR : `src/audio/routing.ts`
- Sirènes par famille : `src/audio/sirens/*.ts`
- Horns samples : `src/audio/horns.ts`
- Calibration par id : `src/audio/audioCalibration.ts`
- Utils (RMS, `getAssetUrl`, …) : `src/audio/utils/audioUtils.ts`
- Routage UI / définitions : `src/store/sirenStore.ts`, `src/utils/sirenConfig.ts`
- Horns (produit) : [`docs/horn-realism.md`](horn-realism.md), `public/audio/README.md`
