# Horns (klaxons / air horns)

## Approche : samples uniquement

Le rendu des horns **américains concernés** est **exclusivement** assuré par des **fichiers audio** lus en boucle depuis le dossier statique du build. Il n’existe pas de branche « horn » synthétisée dans le graphe Web Audio.

### Emplacement des fichiers

Les fichiers doivent être placés à la **racine** du répertoire **`public/audio/`** du projet (servis tels quels à l’URL `…/audio/…` une fois le site construit, avec prise en compte du `base` Vite via `getAssetUrl` dans le moteur).

| Bouton / id | Fichiers reconnus (priorité) |
|---------------|-------------------------------|
| Police US (`amer-police-horn`) | `horn-police-us.wav`, puis `horn-police-us.mp3` |
| Air horn pompiers US (`amer-fire-airhorn`) | `horn-fire-us.wav`, puis `horn-fire-us.mp3` |

Sans fichier valide : **aucune sortie audio** pour ce preset ; l’UI peut désactiver le bouton et afficher une aide (fichier manquant).

### Chaîne audio

Gain, filtres et multiplicateurs **`HORN_POLICE_GAIN`** / **`HORN_FIRE_GAIN`** (après normalisation et `AUDIO_CALIBRATION`) sont implémentés dans **`src/audio/horns.ts`** (`createHorn`, `setupHornUsPoliceFromSample`, `setupHornUsFireFromSample`).

Les **klaxons européens** ne sont pas exposés dans la configuration produit actuelle (`SIREN_CONFIG`).

## Calibration

Niveaux relatifs aux autres boutons : **`src/audio/audioCalibration.ts`** et section Loudness de **`docs/audio-engine.md`**.

## Référence noms / droits

Détails d’export et de nommage : **`public/audio/README.md`**.
