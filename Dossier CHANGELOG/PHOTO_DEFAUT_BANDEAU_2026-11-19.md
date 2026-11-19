# Photo par défaut du bandeau (2026-11-19)

## Modifications
- `public/banner-defaut.webp` (nouveau) : photo Manager PRO (station-service), 1600×900, 200 Ko.
- `public/ext-banner.js` :
  - la photo par défaut s'affiche immédiatement pendant le téléchargement de la photo de la station ;
  - elle reste affichée si la station n'a pas de photo ou si le téléchargement échoue (5 s) ;
  - la signature de rendu inclut désormais l'adresse de la photo, pour que la photo réelle remplace bien la photo par défaut.
- `public/sw.js` régénéré.

## Vérifications
- `test/banner-static.js` : 15/15.
- Simulation 390×844 sans réponse de l'image : la photo par défaut s'affiche, un seul bandeau, aucune erreur console.

## Non vérifié
- Remplacement effectif par la photo propre de la station (test avec image réelle non fait).
- Cadrage sur téléphone : la photo est recadrée, le logo du haut peut être partiellement coupé.
