# Étape 30 — Partie 1 (13 oct. 2026)

## Objectif
Corrections prioritaires métier + autorisations contrat toutes actives par défaut.

## Modifications

### 1. Autorisations Super Admin → client (toutes actives par défaut)
- `DEFAULT_FEATURES` (src/contracts.js) : déjà tout à `true` — confirmé.
- UI création / édition (public/ext-contracts.js) : champs complets + défauts « true ».
- Création client : champ visible **Créer stations** ; payload `can_create_station` selon formulaire (défaut actif).
- Liste des autorisations UI alignée sur les flags backend (messagerie, alertes, RH, finance, exports, modules…).

### 2. Point 5 — Scanner alertes (déduplication 24 h)
- Fichier : `src/ops_plus.js` — `POST /notifications/scan`
- Avant chaque INSERT : recherche d’une notification identique (station + kind + message) créée dans les **24 dernières heures**.
- Réponse : `{ created, skipped, items }` avec statut `created` / `duplicate`.
- Aligné sur `sendSystemAlert` (messagerie système).

### 3. Point 11 — Octroi compte employé
- `public/ext-roles.js` : `addU(preselectedEmployeeId)` — préselection depuis la fiche employé.
- Station d’attache = station active (`SID`).
- Validations login / mot de passe / employee_id avant envoi.
- `public/app.js` : ancien `addU` sans `employee_id` neutralisé (délègue à `window.addU`).
- `public/ext-core.js` : boutons « Octroyer un accès » passent `addU(e.id)`.

### 4. Renommage compte client après création
- API : `PATCH /admin/clients/:id` (Super Admin) — name, contacts, manager, notes.
- UI édition client : champs nom / responsable / e-mail / téléphone + enregistrement avant contrat.

### 5. Restauration / réinitialisation
- **Non activés** dans cette partie (variables d’environnement).
- Restent **réservés Super Admin** (`needPrincipal` / `is_global`) — aucun privilège client ajouté.
- Activation ultérieure uniquement via env (`RESTORE_ENABLED`, `CLIENT_RESTORE_ENABLED`, etc.) sur décision explicite.

## Fichiers touchés
- src/ops_plus.js
- src/contracts.js
- public/ext-roles.js
- public/app.js
- public/ext-core.js
- public/ext-contracts.js

## Non inclus (parties suivantes)
- Point 1 fiche complète quart
- Points 2/4/6/12 messagerie & alertes E2E
- Points 3/13 multistation UI
- Points 9/10 photo & branding login
- Point 7 menus horizontaux
- Point 8 PDF situation client
- Activation env restore/reset
