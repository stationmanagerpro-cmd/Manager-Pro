# AUDIT COMPLET — Station Manager Pro — 14 octobre 2026

## Périmètre
Application multi-tenant de gestion de stations-service (Node.js + PostgreSQL + UI HTML/JS).
Archive source : `Station_Manager_Pro_CORRIGE_2026-10-14.zip`.

## Correctifs appliqués (lot VERIFICATION)

| # | Problème | Cause racine | Correctif |
|---|----------|--------------|-----------|
| 1 | Interface fournisseur | Liste sans accès fiche/édition fiable | Bouton Fiche + modal + editSup ; bascule supdet si dispo |
| 2 | Une seule ligne de facture | UI `billNew` ne construisait qu’une ligne | Formulaire multi-lignes (8 lignes max) branché sur API existante |
| 3 | Profil employé cassé | Pas de GET `/employees/:id` ni UI profil | Routes GET/PATCH + bouton Profil / Modifier |
| 4 | Messagerie client↔SA / client↔users | Feature flag contrat | Déjà codée ; activation via `can_use_messaging` / `messaging_support` sur le contrat |
| 5 | Fiscalité visible mais « non autorisé » | Vues enregistrées avec `*` + pas de filtre contrat | `fiscal.access` + `contractAllowsView` + cases contrat |
| 6 | Alertes auto | Scheduler OK si `ALERTS_AUTO≠0` + règles + flag | Documenté ; vérifier config alertes + contrat |
| 7 | Regroupement fiscalité | Mélangé dans Finance & rapports | Groupe menu **« La Fiscalité »** |

## Architecture (rappel)
- `src/server.js` : Express, montage modules, démarrage scheduler alertes
- `src/catalog.js` : produits, clients, fournisseurs, employés
- `src/billing.js` : factures multi-lignes (`invoice_lines`)
- `src/messaging.js` : messagerie + centre d’alertes
- `src/alerts_scheduler.js` : scan périodique 5 min
- `src/fiscal.js` : module fiscalité (parcours client uniquement)
- `src/contracts.js` : features / modules par contrat client
- `public/app.js` + `ext-*.js` : UI

## Sécurité / multi-tenant
- Isolation par `station_id` / `client_id` présente sur les routes métier
- Superadmin (`is_global`) exclu des ops station et fiscalité opérationnelle
- Permissions rôle + flags contrat

## Points de vigilance restants
1. **Messagerie** : si toujours 403, cocher `can_use_messaging` et éventuellement `messaging_support` sur le contrat du client (UI Superadmin → Clients → Contrat).
2. **Alertes auto** : créer des règles actives (Alertes / configuration) ; ne pas définir `ALERTS_AUTO=0` en production ; vérifier `min_stock` sur les produits.
3. **Fiscalité** : cocher `can_access_fiscal` (+ sous-modules) à la création/édition de licence.
4. Tests E2E runtime non rejoués ici (pas d’instance PostgreSQL dans cet environnement d’audit).

## Déploiement recommandé
```bash
# 1. Sauvegarde
npm run backup

# 2. Déployer le code corrigé (cette archive)

# 3. Dépendances
npm install

# 4. Migrations (idempotentes)
npm run migrate

# 5. Démarrage
npm start
# ou Docker : docker compose up -d
```

## Fichiers modifiés dans ce lot
- `public/ext-billing.js` — factures multi-lignes
- `public/ext-shell.js` — onglet « La Fiscalité »
- `public/ext-fiscal.js` — permissions vues fiscalité
- `public/app.js` — fournisseurs, employés, contractAllowsView, can()
- `src/catalog.js` — GET/PATCH `/employees/:id`
- `CHANGELOG_CORRECTIFS_2026-10-14.md` — ce journal
- `AUDIT_COMPLET_2026-10-14.md` — ce rapport
