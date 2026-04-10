# Horns — audit, design cible et plan d’implémentation

Document de travail pour améliorer le réalisme des klaxons / air horns dans `createHorn` (`src/audio/engine.ts`), sans casser l’architecture globale du moteur.

## État d’implémentation (moteur)

- **Fait (Phases A, B, B2)** : variante `HornVariant` + `getHornVoiceConfig` / `resolveHornVariant`, bus **`hornMix`** avec enveloppe dédiée, formes d’onde par type (saw/square/saw feu ; square police ; triangle standard), **plus de drift LFO** sur les horns, bruit de fond routé vers `hornMix`, **burst air** (bruit blanc court + bandpass + enveloppe) pour `usFireAir` uniquement.
- **Police US** : chemin **sample** prioritaire — fichier `public/audio/horn-police-us.wav` ou `.mp3`, boucle `AudioBufferSourceNode` → gain → bandpass léger → `hornMix`. Si absent : **fallback synthèse** (bruit + saturation + filtre + LFO sur fréquence du BP). Voir `public/audio/README.md`.
- **À faire (Phase C)** : alternance ou modulation police via automation Web Audio, `PeriodicWave` asymétrique optionnel, compresseur léger sur `hornMix`.

---

## 1. Audit de l’existant

### 1.1 Ce que fait le code aujourd’hui (`createHorn`)

| Élément | Implémentation |
|---------|----------------|
| **Discrimination des types** | `instance.id.includes('amer-fire')`, `amer-police`, `startsWith('eu-')`, sinon défaut US générique. |
| **Sources** | 3 oscillateurs **`square`** en parallèle, fréquences fixes par type, léger `detune` par couche. |
| **Chaîne par osc** | `connectOscWithTimbre` : **WaveShaper** (`tanh(drive/12 * x)`) → **low-pass** (cutoff et Q selon type) → `voiceInput`. |
| **LFO sur la hauteur** | `attachAnalogDrift` sur **chaque** osc (0,05 Hz, ±3 Hz) : vibrato lent commun à tous les horns. |
| **Niveau global** | `gainNode.gain` : `0 → 0,55` en 12 ms, puis `setTargetAtTime(0,5, …)` — enveloppe **uniquement** sur le gain de voix, pas sur les sources. |
| **Couche « air »** | `attachNoiseLayer` (bruit coloré bouclé, HPF ~220 Hz), gain 0,012 (feu) / 0,006 (autres). |
| **Autre** | `attachGainWobble` sur le gain de voix (0,1 Hz, faible profondeur). |

Les oscillateurs tournent à **amplitude nominale constante** ; toute la dynamique perçue passe par le `gainNode` + master.

### 1.2 Pourquoi le rendu manque de réalisme (par axe)

#### Forme d’onde / timbre

- **Carré pur** (harmoniques impaires régulières) : son très **« synthèse numérique »**, proche d’un jeu vidéo des années 80–90. Les trompes à air réelles et beaucoup de klaxons électromécaniques ont un spectre **plus irrégulier** : transitoires asymétriques, partiels inharmoniques, saturation d’amplificateur / membrane non linéaire.
- **Même recette pour les 3 types** : seules les listes de fréquences, le drive et le cutoff changent. Le **police US** ne se distingue pas structurellement d’un empilement de carrés filtrés (peu « électronique / modulé » au sens produit).

#### Enveloppe / dynamique

- **Pas d’attaque transitoire** sur le timbre : une vraie trompe à air a souvent un **choc initial** (ouverture valve + onde de choc / montée de pression) puis un **palier** avec parfois du **pompage** ou du souffle. Ici, les osc démarrent en phase instantanée (Web Audio) avec amplitude constante ; seul le **gain** monte vite — on entend surtout un **fade-in** du son déjà formé, pas une percussion d’air.
- **Sustain plat** : peu de variation d’intensité type compresseur d’air ou limiteur acoustique.
- **Aucune compression dédiée** sur la sous-chaîne horn : la dynamique est « linéaire » avant le chaînage master déjà partagé avec toutes les voix.

