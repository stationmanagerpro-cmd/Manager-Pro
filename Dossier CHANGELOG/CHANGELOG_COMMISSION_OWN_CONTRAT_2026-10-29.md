# Permission commission.own + portail contrat SuperAdmin

**Date :** 2026-10-29

## Objectif
Permettre à l’administrateur client d’autoriser chaque employé (ex. pompiste) à consulter **uniquement son propre état de commission**, sous réserve que le Superadmin ait activé la fonctionnalité dans le contrat.

## 1. Permission de rôle
- Code : `commission.own`
- Label : *Consulter ses propres commissions vendeur*
- Migration : `081_commission_own_permission.sql`
- Attribuée par défaut à ADMIN, GERANT, SUPERVISEUR
- **Non** attribuée à POMPISTE par défaut → l’admin l’active dans **Rôles & permissions**

## 2. Autorisations de contrat (Superadmin)
Dans la création / édition de contrat (`ext-contracts.js` + `contracts.js`) :

| Clé | Libellé |
|-----|---------|
| `employee_portal_commissions` | ③ Portail commissions employés (consulter ses commissions) |
| `modules.seller_commissions` | ③ Module commissions vendeurs / pompistes |

Présents dans les packs prédéfinis et dans le formulaire d’autorisations.

## 3. API (`seller_commissions.js`)
- Accès équipe : `report.view` | `hr.view` | `settings.edit` | …
- Accès personnel : `commission.own` uniquement → filtre `employees.user_id = req.user.id`
- Réponse `scope: "team" | "own"`
- Refus contrat si `modules.seller_commissions === false` ou, pour la vue own, `employee_portal_commissions === false`

## 4. Interface
- Employé avec `commission.own` : menu **Mes commissions**, une seule ligne (la sienne), sans paramétrage / primes
- Admin / gérant : interface complète inchangée

## Déploiement
```bash
node src/migrate.js   # 080 + 081
```
Puis, côté Superadmin : cocher le portail commissions sur le contrat.
Puis, côté admin client : cocher `commission.own` sur le rôle POMPISTE (ou autre).
