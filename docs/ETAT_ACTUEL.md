# État actuel et suivi — Station Manager Pro

Mis à jour le 2026-11-20. Fusionne l'ancien état actuel et le suivi d'exécution. Référence technique : `docs/REFERENCE.md`.

## 0. Dernier commit vérifié
- `origin/main` : `ab772cf` (au moment de la mise à jour). Branches distantes : seule `main` au 2026-11-20 (vérifié par `git branch -r`).
- Procédure de mise à jour : voir `docs/REFERENCE.md`, section 0.

## 1. Dernière tâche effectuée
P-02 : Chart.js chargé à la demande (vérifié par test navigateur au chargement et au premier appel).

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
| 2026-11-20 | Skin classic : un seul état de bandeau (simulation, téléphone et ordinateur) | — | enregistrement image par image |
| 2026-11-20 | Test statique de la règle de comptoir `test:pump-fuel` | — | 7/7 |
| 2026-11-20 | Précision d'idempotence dans `docs/MIGRATIONS_INDEX.md` | — | second passage PostgreSQL |
| 2026-11-20 | Tests statiques : migration-numbering 3/3, tenant-isolation 11/11, dynamic-html-security 10/10, auth-lockout 9/9, besoin-aide 14 assertions, homepage-mobile 8/8, links-audit OK | — | sorties des commandes |

## 3. En cours
- Consolidation de la documentation (en cours de validation par l'utilisateur).

## 4. Bloqué
- **Incident dépendances** : le 2026-11-20, une tentative `npm ci` (registre injoignable) a vidé le dossier `node_modules` local (il était déjà incomplet). Effet : le serveur ne se lance plus dans cet environnement. Sans effet sur le dépôt, le ZIP ou la production. Réinstallation : `npm ci` quand le registre sera accessible.
- Tests serveur (`npm test`) : registre npm injoignable depuis la session (ENOTFOUND, retenté le 2026-11-20 après accord de l'utilisateur ; le blocage vient de la politique réseau de la session, pas du dépôt). À lever côté paramètres réseau de la session.

## 5. Restant (non commencé ou non vérifié)
- Vérifier sur appareil réel (Android) : bandeau unique, menu sans mouvement, bouton « Besoin d'aide » dans la bannière.
- Vérifier le bouton « Modifier » des cartes d'aide pour le superadmin sur le déploiement réel. En simulation (superadmin, `is_global` vrai) : 12 cartes, 12 boutons « Modifier » ; cause de l'absence signalée non reproduite.
- Doublons de préfixe de migrations (`docs/MIGRATIONS_INDEX.md`).
- Compiler et vérifier le projet Android.
- Skin « classic » : vérifiée en simulation le 2026-11-20 (téléphone et ordinateur) : un seul état de bandeau, pas de saut. L'en-tête garde la marque de la station (61–69 px) sous le bandeau, ce qui répète le nom : à décider (garder ou masquer).

## 6. Décisions de l'utilisateur (2026-11-20)
- Registre npm : autorisation demandée, mais toujours bloqué par la politique réseau de la session. Action à faire côté paramètres réseau.
- Règle de comptoir côté serveur : appliquée (`src/catalog.js`, commit `6eaaa9b`).
- URL du dépôt distant local : mise à jour vers `stationmanagerpro-cmd/Manager-Pro` (fetch vérifié).
- Anciens documents de `docs/` : pas de suppression pour l'instant. Une liste fichier par fichier sera proposée plus tard.

## 7. Prochaine tâche précise (mise à jour 2026-11-20)
1. Lever le blocage npm (paramètres réseau), puis `npm ci` et `npm test`, et consigner le résultat ici.
2. Test d'API de la règle de comptoir une fois le serveur lançable.
3. Vérifier sur appareil réel : bandeau unique, menu sans mouvement, bouton « Besoin d'aide » dans la bannière.

## 8. Audit d'optimisation (2026-11-20, audit seul puis lot P-06)
- Mesures initiales (Chromium local, sans throttling, API simulée, sans gzip) : 102 scripts JS (2,27 Mo), 21 CSS (262 Ko, 18 % utilisé), FCP 660 ms, LCP 1 060 ms (téléphone), CLS 0,445 (téléphone) et 0,261 (ordinateur).
- Rapport complet hors dépôt (scratchpad de session) : P-01 à P-10, groupes A à D.
- Groupe C autorisé : P-06 (stabilité visuelle) uniquement. Tentative annulée : aucune amélioration mesurée. Branche locale `perf/stabilite-mise-en-page` (vide) et tag `point-restauration-audit` (62de753), non poussés.
- Décision de l'utilisateur (2026-11-20, choix cliqué) : P-06 reporté après les sujets de sécurité et de finances.
- Cause identifiée : le bandeau, posé après la vue de démarrage, pousse le contenu (sur le tableau de bord, il fait plusieurs centaines de pixels de haut). Corriger demande de choisir l'approche (réserver la place par vue, ou accepter le décalage).
- Règle métier appliquée (`docs/PRIORITES_DEV.md`) : « Sécurité et intégrité financière avant l'apparence ». P-06 est un sujet d'apparence : il est reporté après les sujets de sécurité et de finances.
- Non approuvés, non faits : P-01, P-02, P-03 (performance), P-09 (documentation, rien pour l'instant), P-04, P-07, P-08, P-10 (à conserver).
- P-09 (validé) : 5 instantanés d'octobre supprimés (commit `816796d`), récupérables par git. Reste : 322 fichiers de `Dossier CHANGELOG/` et les rapports d'étapes, à traiter séparément après revue.
- P-03 (approuvé) : icônes optimisées sans perte (−26 Ko, pixels identiques), commit `408eaf5`. Le gain de 300 Ko n'est atteignable qu'en WebP (changement de format, à décider) ou avec perte visible (refusé).
- P-02 (approuvé) : Chart.js (201 Ko) chargé seulement sur les vues qui dessinent un graphique (`whenChart` / `chartTask` dans `public/index.html`). Au chargement : 0 requête vers Chart.js (test navigateur). Détail : `Dossier CHANGELOG/CHARTJS_A_LA_DEMANDE_P02_2026-11-20.md`. Affichage réel à vérifier sur l'application.
- P-01 : non approuvé (en attente de l'inventaire des 102 scripts).
