# Vente au nom d'un employé (scan QR) — autorisation dans le contrat client (22/11/2026)

## Demande
Insérer la fonction dans l'interface d'autorisation d'utilisation du Super Admin (création et modification d'un client), dans un groupe adapté. Précision du propriétaire : « superadmin » = administrateur local des comptes clients ; le Super Admin de plateforme n'a toujours aucun accès aux ventes. Par défaut, seul le rôle ADMIN reçoit la permission (inchangé, migration 125 de l'intervenant précédent).

## Réalisé
* **Nouveau module de contrat `qr_delegate`** (« Vente au nom d'un employé par scan QR »), groupe **« Exploitation station »** du formulaire de contrat (`public/ext-contracts.js` : groupe, libellé, lecture, enregistrement) ; valeur par défaut `true` dans `src/contracts.js` → les contrats existants gardent la fonction (`mergeFeatures`), aucune migration.
* **Contrôle serveur** : `canDelegate(req)` (`src/qr_delegate.js`) = permission `sale.record_for_employee` du rôle **ET** module `qr_delegate` du contrat. Utilisé par `POST /sales/scan-pump` (`src/qr_codes.js`) et par la validation de la vente (`src/fuelsales.js`). Module retiré par le Super Admin → refus, même si le rôle a la permission.
* Permission toujours visible et réglable dans la gestion des rôles (groupe « sale ») de l'administrateur local et du Super Admin, et listée dans « Plafonds de droits par station » (liste plate).
* Tests : `test/qr-static.js` 21/21 (2 contrôles ajoutés) ; `test/qr-delegate-unit.js` 17/17 (2 assertions mises à jour vers `canDelegate(req)`) ; `qr-logic` 25/25 ; `qr-decoder` 21/21 ; `contract-gates-ui-static` OK (164 champs) ; `step8-contract-unlock-static` 27/27 ; `license-set-expiry-static` 10/10. `sw.js` régénéré.

## Non vérifié / limites
* Suite complète `npm test` et exécution réelle (formulaire de contrat dans le navigateur, refus quand le module est désactivé) non testées ici (dépendances non installables).
* Le refus quand le module est désactivé réutilise les codes de refus existants (pas de message dédié « module non inclus »).
* La liste « Plafonds de droits par station » n'a pas de notion de groupe : la permission y est classée par code (`sale.*`).

## Retour arrière
`git revert -m 1 <commit de fusion>`. Aucune migration à annuler.
