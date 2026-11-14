# 2026-11-14 — Menu latéral Android (portrait) : les sous-onglets ne se referment plus au défilement

## Tâche
Signalement : sur Android en portrait, les sous-onglets du menu latéral disparaissent dès qu'on fait défiler ; en paysage, tout fonctionne.

## Cause
Deux fermetures automatiques dans `public/ext-shell.js` :
1. `scroll` (capture) appelait `closeAll()` à chaque défilement, y compris celui du tiroir mobile lui-même (≤ 860 px, sous-menus intégrés à la liste).
2. `resize` appelait `closeAll()` à chaque évènement : sur Android/Chrome, le défilement masque/affiche la barre d'adresse, ce qui déclenche des `resize` (hauteur seule). En paysage (> 860 px, sous-menus flottants, pas de défilement du tiroir) aucun des deux ne se produisait.

## Changements réalisés
- `public/ext-shell.js` :
  - `resize` : `closeAll()` seulement si la largeur de la fenêtre change (rotation, redimensionnement réel) ; le reste du handler est inchangé.
  - `scroll` : ignoré sur mobile (≤ 860 px) ; sur grand écran, conserve l'exemption existante des défilements à l'intérieur d'un sous-menu flottant (ajoutée par un autre intervenant, fusionnée sans l'écraser).
- `public/sw.js` : régénéré par `node scripts/build-sw.js` (nouveau nom de cache → le correctif est servi aux appareils déjà installés).

## Tests
- `node --check public/ext-shell.js` : OK.
- `build-sw.js --check` : OK.
- Statiques exécutés, tous réussis : sw-coherence (7/7), repo-hygiene (7/7), links-audit, fleet-ui (6/6), messaging-bell-opens-unread (8/8), my-profile (8), about-page (13/13), client-company-name-header (10/10), homepage-mobile (8/8), sidebar-pub-fit (8/8).

## Non vérifié
- Test sur appareil réel (Android portrait/paysage) : non exécuté, à confirmer par le propriétaire après déploiement.
- Tests Playwright / UI (`test:ui`, `test:ui-shell`) : non exécutés (`node_modules` absent, installation réseau bloquée dans cette session).

## Risques
- Faible : sur grand écran, comportement inchangé hormis les `resize` à largeur identique (qui ne ferment plus les sous-menus).

## Branche / commit / déploiement
Branche `fix/menu-lateral-mobile-scroll` (basée sur `origin/main` c4a1657). Commit et statut de déploiement : voir compte rendu.
