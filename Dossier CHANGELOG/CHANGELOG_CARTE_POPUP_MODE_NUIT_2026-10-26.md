# Carte : bulle d'information lisible en mode nuit (2026-10-26)

- Cause : Mapbox impose un fond blanc à la bulle (`.mapboxgl-popup-content`) alors que le texte suit le thème (clair en mode nuit) : texte gris clair sur fond blanc.
- Correctif : `public/responsive-v3.css` — la bulle, sa pointe et son bouton de fermeture utilisent les variables du thème (`--c`, `--t`, `--m`, `--bd`).
- `public/sw.js` : cache PWA `smp-static-v53` pour que les appareils rechargent la feuille de style.
