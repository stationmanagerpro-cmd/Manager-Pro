# Icônes recompressées (P-03, 2026-11-20)

## Modifications
- `public/icons/icon-512.png` : 273 806 → 254 711 octets (−19 Ko).
- `public/icons/icon-maskable-512.png` : 162 884 → 155 573 octets (−7 Ko).
- Optimisation PNG sans perte. Format, nom et chemins inchangés (manifeste et service worker inchangés).
- `public/sw.js` régénéré (empreinte de cache changée car le contenu des icônes a changé).

## Vérifications
- Pixels décodés identiques à l'original (comparaison exacte, 512×512, les deux icônes).
- `test/sw-coherence-static.js` 8/8 ; `test/repo-hygiene-static.js` 7/7.

## Alternative non retenue
- Palette 256 couleurs : ~25 Ko et ~18 Ko, mais bandes visibles dans les dégradés bleus : contraire à « sans perte visible ». Non retenu.
- WebP (qualité 92) : ~28 Ko et ~20 Ko, gain réel d'environ 380 Ko, mais changement de format pour les icônes du manifeste : non fait, décision à prendre.

## Gain réel
- Environ 26 Ko (et non 300 Ko, objectif initial, qui n'est atteignable qu'avec une perte visible ou un changement de format).
