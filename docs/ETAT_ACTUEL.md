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
| 2026-11-20 | Tests statiques : migration-numbering 3/3, tenant-isolation 11/11, dynamic-html-security 10/10, auth-lockout 9/9, besoin-aide 14 assertions, homepage-mobile 8/8, links-audit OK | — | sorties des commandes |

## 3. En cours
- Consolidation de la documentation (en cours de validation par l'utilisateur).

## 4. Bloqué
- Tests serveur (`npm test`) : registre npm injoignable ; dépendances incomplètes. Pour débloquer : autoriser le registre npm pour cette session.

## 5. Restant (non commencé ou non vérifié)
- Vérifier sur appareil réel (Android) : bandeau unique, menu sans mouvement, bouton « Besoin d'aide » dans la bannière.
- Vérifier le bouton « Modifier » des cartes d'aide pour le superadmin après déploiement. Cause non établie.
- Appliquer côté serveur la règle de comptoir des produits (`src/catalog.js`). Aujourd'hui seule l'interface la restreint à CARBURANT.
- Doublons de préfixe de migrations (`docs/MIGRATIONS_INDEX.md`).
- Corriger la phrase « conçu idempotent » de `docs/MIGRATIONS_INDEX.md` (`001_initial.sql` ne l'est pas).
- Compiler et vérifier le projet Android.
- Vérifier une skin autre que « pro ».

## 6. Questions ouvertes pour l'utilisateur
1. Autoriser le registre npm pour cette session, afin de lancer `npm test` ?
2. Appliquer la règle de comptoir côté serveur (`src/catalog.js`) ?
3. Mettre à jour l'URL du dépôt distant local vers `stationmanagerpro-cmd/Manager-Pro` ?
4. Fusionner les anciens documents datés de `docs/` dans `REFERENCE.md` et supprimer ceux qui sont redondants ? C'est une suppression : je ne le ferai qu'après votre accord, fichier par fichier.

## 7. Prochaine tâche précise
Attendre les réponses aux questions 1 à 4. Ensuite, si la question 1 est « oui » : `npm ci`, puis `npm test`, et consigner le résultat ici.
