# Correctif rôles — Fiscalité vs Superadmin
**Date :** 14 octobre 2026

## Règle appliquée

| Rôle | Station | Fiscalité |
|------|---------|-----------|
| **Superadmin** (`is_global`) | Non | **Uniquement** cocher/décocher les autorisations sur le **contrat client** |
| **Admin / users du compte client** | Oui | Parcours complet si flags accordés |

## Modifications

### Backend `src/fiscal.js`
- `requireFiscalAccess` **refuse** le Superadmin (`403 FISCAL_SUPERADMIN_NO_OPS`)
- Exige un `client_id` lié
- Exports PDF/Excel strictement filtrés par `client_id` du compte client
- Routes **conservées** pour Superadmin :
  - `GET/PUT /admin/clients/:id/fiscal` (autorisations)
  - (API techniques règles / scan restent protégées `is_global` mais **sans menu**)

### Frontend
- `ext-fiscal.js` : `fiscalAllowed()` = **false** si `is_global`
- `app.js` : retrait de `fiscalrules` / `fiscaloverview` de `SUPERADMIN_VIEWS`
- `ext-shell.js` : menu SA Finance = uniquement `pfin`
- `ext-fiscal-admin.js` : **plus d’enregistrement** des vues SA fiscalité

### Inchangé (volontairement)
- Cases Fiscalité dans **Contrats / autorisations client** (`ext-contracts.js` + `DEFAULT_FEATURES`)
- Tout le parcours client (profil, modules, périodes, pièces, estimations)
- Routes métier hors fiscalité, licences, stations, RH, ventes

## Procédure Superadmin (après correctif)

1. Ouvrir le client → **Contrat / fonctionnalités**
2. Activer `Fiscalité — accès au module` (+ sous-modules / exports si besoin)
3. Enregistrer
4. Se **déconnecter** : l’admin du compte client voit Fiscalité et l’utilise

## Procédure admin client

1. Se connecter sur le compte client (station)
2. Menu Finance → Fiscalité (si autorisé)
3. Profil → modules → périodes → pièces / estimations
