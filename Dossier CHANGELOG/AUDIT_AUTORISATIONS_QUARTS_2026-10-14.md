# AUDIT GLOBAL — Autorisations Superadmin + Fiche quart — 14 octobre 2026

## 1. Objectif
Inventorier **toutes** les fonctionnalités conditionnées par le contrat client (gérées exclusivement par le Superadmin `is_global`) et garantir qu’elles apparaissent dans le formulaire de création / édition de contrat et d’abonnement. Corriger le bouton **Voir / Fiche complète** de l’historique des quarts.

## 2. Inventaire des flags d’autorisation (backend)

### 2.1 Flags top-level (`contract.features.*`)
| Flag | Rôle |
|------|------|
| can_access_settings | Paramètres station |
| can_access_advanced_settings | Paramètres avancés |
| can_access_hr | Accès module RH |
| can_manage_hr | Gestion RH complète |
| can_access_finance | Module Finance / Caisse |
| can_view_reports | Voir les rapports |
| can_export_reports | Exports PDF / Excel |
| can_view_advanced_reports | Rapports avancés / pilotage |
| can_access_personalization | Thème client |
| can_customize_signature | Signatures documents |
| can_customize_report_exports | Couleurs des exports |
| can_manage_services | Packs / services station |
| can_use_messaging | Messagerie interne |
| messaging_attachments | Pièces jointes messagerie |
| messaging_groups | Groupes messagerie |
| messaging_broadcast | Diffusion messagerie |
| messaging_support | Support client ↔ Superadmin |
| can_use_auto_alerts | Alertes auto + rapports programmés |
| employee_portal_payslips | Portail bulletins employés |
| can_view_coming_soon | Onglet « À venir » |
| can_use_billing | Facturation clients |
| can_access_fiscal | Accès module Fiscalité |
| can_fiscal_estimates | Estimations fiscales |
| can_fiscal_exports | Exports fiscaux |
| can_fiscal_prepare | Préparation périodes |
| can_fiscal_deadlines | Suivi échéances |
| fiscal_storage_mb | Quota stockage justificatifs |

### 2.2 Modules (`contract.features.modules.*`)
sales, stock, reports, finance, hr, personalization, reconcile, period_lock, receipts, price_history, payroll_amo, payroll_inps, payroll_its, payroll_charges, messaging, auto_alerts, report_colors, billing, fiscal, fiscal_tva, fiscal_synthetique, fiscal_ibic, fiscal_is, fiscal_its, fiscal_cfe, fiscal_tfp, fiscal_logement, fiscal_retenues, fiscal_autres

### 2.3 Quotas contrat (hors features JSON)
- can_manage_users / max_users  
- can_create_station / max_stations  
- durée licence / type de contrat  

Ces quotas sont déjà dans les formulaires Nouveau client / Gérer (hors liste features).

### 2.4 Points de contrôle serveur
- `src/server.js` : gates path `/hr`, `/finance`, `/reports`, `/sales`, `/shifts`, `/customers`, stock, messaging, auto_alerts, invoices, exports, fiscal  
- `src/contracts.js` : `featureOn()`, `DEFAULT_FEATURES`, merge  
- `src/premium.js` : `requireModule()`, catalogue `/modules/catalog`, apply-pack  
- Modules métier : billing, fiscal, messaging, scheduled_reports, admin (signature, paramètres avancés, couleurs rapports)

## 3. Interface Superadmin (création / édition contrat)

**47 champs** d’autorisation dans `featureFormFields()` — utilisés par :
- `clNew` (Nouveau client + licence)
- `clEdit` (Gérer contrat)

Payload `featuresPayloadFromForm` mappe **tous** les flags top-level + **tous** les modules listés ci-dessus.

Catalogue API `/modules/catalog` enrichi (billing, report_colors, fiscal + sous-modules).

## 4. Correctif historique des quarts (Voir / Fiche complète)

### Causes identifiées
1. Bouton dashboard : `go('rapq'); setTimeout(showShiftFull)` — navigation concurrente cassait le modal.  
2. `showShiftFull` peu tolérant aux erreurs API / helpers manquants.  
3. Table principale des quarts sans bouton dédié (seulement clic ligne → `rapq` pour quarts fermés).

### Correctifs
- `public/ext-p7.js` : `showShiftFull` robuste (repli `/shifts/:id`, helpers safe, erreurs toast).  
- Bouton **Fiche complète / Mon rapport** sur l’historique avec `stopPropagation`.  
- `public/ext-p10.js` : bouton **Voir** appelle directement `window.showShiftFull(id)`.  
- `public/app.js` : colonne **Voir** sur la liste principale des quarts.

API inchangée : `GET /api/shifts/:id/full` (déjà présente).

## 5. Tests statiques effectués
- `node --check` sur : ext-p7, ext-p10, ext-contracts, app.js, premium.js, catalog.js, contracts.js → **OK**  
- Comptage champs formulaire autorisations → **47**  
- Présence `window.showShiftFull`, repli API, boutons Voir sans setTimeout → **OK**

## 6. Déploiement
```bash
npm run backup
# déployer cette archive
npm install
npm run migrate
npm start
```

### Vérifications manuelles recommandées
1. Superadmin → Nouveau client : cocher/décocher chaque case d’autorisation, créer, reconnecter en admin client.  
2. Superadmin → Gérer un client existant : mêmes cases, enregistrer, vérifier 403 si module off.  
3. Station → Quarts → **Voir** / **Fiche complète** sur quart ouvert et fermé.  
4. Dashboard → Quarts ouverts → **Voir**.  
5. Quart fermé → Rapport clôture + PDF depuis la fiche.

## 7. Fichiers modifiés (ce lot)
- `public/ext-contracts.js` — liste complète des autorisations + payload modules  
- `src/premium.js` — catalogue modules étendu  
- `public/ext-p7.js` — fiche quart robuste  
- `public/ext-p10.js` — bouton Voir dashboard  
- `public/app.js` — bouton Voir liste quarts  
- `AUDIT_AUTORISATIONS_QUARTS_2026-10-14.md` — ce document  
