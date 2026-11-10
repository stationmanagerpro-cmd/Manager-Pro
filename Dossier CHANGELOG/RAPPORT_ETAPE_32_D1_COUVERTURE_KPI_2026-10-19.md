# Étape 32 — D1 : couverture des cartes KPI

## Constat

Le décorateur d'icônes ciblait les classes `.kpi-card`, `.dv2-kpi`, `.dv2-mini > div` et `.cards > .card`, mais pas `.dir-kpi`, utilisée par les cartes KPI du tableau de bord direction. La règle de reconnaissance « CA » contenait aussi un caractère de contrôle à la place de la frontière de mot attendue.

## Correctifs

- `.dir-kpi` est maintenant incluse dans la décoration initiale et la détection des cartes insérées dynamiquement.
- La reconnaissance `ca\b` est restaurée.
- Le test `test/kpi-icons-d1-static.js` vérifie explicitement ces deux points.

## Résultats

- `node --check public/ext-design.js` : réussi.
- `node test/kpi-icons-d1-static.js` : 8/8 contrôles statiques réussis.
- Les tests de séparation des rôles et d'isolation multi-client sont exécutés séparément lors de cette étape.

## Limites

Ces contrôles ne prouvent pas la couverture visuelle de chaque écran. Un essai dans le navigateur en thème clair/sombre reste nécessaire.
