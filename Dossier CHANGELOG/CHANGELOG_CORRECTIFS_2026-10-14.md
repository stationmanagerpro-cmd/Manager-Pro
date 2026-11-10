# Correctifs VERIFICATION 2026-10-14

## 1. Interface fournisseur
- Bouton **Fiche** sur chaque fournisseur
- Modal détail + modification (PATCH /suppliers/:id)
- Basculement vers fiche détaillée (supdet) si disponible

## 2. Facturation multi-lignes
- Formulaire « Nouvelle facture » accepte **jusqu’à 8 lignes**
- Chaque ligne : produit catalogue (optionnel) + désignation + quantité + prix unitaire
- Une seule facture peut regrouper gasoil, essence, huile, super, etc.
- Backend `invoice_lines` déjà multi-lignes — UI alignée

## 3. Profil employé
- Bouton **Profil** sur la liste des employés
- Modal détail (GET /employees/:id)
- Modification (PATCH /employees/:id)
- Routes API ajoutées dans `src/catalog.js`

## 4. Messagerie
- Vérifier sur le **contrat client** les flags :
  - `can_use_messaging` / `module:messaging`
  - `messaging_support` (support Superadmin ↔ client)
- Par défaut `can_use_messaging: true` dans DEFAULT_FEATURES
- Si message « non inclus dans votre contrat » → Superadmin doit cocher la case dans Contrats / Licences

## 5. Modules Fiscalité
- Cases présentes dans **Contrats** (can_access_fiscal + sous-modules TVA, IS, ITS…)
- Contenu opérationnel refusé si non coché (`fiscalAllowed()`)
- **Regroupement** : nouvel onglet menu **« La Fiscalité »** (séparé de Finance & rapports)
- Superadmin : uniquement autorisations sur le contrat (pas de parcours ops)

## 6. Alertes automatiques
- Planificateur démarré au boot (`startScheduler`, intervalle 5 min)
- Désactivable uniquement avec `ALERTS_AUTO=0`
- Nécessite `can_use_auto_alerts` + règles actives dans `alert_notify_config`
- Types scannés : stock_low, account_inactive, license_expiring, payroll_pending + échéances fiscales

## 7. Onglet « La Fiscalité »
- Groupe dédié dans la navigation latérale (ext-shell.js)

## Déploiement
1. Sauvegarde : `npm run backup`
2. Remplacer les fichiers modifiés (ou archive complète)
3. `npm run migrate` (si besoin — pas de nouvelle migration dans ce lot)
4. `npm start`
5. Vérifier : facture multi-lignes, fiche fournisseur, profil employé, menu La Fiscalité
