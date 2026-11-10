# Compte rendu des tests — exports PDF et filtres (2026-11-08)

## Exécutés (environnement sans PostgreSQL, sans pdfkit Node, sans réseau)
- Syntaxe `node --check` de tous les fichiers modifiés : OK.
- Tests statiques/unitaires existants (`test/*-static.js`, `*-unit.js`) : tous OK, sauf `my-profile-static` et `shift-attribution-static`, qui échouaient déjà sur l'archive d'origine (motif de version de cache).
- `test/report-ui-harness.js` (Chromium + API simulée, charges PDF validées contre le schéma zod réel de `docs_render.js`) : 22 contrôles OK — filtre, réinitialisation, début > fin, date manquante, période sans données, filtres combinés (client + période), totaux (cartes, journal 250 lignes, commissions, fin de journée), groupes de statuts du rapprochement, cases cochées de Mes stations, repli de la carte, bouton PDF masqué sans droit, aucune erreur JavaScript.
- `test/pdf-engine-stub.js` (pdfkit simulé) : chemins `options`, `image`, `period`, image invalide, tableau vide : OK.
- Contraste du bouton actif : texte blanc après correctif (reproduit illisible avant).

## NON exécutés — à faire sur une base de test
- Requêtes SQL nouvelles (fleet, finance, ops_plus) : relues, non exécutées.
- Rendu visuel réel des PDF (pdfkit), impression A4, pagination d'un grand volume.
- Capture réelle de la carte Mapbox (dépend du jeton et de CORS des tuiles).
- `npm test` d'intégration.
