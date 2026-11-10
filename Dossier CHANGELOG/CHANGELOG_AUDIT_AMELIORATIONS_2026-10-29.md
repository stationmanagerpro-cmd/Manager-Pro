# Application des améliorations d’audit (sans casser l’existant)

**Date :** 2026-10-29

## Commissions

### Migration `082_commission_manage_and_period.sql`
- Permission `commission.manage` (ADMIN, GERANT, SUPERVISEUR)
- Colonne `amount_remaining` pour règlements partiels
- `kind = commission` autorisé (figage période)
- Index période

### API `seller_commissions.js` (réécriture non destructive des routes)
- Modes : `always` | `if_target_met` | `on_surplus` (settings JSON)
- Calcul CA HT via JOIN LATERAL (perf)
- `POST /seller-commissions/freeze` — fige les commissions de période
- Règlements **partiels** FIFO sur `amount_remaining`
- `requireManage` = `commission.manage` (+ repli settings/hr) + contrat
- Message clair si compte non lié à une fiche employé

### UI `ext-vendeurs.js`
- Mode de calcul dans paramétrage
- Bouton **Figer la période**
- Gestion via `commission.manage`

## Achats
- `GET /purchases` : filtres `from`, `to`, `supplier_id`, `limit` (rétrocompatible)
- UI : appels filtrés serveur + ouverture `showPO` (existant)
- Refresh après action : reste sur `achats` si on y est
- Icône 🧾

## Magasins
- Nouveau `GET /stations/performance?from=&to=` (overview inchangé)
- UI branchée sur performance + fusion overview (quarts / stock bas)
- Grille responsive

## Fichiers non touchés volontairement
- Logique `showPO` / réception / paiement existante
- `/stations/overview`
- Modules parties, RH, paie
