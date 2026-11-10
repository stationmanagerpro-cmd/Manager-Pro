# Étape 66 — Correction de l'autorisation Fiscalité

- Clarification du champ d'accès Fiscalité dans la fiche contrat Superadmin.
- Migration 062 idempotente pour restaurer la permission `fiscal.access` du rôle `ADMIN` local tout en excluant les rôles Superadmin de plateforme.
- Le contrôle contractuel individuel reste actif : aucun changement automatique aux autres clients partageant le même pack.
- Test statique dédié ajouté.