#### Harmoniques & layering

- Trois carrés décalés en fréquence **ajoutent** des partiels mais restent **cohérents harmoniquement** (multiples d’une fondamentale implicite) : timbre encore **trop propre**.
- **Pas de couche transitoire** (click, burst de bruit large bande, impulsion courte) séparée de la couche « tenu ».
- Le **bruit** est la même texture pour tous les cas, avec un HPF fixe : peu ressemblant à un **souffle d’air** (souvent plus d’énergie mid/high et structure non stationnaire).

#### Filtrage

- Un seul **LP** par voie osc : correct pour adoucir les aigus, mais **pas de HPF** sur le bus horn pour retirer le grave inutile ou éviter l’encrassement du mix ; **pas de bande-pass** pour isoler une « forme » de klaxon police.
- Le **cutoff fixe** ne suit pas une enveloppe (certaines sources réelles ont un léger **assombrissement** après l’attaque).

#### Modulation

- **Drift lent sur chaque oscillateur** : effet **organique générique**, utile pour les sirènes continues ; pour un **klaxon tenu** ou une **trompe**, ça peut sonner comme un **désaccord instable** plutôt que comme une source puissante stable.
- **Wobble de gain** identique pour tous : ne modèle pas une modulation **électronique** (tremolo rapide, battement entre deux tones) propre au police horn.

#### Spatialisation

- **Mono** : acceptable pour un outil utilitaire ; l’absence de spatialisation n’est **pas** la cause principale du manque de réalisme. Amélioration **priorité basse** (léger chorus / doublement très court si besoin).

#### Comparaison qualitative avec des références réelles

| Type | Référence réelle (ordre d’idée) | Écart principal avec l’implémentation actuelle |
|------|----------------------------------|-----------------------------------------------|
| **Feu US / air** | Trompes à air camion (souvent très fortes, son « soufflé », parfois plusieurs impulsions ou un tenu très bruité) | Trop **propre** (carrés + tanh), attaque **douce** via gain, pas de **transient** type valve, pas assez de **largeur spectrale** / chaos contrôlé. |
| **Police US** | Klaxons / avertisseurs souvent **bi-ton alternés** ou **électroniques** avec motif clair | Ici **tri-ton simultané** stable : son **continu buzzy**, pas le **caractère alterné / motif** souvent associé aux références pop culture et à certains véhicules. |
| **Standard / EU** | Klaxon classique **deux tons proches** (battements) | Les fréquences 420 / 428 Hz sont crédibles pour le **battement** ; le **timbre carré saturé** reste **trop dur** par rapport à beaucoup de disques / cornes plus **ronde** ou **cuivré**. |
| **Défaut `[320, 360]`** | Ambigu (non typé EU/US dans la config) | Même problème : **générique carré**, pas une identité claire « klaxon véhicule civil ». |

---

## 2. Recommandations techniques (par type)

Objectif : rester en **Web Audio API** (pas d’AudioWorklet obligatoire en phase 1), **coût CPU** raisonnable (quelques nœuds de plus par voix horn, pas de convolution longue).

### 2.1 Air horn (pompiers US)

**Design sonore recommandé**

- **Couche A — Tenu** : mélange **saw** + **square** (ou saw dominante) sur **2–3 partiels** graves / medium-graves (ex. ~150–280 Hz domaine), **désaccordage** léger (cents) plutôt que gros drift LFO.
- **Couche B — Transient** : très court **burst de bruit** (white/pink) **enveloppé** (10–40 ms), **band-pass** ou **HP** autour 400–2000 Hz, mix faible à moyen → sensation **d’air / valve**.
- **Saturation** : garder waveshaper ou **tanh** sur un **bus** horn (somme des couches avant filtre final), drive **élevé** mais avec **LP** plus bas que l’actuel si le son « crame » trop dans les aigus (ex. 1,8–2,2 kHz pour le feu).
- **Compression** (optionnel, léger) : **DynamicsCompressor** sur le sous-graphe horn seulement, ratio modéré, attack court, release moyen → **pression** plus constante.

