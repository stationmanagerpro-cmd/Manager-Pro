# Étape 66 — Autorisation individuelle du module Fiscalité

- Le formulaire Superadmin précise que « Fiscalité — accès individuel » s'applique au compte client ciblé et ne modifie pas les autres clients d'un même pack.
- Ajout de la migration idempotente `062_restore_client_admin_fiscal_permission.sql` pour restaurer `fiscal.access` au rôle `ADMIN` local. L'accès reste conditionné à `can_access_fiscal` / `module:fiscal` du contrat individuel.
- Le Superadmin de plateforme n'obtient pas le droit d'utiliser le parcours fiscal opérationnel.
- Après déploiement, exécuter `npm run migrate`, puis ouvrir la fiche du client concerné, activer « Fiscalité — accès individuel… », enregistrer et faire reconnecter l'administrateur local.
- Vérifications statiques uniquement ; aucun test réel Neon/Render n'a été effectué.
