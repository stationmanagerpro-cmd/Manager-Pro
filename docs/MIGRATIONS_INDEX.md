# Index des migrations — Station Manager Pro v21

Les migrations s’appliquent **dans l’ordre alphabétique des noms de fichiers** (`src/migrate.js`).  
Elles ne sont **jamais réécrites** une fois livrées. Contenu conçu idempotent (`IF NOT EXISTS`, `ON CONFLICT`, `ADD COLUMN IF NOT EXISTS`).

## Doublons de préfixe connus (ordre alphabétique réel)

| Préfixe | Fichiers (ordre d’exécution) |
|---------|------------------------------|
| 027 | `027_prompt_consolide_2026-10-07.sql` puis `027_purchase_operation_idempotency.sql` |
| 040 | `040_backup_log_operation_types.sql` puis `040_platform_report_export_preferences.sql` |
| 059 | `059_audited_client_reset_closed_shifts.sql` puis `059_restore_client_admin_fiscal_permission.sql` |

## Gaps (numéros absents, volontairement non réutilisés)

- 056
- 067, 068, 069

## Plage actuelle

- Première : `001_initial.sql`
- Dernière : `093_employees_updated_at.sql`

## Règle : un numéro = un fichier

- Chaque nouvelle migration prend le **numéro suivant, unique et strictement croissant** (après 093 : 094, 095…).
- Les doublons 027, 040 et 059 sont historiques : ils restent tels quels (déjà appliqués en production, jamais renommés). Aucun autre doublon n'est toléré.
- Les numéros absents (056, 067 à 069) ne sont pas réutilisés.
- Le test `npm run test:migration-numbering` (`test/migration-numbering-static.js`) refuse tout nouveau doublon, tout nom hors format `NNN_nom.sql` et tout numéro non croissant après 091.

## Sécurité du lanceur

- Table `schema_migrations` obligatoire.
- Si des données existent et que des migrations sont en attente → **sauvegarde obligatoire** avant application.
- `--no-backup` interdit dès que la base contient des données.
- Fail-closed si `schema_migrations` est vide alors que des tables métier existent.

Ne pas renommer les fichiers déjà appliqués en production. Pour clarifier un futur lot, utiliser des numéros strictement croissants et uniques (ex. 078, 079…).

- `079_comptabilite.sql` — Comptabilité OHADA : plan comptable, exercices, écritures manuelles, immobilisations, permissions `accounting.*` (non destructif, idempotent).