**Réglages indicatifs (à affiner à l’écoute)**

| Paramètre | Ordre de grandeur |
|-----------|-------------------|
| Partiels fondamentaux | ~170–270 Hz (répartis, pas harmoniques parfaites) |
| Mix saw / square | ~60/40 à 70/30 |
| Attaque transient bruit | 8–25 ms montée, 20–60 ms decay |
| Enveloppe gain bus « tenu » | Attack 3–15 ms, sustain élevé, léger **droop** optionnel (exponential) sur 200–500 ms |
| LP final horn | ~1,8–2,4 kHz |
| Drift LFO sur oscillateurs | **Réduit ou supprimé** pour le feu (stabilité de pression) |

**Approche** : **synthèse simplifiée** + **couche stochastique courte** ; pas besoin de samples pour une première itération significative.

---

### 2.2 Police horn / klaxon US

**Design sonore recommandé**

- **Identité « électronique »** : préférer **deux** oscillateurs (ou alternance **automatisée** sur la timeline avec `setValueAtTime` sur un gain ou sur la fréquence) pour simuler **hi/lo** ou **yelp lent**, plutôt que 3 carrés fixes en permanence.
- **Forme d’onde** : **square** ou **pulse** avec duty cycle ≠ 50 % (via table custom ou `PeriodicWave` asymétrique) pour un côté plus **nasillard / buzz**.
- **Modulation** : **LFO** sur le gain du bus horn (4–12 Hz, faible profondeur) **ou** battement entre deux fréquences proches (±5–15 Hz) ; option : **trémolo** plus rapide que le wobble actuel.
- **Filtre** : **band-pass** ~300–1200 Hz ou **LP** ~2,5–3,5 kHz + léger **HP** ~200 Hz pour retirer le boueux.

**Réglages indicatifs**

| Paramètre | Ordre de grandeur |
|-----------|-------------------|
| Tons Hi / Lo (si alternés) | typ. ~650 Hz / ~500 Hz ou paires documentées sur références choisies |
| Cadence d’alternance | 2–6 Hz (comme un motif d’avertisseur) |
| Tremolo | 5–10 Hz, depth 0,05–0,15 sur un gain intermédiaire |
| Saturation | modérée (moins que feu) pour garder le côté « buzz électronique » |

**Approche** : **synthèse + automation de paramètres** (toujours dans la timeline Web Audio au moment du `play` ou sur une courte boucle schedule) ; cohérent avec l’architecture actuelle sans worklet.

---

### 2.3 Klaxon standard (autres véhicules / EU / défaut)

**Design sonore recommandé**

- **Deux tons proches** : conserver l’idée **420 / 428 Hz** (ou proche) pour le **battement** ; passer en **triangle** ou **sine** légèrement saturée, ou **mix sine + faible square** (ex. 75/25) pour éviter le carré dur.
- **Enveloppe** : attaque **légèrement** plus lente que le feu (15–40 ms) sur un **gain de bus** dédié horn, sustain stable.
- **Peu ou pas de bruit** ; drift **très faible** ou nul.
- **LP** doux ~2–3 kHz ; option **notch** ou EQ léger si un pic gênant.

**Approche** : **synthèse minimale** (2 osc + bus + filtre) — **gain CPU** minimal, gros impact perceptif vs 3 carrés saturés.

---

## 3. Plan d’implémentation

### Phase A — Refactor structurel (faible risque)

1. **Introduire une variante horn explicite** (éviter de seulement parser `id`) :  
   - soit étendre `SoundPreset` / données passées depuis `play` avec `hornVariant: 'usFireAir' | 'usPolice' | 'standard'`,  
   - soit dériver la variante depuis `SoundDefinition` dans le store (aligné avec la doc *EU / US*).  
