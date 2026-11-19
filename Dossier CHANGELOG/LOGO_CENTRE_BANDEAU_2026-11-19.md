# Logo centré dans le bandeau par défaut (2026-11-19)

## Modifications
- `public/banner-logo.webp` (nouveau) : recadrage du logo Manager PRO, 530×360, centré.
- `public/banner-defaut.webp` supprimé (remplacé par le recadrage ci-dessus).
- `public/ext-banner.js` : photo par défaut = logo centré ; le bandeau par défaut reçoit la classe `is-default`.
- `public/ext-banner.css` : pour le bandeau par défaut, l'image est affichée entière (`contain`, centrée) et n'est jamais recadrée. Sur téléphone (≤ 600 px), le nom et le slogan sont masqués pour laisser voir le logo.
- `public/sw.js` régénéré.

## Vérifications
- `test/banner-static.js` : 15/15.
- Simulation 390×844 et 1280×800 sans réponse de l'image : logo entièrement visible et centré, un seul bandeau, aucune erreur console.

## Non vérifié
- Rendu sur un vrai téléphone et avec une photo propre à la station.
- Le fond autour du logo reste visible en bandes (bleu nuit) sur les côtés.
