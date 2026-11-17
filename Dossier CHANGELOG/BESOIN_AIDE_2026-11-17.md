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

## Reste à faire
- Stockage serveur des procédures et liens vidéo (table, route, contrôle Super Admin) : non commencé.
- Édition par le Super Admin dans l'interface : non commencée.

## Retour arrière
Revert du commit `802343f`. Aucune migration, aucune donnée.
