# Photo par défaut entière et centrée (2026-11-19)

## Modifications
- `public/ext-banner.js` : le bandeau par défaut reçoit la classe `is-default`.
- `public/ext-banner.css` : pour le bandeau par défaut, l'image est affichée entière (`contain`, centrée), jamais recadrée. Sur téléphone (≤ 600 px), le nom et le slogan sont masqués pour laisser voir le logo.
- `public/sw.js` régénéré.

## Vérifications
- `test/banner-static.js` : 15/15.
- Simulation 390×844 et 1280×800 sans réponse de l'image : logo entièrement visible et centré, aucune erreur console.

## Non vérifié
- Rendu sur un vrai téléphone et avec la photo propre d'une station.
- Le bouton « Besoin d'aide » recouvre le bord droit de l'image sur téléphone.
