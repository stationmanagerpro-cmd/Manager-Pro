# Audit technique — Lot 4 : migrations et schéma (2026-11-21)

Suite des lots 1 à 3. Lecture seule : aucune migration, table, donnée ni route modifiée.
Les tests ont été faits sur une base PostgreSQL 16 **jetable et vide** (`smp_audit4`), construite uniquement à partir des fichiers `migrations/`. Aucune base de production n'a été touchée.

## 1. Inventaire

- 122 fichiers `.sql`, exécutés par ordre de nom (`src/migrate.js`, une transaction par fichier, table `schema_migrations`).
- **Numéros en double** : `027` (2 fichiers), `040` (2), `059` (2). Les noms diffèrent, donc l'ordre reste déterministe, mais la numérotation est ambiguë. `027_prompt_consolide_2026-10-07.sql` porte un nom daté et sans numéro de fonctionnalité : à renommer lors d'un prochain lot de nettoyage (sans rien changer au contenu).
- Aucune migration n'imbrique de `BEGIN`/`COMMIT` : pas de conflit avec la transaction du runner.
- Le runner ignore les fichiers déjà enregistrés dans `schema_migrations` (`src/migrate.js:61`).

## 2. Résultats des tests

| Test | Résultat |
|---|---|
| Application complète sur base vide, dans l'ordre | **122 / 122 sans erreur**, 173 tables métier |
| Seconde application sur la même base | 1 échec : `001_initial.sql` (`CREATE TABLE` non idempotent). Les 121 autres passent. Conséquence : une reprise manuelle partielle doit commencer après `001`. Le runner, lui, ne rejoue jamais un fichier déjà appliqué. |
| Requêtes SQL littérales du serveur, préparées contre le schéma migré | **1 606 requêtes valides, 0 erreur** (colonnes lues et écrites, tables). Le contrôle détecte bien les erreurs : vérifié avec une colonne et une table volontairement fausses. |
| Requêtes non vérifiables (interpolation JavaScript dans le SQL) | 185 : non couvertes par ce test. |

## 3. Instructions destructives (13 au total)

| Fichier | Instruction | Constat |
|---|---|---|
| **070_remove_client_device_link.sql** | `DROP TABLE client_devices`, `client_device_keys` | **Suppression de données, irréversible.** Aucune référence dans le code. Si la migration a été appliquée en production, les données ont disparu ; si elle ne l'a pas été, elle le ferait. État de production non vérifiable ici. |
| 058, 059, 062, 065 (et 089) | `DELETE FROM role_permissions` sur `fiscal.access` (ADMIN, SUPERADMIN) | Successions contradictoires qui convergent : après 065, ADMIN a `fiscal.access` et SUPERADMIN ne l'a pas. **059, 062 et 065 sont redondantes** (même `INSERT`/`DELETE`). Pas de risque sur l'état final, mais l'historique est trompeur. |
| 037, 079, 086, 091, 100 | `DROP CONSTRAINT / TRIGGER IF EXISTS` | Opérations de recréation, sans perte de données. |

## 4. Tables et cohérence avec le code

- 173 tables créées ; 171 référencées par le code serveur.
- **`email_alert_dedupe`** (migration 061, « anti-doublons e-mail persistants entre redémarrages et instances Render ») : **non utilisée**. Aucun code n'y écrit ni n'y lit. La déduplication effective est en base : `messaging.js:912` (messages système) et `ops_plus.js:229–242` (notifications, 24 h). Le risque de doublon d'e-mail n'est donc pas couvert par la fonctionnalité annoncée par la migration. Gravité faible, à valider.
- **`license_settings`** (migration 019) : table orpheline, aucune lecture ni écriture. Candidate à une migration de nettoyage ultérieure, après validation.

## 5. Anomalies retenues

| ID | Gravité | Constat | Fichier | Statut |
|---|---|---|---|---|
| M-01 | Moyenne (à confirmer) | `DROP TABLE client_devices` : suppression irréversible si appliquée en production. Impossible à vérifier depuis la session. | 070_remove_client_device_link.sql | À confirmer sur la base de production (lecture seule) |
| M-02 | Faible | Anti-doublon e-mail annoncé par la migration 061, non branché. | 061_email_alert_dedupe_24h.sql | Confirmé par lecture |
| M-03 | Faible | Tables orphelines `license_settings`, `email_alert_dedupe`. | 019, 061 | Confirmé par lecture |
| M-04 | Faible | Numéros de migration en double (027, 040, 059) et nom non standard de `027_prompt_consolide`. | migrations/ | Confirmé |
| M-05 | Faible | Migrations `role_permissions` redondantes (059, 062, 065). | 058–065 | Confirmé |
| M-06 | Faible | `001_initial.sql` non idempotent : reprise manuelle impossible sans le sauter. | 001 | Confirmé (déjà connu) |

## 6. Limites

- La base de test est construite depuis les fichiers, pas depuis une copie de production. Une dérive manuelle éventuelle en production n'est pas visible ici.
- Les 185 requêtes à interpolation JavaScript ne sont pas vérifiées (noms de colonnes ou de tables construits dynamiquement).
- Aucune donnée réelle n'a été lue ni modifiée.
- Le runner n'a pas été exécuté (dépendances absentes) : le comportement vérifié est celui du SQL, avec le même ordre et la même transaction par fichier.

## 7. Prochaine étape

Lot 5 : exécution. Impossible dans l'état actuel (dépendances Node absentes). Les points à confirmer sont : M-01 (lecture seule sur la production, via un compte d'audit), P-01, P-04 et P-05 (tests avec des comptes sans permission).