2. **Scinder `createHorn`** en `createHornUsFire`, `createHornUsPolice`, `createHornStandard` **ou** une fonction unique avec un objet de config par variante (fréquences, courbes, flags).  
3. **Garder** `instance.voiceInput → … → gainNode` inchangé pour ne pas casser le master.

### Phase B — Quick wins (impact / effort)

| Étape | Action | Effort |
|-------|--------|--------|
| B1 | **Désactiver ou réduire** `attachAnalogDrift` sur les horns (ou par variante : off feu, faible standard). | Très faible |
| B2 | Remplacer **carré pur** par **triangle / saw / mix** selon tableau section 2. | Faible |
| B3 | Ajouter un **GainNode bus** interne « hornMix » : sources → hornMix → `voiceInput` ; enveloppe sur **hornMix.gain** + possibilité transient bruit sur une branche. | Faible |
| B4 | **Transient bruit** (BufferSource one-shot ou segment court) uniquement **usFire**. | Moyen |

### Phase C — Réalisme poussé

| Étape | Action | Effort |
|-------|--------|--------|
| C1 | **Alternance hi/lo** police : automation `gain` ou `frequency` sur timeline (quelques secondes de motif loopable). | Moyen |
| C2 | **PeriodicWave** asymétrique ou pulse width pour police. | Moyen |
| C3 | **Compressor** léger sur bus horn par variante. | Faible |
| C4 | (Option) **Fichiers audio** très courts (10–80 ms) pour attaque air horn ; lecture `AudioBufferSourceNode` une fois au hold. | Plus élevé (assets + pipeline) |

### Phase D — Validation

- Voir section 4 ; itérer réglages dans des **constantes nommées** en tête de module ou objet `HORN_PRESETS`.

**Priorisation suggérée** : **A → B1–B3 → B4 → C1 → C2–C3** ; **D** en continu.

---

## 4. Critères de validation

### Perception à l’écoute

- **Air horn** : impression de **pression** et d’**énergie** ; attaque **identifiable** ; moins « jeu vidéo », plus **soufflé / massif**.
- **Police** : reconnaissable comme **différent** du feu et du standard ; présence d’un **motif** ou d’une **modulation** évoquant l’électronique.
- **Standard** : **clair**, **battement** audible si bi-ton proche, sans dureté excessive.

### Comparaison A/B

- Écoute **avant / après** sur le même casque / enceinte, niveau RMS comparable (utiliser le tap analyseur **post-limiteur** existant pour éviter de se tromper sur le volume perçu).
- Option : enregistrer **références** (libres de droits ou enregistrements terrain autorisés) et comparer **spectre** (pics, largeur) et **enveloppe** sans viser une copie sample à sample.

### Cohérence dynamique et fréquentielle

- Pas de **DC** ou offset audible (les shapers actuels sont impairs — à préserver sur les nouveaux traitements).
- Niveau **cohérent** entre les trois types dans le mix (réajuster `staticCompensation` / gain de preset si besoin).
- **CPU** : sur machine milieu de gamme, pas de saccades avec plusieurs voix ; éviter fftSize / worklets lourds sur la voie horn.

---

## 5. Fichiers concernés

- Implémentation : `src/audio/engine.ts` (`createHorn`, `connectOscWithTimbre`, helpers bruit / enveloppes).
- Config : `src/utils/sirenConfig.ts` + éventuellement `play()` / types pour **variante horn**.
- Store : `src/store/sirenStore.ts` si la variante est dérivée de la définition plutôt que de l’`id`.

---

## 6. Références audio crédibles (hors code)

Ne pas intégrer de fichiers protégés sans droits. Pour le calage :

- Rechercher des enregistrements **Creative Commons** / domaine public (« federal Q siren », « truck air horn », « police siren horn », « European car horn ») et noter **durée d’attaque**, **largeur spectrale**, **présence de battements** ou d’**alternance**.
- Viser la **cohérence entre véhicules** d’une même catégorie plutôt qu’un modèle unique de microphone.

---

*Document généré pour cadrage développement ; à mettre à jour après implémentation (réglages finaux, captures spectre, décisions trade-off CPU).*
