# Fichiers audio (assets statiques)

## Horn police US

Pour un rendu **sample** au lieu du fallback synthèse :

1. Enregistrer ou obtenir un extrait court (**0,3 à 1 s**) d’un horn police réel (droits d’usage respectés).
2. Exporter en **WAV** ou **MP3** (mono ou stéréo).
3. Placer le fichier sous l’un des noms suivants à la **racine de ce dossier** :
   - `horn-police-us.wav` *(prioritaire)*  
   - `horn-police-us.mp3`

Le moteur charge le sample au `init()` ; s’il est absent, le horn police US utilise une **synthèse de secours** (bruit filtré).
