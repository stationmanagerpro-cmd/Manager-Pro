# Besoin d'aide — 2026-11-17

Branche : `feat/besoin-aide` (locale, base `origin/main` fe46b76). **Non poussée, non fusionnée, non déployée.**

## Réalisé (première étape)
- Bouton « Besoin d'aide ? » en haut à droite de la bannière (`public/index.html`, `.brandbar-right`).
- Vue « Besoin d'aide » : une carte par module accessible (`public/ext-help.js`, droits vérifiés par `canView`).
- Aucun contenu inventé : chaque carte indique que la procédure et la vidéo restent à renseigner.
- Style : `public/responsive-v3.css` (bouton et cartes).
- `public/sw.js` régénéré ; `--check` à jour.

## Décisions validées par le propriétaire
- Bouton dans l'en-tête (recommandé).
- Modification des procédures et liens vidéo : Super Admin uniquement.
- Disposition : cartes par module.

## Tests
- `test/besoin-aide-static.js` : 6 contrôles réussis.
- Suite complète : seuls échecs `employee-actions-unit` et `stock-movement-validation-unit` (stub zod, limite de l'environnement, déjà connus).

## Non vérifié
- Rendu réel de la bannière et de la vue (navigateur, mobile 390 px).

## Étape 2 : stockage serveur et édition Super Admin
- Migration `migrations/120_help_guides.sql` : table `help_guides` (contenu global, une ligne par module).
- `src/help_guides.js` : `GET /api/help-guides` (tout compte connecté) ; `PUT /api/help-guides/:key` (Super Admin uniquement, 403 sinon, module inconnu 404, lien vidéo https uniquement, modification journalisée).
- Monté dans `src/server.js` après `ops_plus`.
- `public/ext-help.js` : lit le contenu, bouton « Modifier » réservé au Super Admin, lien vidéo ouvert dans un nouvel onglet.

## Tests (étape 2)
- `test/help-guides-unit.js` : 4 contrôles (lecture, 403 client, 404 module inconnu, écriture superadmin + audit).
- `test/besoin-aide-static.js` : 11 contrôles (montage, cohérence des modules interface/serveur, migration).
- Suite complète : seuls `employee-actions-unit` et `stock-movement-validation-unit` échouent (stub zod, limite de l'environnement).

## Non vérifié
- Rendu réel (bannière, vue, modale d'édition) sur bureau et téléphone.
- Application de la migration 120 sur la base de production : à faire au déploiement.

## Retour arrière
Revert des commits de la branche. La table `help_guides` peut rester vide sans effet sur l'application.
