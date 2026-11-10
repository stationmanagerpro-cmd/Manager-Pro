# Numérotation des migrations (RG-09)

Règle : une migration s'applique **une seule fois**, dans l'ordre du nom de fichier, sans exécution concurrente
(verrou consultatif dans `src/migrate.js`). Une migration déjà appliquée **n'est jamais renommée** : `schema_migrations`
mémorise le nom du fichier, un renommage la rejouerait.

## Exceptions historiques (tolérées, ne pas corriger)

| Numéro | Fichiers | Remarque |
|---|---|---|
| 027 | `027_prompt_consolide_2026-10-07.sql`, `027_purchase_operation_idempotency.sql` | Doublon ; le premier porte un nom atypique (date et mot « prompt »). |
| 040 | `040_backup_log_operation_types.sql`, `040_platform_report_export_preferences.sql` | Doublon. |
| 059 | `059_audited_client_reset_closed_shifts.sql`, `059_restore_client_admin_fiscal_permission.sql` | Doublon. |
| 056, 067 à 069 | — | Numéros jamais utilisés (trous). Ne pas les combler : l'ordre d'application des bases existantes doit rester identique. |

L'ordre alphabétique entre fichiers de même numéro est stable (le nom complet départage) ; aucune de ces migrations n'en suppose une autre du même numéro.

## Règles pour les nouvelles migrations

- Numéro **unique et strictement croissant**, à la suite du plus grand existant (dernière : 103).
- Nom sobre `NNN_sujet_en_minuscules.sql` : pas de date, pas de mention de prompt.
- Migrations additives (nouvelle table/colonne/permission) ; aucune suppression de données sans sauvegarde vérifiée.
- Contrôle automatique : `npm run test:migration-numbering` (tolère uniquement 027, 040, 059 et refuse tout nouveau doublon).

## Ajouts de la version 1.11.31

- `102_cost_view_permission.sql` — permission `cost.view` (prix d'achat, marges, valeur du stock à l'achat).
- `103_login_throttle.sql` — verrouillage de connexion par identifiant et adresse IP.
