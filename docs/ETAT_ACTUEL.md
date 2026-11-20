# État actuel et suivi — Station Manager Pro

Mis à jour le 2026-11-20. Fusionne l'ancien état actuel et le suivi d'exécution. Référence technique : `docs/REFERENCE.md`.

## 0. Dernier commit vérifié
- `origin/main` : `ab772cf` (au moment de la mise à jour). Branches distantes : seule `main` au 2026-11-20 (vérifié par `git branch -r`).
- Procédure de mise à jour : voir `docs/REFERENCE.md`, section 0.

## 1. Dernière tâche effectuée
Documentation consolidée (`docs/REFERENCE.md` et ce fichier) et vérifications étendues (migrations sur PostgreSQL 16, tests statiques).

## 2. Terminé et vérifié
| Date | Tâche | Commit | Preuve |
|---|---|---|---|
| 2026-11-18 | Migrations 045–050, 086 : suppression des `BEGIN/COMMIT` internes | voir `Dossier CHANGELOG/MIGRATIONS_TRANSACTIONS_2026-11-18.md` | schéma identique (173 tables) ; erreur injectée : annulation complète |
| 2026-11-19 | Bandeau : photo limitée à 5 s ; repli CSS après 10 s | 182eb8c | `banner-static` 15/15 |
| 2026-11-19 | Photo par défaut chargée avant pose | 62a5ab8, f2ff919 | simulation 390×844 |
| 2026-11-19 | Logo centré, puis annulé à la demande | 46b4be7, a8df845 | simulation |
| 2026-11-19 | En-tête masqué jusqu'à la pose du bandeau | c4c893f | enregistrement image par image |
| 2026-11-19 | Photo par défaut entière et centrée | 9a8c5c4, 06f5e2e | simulation 390×844 et 1280×800 |
| 2026-11-19 | Menu latéral sans animation au chargement | cef27ae | enregistrement 1280 et 390 |
| 2026-11-20 | Photo enregistrée posée directement à l'actualisation | cde25f3 | enregistrement de rechargement : un seul état |
| 2026-11-20 | Une seule version du bandeau, après la vue de démarrage ; nom du compte | 0406ec4 | `banner-static` 15/15 ; simulation |
| 2026-11-20 | Bouton « Besoin d'aide » dans la bannière, sans saut d'en-tête | 485c128 | enregistrement : un seul état (108 px) |
| 2026-11-20 | Documentation de référence | c80fbfe, ab772cf | `repo-hygiene-static` 7/7 |
| 2026-11-20 | Migrations sur PostgreSQL 16 : 122 fichiers appliqués | — | 0 échec au premier passage, 173 tables |
| 2026-11-20 | Superadmin : 12 cartes d'aide, 12 boutons « Modifier » (simulation) | — | script navigateur `aide_super.js` (session) |
| 2026-11-20 | Règle de comptoir : produit Carburant imposé côté serveur | 6eaaa9b | syntaxe OK ; SQL vérifié sur PostgreSQL ; tests statiques 5/5 et 11/11 |
| 2026-11-20 | Précision d'idempotence dans `docs/MIGRATIONS_INDEX.md` | — | second passage PostgreSQL |
| 2026-11-20 | Tests statiques : migration-numbering 3/3, tenant-isolation 11/11, dynamic-html-security 10/10, auth-lockout 9/9, besoin-aide 14 assertions, homepage-mobile 8/8, links-audit OK | — | sorties des commandes |

## 3. En cours
- Consolidation de la documentation (en cours de validation par l'utilisateur).

## 4. Bloqué
- Tests serveur (`npm test`) : registre npm injoignable depuis la session (ENOTFOUND, retenté le 2026-11-20 après accord de l'utilisateur ; le blocage vient de la politique réseau de la session, pas du dépôt). À lever côté paramètres réseau de la session.

## 5. Restant (non commencé ou non vérifié)
- Vérifier sur appareil réel (Android) : bandeau unique, menu sans mouvement, bouton « Besoin d'aide » dans la bannière.
- Vérifier le bouton « Modifier » des cartes d'aide pour le superadmin sur le déploiement réel. En simulation (superadmin, `is_global` vrai) : 12 cartes, 12 boutons « Modifier » ; cause de l'absence signalée non reproduite.
- Doublons de préfixe de migrations (`docs/MIGRATIONS_INDEX.md`).
- Compiler et vérifier le projet Android.
- Vérifier une skin autre que « pro ».

## 6. Décisions de l'utilisateur (2026-11-20)
- Registre npm : autorisation demandée, mais toujours bloqué par la politique réseau de la session. Action à faire côté paramètres réseau.
- Règle de comptoir côté serveur : appliquée (`src/catalog.js`, commit `6eaaa9b`).
- URL du dépôt distant local : mise à jour vers `stationmanagerpro-cmd/Manager-Pro` (fetch vérifié).
- Anciens documents de `docs/` : pas de suppression pour l'instant. Une liste fichier par fichier sera proposée plus tard.

## 7. Prochaine tâche précise
1. Lever le blocage npm (paramètres réseau), puis `npm ci` et `npm test`, et consigner le résultat ici.
2. Test d'API de la règle de comptoir une fois le serveur lançable.
3. Vérifier sur appareil réel : bandeau unique, menu sans mouvement, bouton « Besoin d'aide » dans la bannière.
