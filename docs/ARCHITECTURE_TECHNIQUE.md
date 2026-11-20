# Architecture technique — Station Manager Pro

Date de mise à jour : 2026-11-20. Vérifié sur `main` au commit `485c128` (comptages faits sur le dépôt ce jour).

## 1. Technologies
- Serveur : Node.js + Express (`src/server.js`), routes montées sous `/api`.
- Base de données : PostgreSQL. Migrations `migrations/NNN_nom.sql` (122 fichiers), exécutées par `src/migrate.js` (une transaction par fichier, verrou consultatif, table `schema_migrations`).
- Front : JavaScript sans framework (`public/*.js`, 103 fichiers), feuilles de style `public/*.css`.
- Service worker : `public/sw.js`, généré par `scripts/build-sw.js` (`npm run build:sw`). Ne jamais le modifier à la main.
- Android : dossier `android/` (projet séparé ; non compilé dans l'environnement de développement).
- Déploiement : `Dockerfile`, `Caddyfile`, hébergement PC (voir `docs/HEBERGEMENT_PC_WINDOWS_TAILSCALE_FUNNEL.md`).

## 2. Structure
| Dossier | Contenu |
|---|---|
| `src/` | Serveur : routes et logique métier (116 modules). Un fichier par domaine (ventes, quarts, stocks, RH, finance, fiscalité, bandeau, aide…). |
| `public/` | Interface web : `app.js` (démarrage, navigation, vues), `ext-*.js` (extensions par domaine : bandeau, menu, aide…), `index.html`. |
| `migrations/` | Schéma SQL, ordre alphabétique des noms de fichiers. |
| `test/` | Tests statiques (lecture du code) et unitaires ; `test/all.js` les enchaîne ; 238 fichiers de test au total. |
| `scripts/` | Outils : construction du service worker, sauvegarde, diagnostic, paquetage. |
| `docs/` | Documentation de référence (voir `CAHIER_DES_CHARGES.md`). |
| `Dossier CHANGELOG/` | Journal des livraisons : un fichier par changement, daté. |

## 3. Conventions
- Permissions : `needPrincipal` contrôle `req.user.is_global` (superadmin). Le middleware de station (`src/core.js`, vers les lignes 74–84) exige `X-Station-Id` sauf pour le superadmin.
- Front : `canView(k)` (`public/app.js`) décide des vues accessibles ; le menu est construit par `public/ext-shell.js`.
- Bandeau : `public/ext-banner.js` (pose, photo, repli), styles `public/ext-banner.css`, `public/ext-skin-pro.css`. Au démarrage, `index.html` pose `data-hero-pending` : l'en-tête reste masqué jusqu'à la pose du bandeau (repli à 10 s).
- Aide : `public/ext-help.js` (bouton « Besoin d'aide »), `src/help_guides.js`.
- Une livraison = changelog daté dans `Dossier CHANGELOG/` + commit + `npm run build:sw` + tests ciblés.

## 4. Tests disponibles
- Tous : `npm test` (`test/all.js`). Sécurité : `npm run test:security`. Restauration : `npm run test:restore`.
- Bandeau : `npm run test:banner`. Service worker : `npm run test:sw-coherence`.
- Sur l'environnement de développement, les tests qui chargent les dépendances serveur (express, pg, zod, exceljs, jsdom…) ne peuvent pas tourner : les `node_modules` sont incomplets et l'installation réseau est bloquée. Les tests statiques (lecture de fichiers) tournent.

## 5. Limites connues
- PostgreSQL n'est pas disponible dans l'environnement de développement : les migrations et le comportement SQL sont vérifiés par simulation ou sur une base de test, pas en production.
- Pas de rendu sur appareil réel dans l'environnement de développement (simulation navigateur seulement).
