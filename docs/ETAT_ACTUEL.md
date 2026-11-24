# État actuel et suivi — Station Manager Pro

Mis à jour le 2026-11-24. Fusionne l'ancien état actuel et le suivi d'exécution. Référence technique : `docs/REFERENCE.md`.
Les sections 2 à 8 datent du 2026-11-20 sauf mention contraire ; la section 9 les complète jusqu'au 2026-11-24.

## 0. Dernier commit vérifié
- `origin/main` : `0364208` (2026-11-24), vérifié par `git fetch` le 2026-11-24 ; la suite de tests ci-dessous a été rejouée sur ce commit. Branches distantes : seule `main` (`git branch -r`).
- 49 commits depuis l'ancien repère `57cf79d` ; liste et conséquences : section 9.
- Procédure de mise à jour : voir `docs/REFERENCE.md`, section 0.

## 1. Dernière tâche effectuée
Mise en place de la directive permanente d'économie de tokens (`docs/REFERENCE.md`, section 0 ter) et de `CLAUDE.md`. Mise à jour de cet état. Aucune modification du code du site.

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

## 7. Prochaine tâche précise (mise à jour 2026-11-24)
1. Après déploiement Render : vérifier que la migration 126 est enregistrée (`schema_migrations`) et que les deux index existent en production ; consigner le résultat ici.
2. Lever le blocage npm (paramètres réseau), puis `npm ci` et `npm test`, et consigner le résultat ici.
3. Vérifier sur appareil réel : bandeau unique, menu sans mouvement, bouton « Besoin d'aide », scan QR, vente au nom d'un employé.

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
- P-01 (chargement différé des scripts) : inventaire et mesure faits, chantier arrêté (décision de l'utilisateur, 2026-11-20). Mesures (Chromium, sans bridage) : 101 scripts, 2,07 Mo ; session connectée simulée : 16 % du code exécuté au démarrage, 116 à 124 ms de temps de scripts ; 51 fichiers sans effet de bord (0,90 Mo) exécutés à 13 % seulement. Risques d'ordre : 16 fichiers redéfinissent des fonctions partagées (go, paint, initShell, api…), 22 écrivent dans la table des vues `V`, 27 ont des effets au chargement. Gain réel non mesuré avec compression. Rien modifié. Compression : Express ne compresse pas les statiques (pas de middleware `compression`) ; la compression éventuelle de l'hébergeur n'a pas pu être vérifiée (production inaccessible depuis la session). Mesure locale : scripts au démarrage 2,07 Mo bruts, 0,66 Mo en gzip -9 (−68 %) ; chart.js 205 Ko bruts, 69 Ko gzip.

## 9. Compléments du 2026-11-24 (49 commits entre `57cf79d` et `ea18655`)
Lu dans `git log` et `git diff` ; le détail est dans `Dossier CHANGELOG/` et `docs/audit/`, pas ici.

**Changements depuis le 2026-11-20 (faits vérifiés dans l'historique, non rejoués ici) :**
- Compression gzip des statiques texte : `src/static_gzip.js`, branché dans `src/server.js` (32e604e, 0695263). Gain mesuré en 4G simulée : 5,8 s → 3,9 s (`docs/MESURE_PERFORMANCE_2026-11-21.md`). Présence de `Content-Encoding` en production : non vérifiée.
- Audit lectures seules (lots 1 à 4) et décisions d'accès A-01 à A-04 appliquées (`src/core.js` : `hasManagerView`, notifications sensibles) ; rapport : `docs/audit/RAPPORT_FINAL_AUDIT_2026-11-21.md`.
- Accès par onglet du contrat client (721beda, 25eb53f, 75f82b8, f87380e, 34d08e4).
- Scan QR des pompes, scan Android par caméra web, vente au nom d'un employé (module de contrat `qr_delegate`). Quart : boutons Vente, Dépense, Anomalie, Clôture ; une agrégation au lieu de deux dans `/shifts/current` (62737d2).
- Bandeau : plus de décalage de l'en-tête (127c0a8, f139443). Vérifié dans le code le 2026-11-24 : `public/index.html` (ligne 5) et `public/ext-banner.js` posent `data-hero-pending` (forme `dataset.heroPending`) ; `ext-banner.js` le retire une fois le bandeau décidé ; la règle qui masque l'en-tête est dans `public/ext-skin-pro.css` (ligne 149). **Il n'y a plus de repli temporisé à 10 s** (commentaire du CSS : décision du 19 novembre) : `docs/REFERENCE.md` section 4 corrigée. Correction d'une note précédente de ce document, inexacte (elle disait que l'attribut ne subsistait que dans le CSS).
- Page « À propos » : retrait d'Ika Sô puis rétablissement (301dbeb, 6d8fbd5).

**Contradictions et points périmés (à décider, non tranchés) :**
- `test/about-page-ui.test.js` : **corrigé le 2026-11-24**. Cause : défauts du test, pas du site. (1) le bouton œil `#lpeye` (voir/masquer le mot de passe) précède « Se connecter » dans `.login-card` ; le test cliquait le premier `button` et n'envoyait jamais la connexion ; (2) la page affiche aussi un bouton « Versions et restauration » de classe `ab-edit-btn b2`, alors que le test attendait un seul `.ab-edit-btn`. Sélecteurs précisés (`.login-card button[onclick^="doLogin"]`, `.ab-edit-btn:not(.b2)`), aucune vérification retirée. Résultat réel : code 0, 74 contrôles ✔ (3 formats d'écran + Super Admin), 0 erreur JavaScript de page. Exécuté avec le Playwright de l'installation Python (hors dépôt, `NODE_PATH`), car `npm` est indisponible ; le suivi AP-015 (« 74 contrôles navigateur verts ») redevient exact pour ce test. `test/ui-shell/ui-shell.test.js` : passe sans modification (66 ✔).
- Chiffres de `docs/REFERENCE.md` section 4 (116 modules, 103 scripts, 238 tests) : corrigés le 2026-11-24 (122 fichiers `src/*.js`, 106 `public/*.js`, 249 fichiers `test/`).
- `Dossier CHANGELOG/` : 336 fichiers ; aucun traitement validé (P-09).

**Tests statiques exécutés le 2026-11-24 (sans serveur, sans base, `node test/<nom>.js`) :**
repo-hygiene 7/7 ; sw-coherence 8/8 ; banner-static 15 contrôles OK ; migration-safety 7/7 ; tenant-isolation 11/11 ; auth-lockout 9/9 ; links-audit OK (984 appels, 837 routes) ; pump-fuel-rule 7/7 ; qr-static 22/22 ; qr-logic-unit 25/25 ; qr-decoder-unit 21/21. `test/performance-motion.js` : fichier absent (cité par un suivi, à vérifier).
`npm test` et tout test avec serveur : non exécutés (npm injoignable, `node_modules` absent, pas de base).

**Performance : état et candidat suivant**
- Fait : compression gzip ; Chart.js à la demande (P-02) ; icônes sans perte (P-03 partiel).
- Cache HTTP long sur les URL `?v=` : **écarté le 2026-11-24, ne pas relancer sans nouvel élément.** Raisons vérifiées dans le code : les `?v=N` de `public/index.html` sont des numéros manuels (41 balises `src` concernées, valeurs 1 à 5, ex. `ext-core.js?v=3`) qui ne changent pas quand le fichier change ; un cache long servirait d'anciennes versions, y compris au pré-chargement du service worker. Gain faible : `public/sw.js` sert déjà les statiques depuis son cache (nom dérivé d'une empreinte du contenu, `scripts/build-sw.js`).
- Brotli à la place de gzip : mesuré le 2026-11-24 sur les 126 JS/CSS de la coquille, gzip niveau 6 : 732 Ko ; brotli niveau 11 : 643 Ko (−12 %, soit environ −90 Ko, de l'ordre de 0,2 s en 4G simulée). Non retenu : gain faible, calcul coûteux au démarrage, hébergeur peut déjà recompresser (non vérifié).
- **Index SQL** (audit sur PostgreSQL 16 jetable, 124 fichiers de migration, 176 tables, 0 échec ; rapport : `docs/audit/AUDIT_INDEX_SQL_2026-11-24.md`) : tables principales déjà bien indexées. Deux requêtes réelles sans index adapté, mesurées sur données générées : `reports (shift_id, kind)` 17,5 ms → 0,04 ms (200 000 lignes) ; `customer_ledger (station_id, kind, occurred_at)` 27 ms → 11 ms (500 000 lignes). **Appliquée au dépôt le 2026-11-24 (accord du propriétaire)** : `migrations/126_index_reports_ledger.sql`, additive et réversible ; vérifiée sur PostgreSQL jetable (0 échec, rejeu et retour arrière OK). Le push sur `main` déclenche le déploiement Render : application en production **non vérifiée**. Note : `docs/MIGRATIONS_INDEX.md` indique encore « Dernière : 093 » dans « Plage actuelle » (périmé, non corrigé).
- Arrêtés sur décision du propriétaire : P-01 (regroupement ou chargement différé des 101 scripts), P-06 (stabilité visuelle, après sécurité et finances), WebP (P-03, à décider).

**Commits du propriétaire entre mon dernier push (`7100b50`) et `0364208` (lus dans `git log`, non audités par moi) :** démarrage plus rapide (lectures de licence, apparence et thèmes en parallèle, `public/app.js`), écran d'actualisation avec logo, icône et message unique (`public/ext-loader.js`, nouveau), message et bouton « Recharger » après 6 s, anti double-clic sur « Enregistrer la vente » (`public/ext-sale-shift.js`), diagnostic des appels lents. Détail : `Dossier CHANGELOG/*_2026-11-24.md`.

**État de référence de tous les tests, 2026-11-24 (247 fichiers de `test/` et `test/ui-shell/`, hors `all.js`, lancés un par un, délai 90 s, sans serveur ni base ; Playwright fourni par l'installation Python via `NODE_PATH`, hors dépôt) :**
- **225 passent** après la correction (224 avant ; dont `about-page-ui` 74 ✔ et `ui-shell` 66 ✔).
- **0 échec réel.** `test/skin-pro-static.js` échouait (règle `html[data-hero-pending] #app-header` hors thème Pro, ajoutée par f139443) ; **corrigé le 2026-11-24, option 1 choisie par le propriétaire** : règle déplacée de `public/ext-skin-pro.css` vers `public/ext-banner.css`, `public/sw.js` régénéré, vérification de `test/banner-pending-static.js` déplacée vers `ext-banner.css` (plus une assertion que la règle n'est plus dans le thème Pro). Rendu vérifié avec les 22 feuilles réelles dans l'ordre de `index.html` : design Pro et design classique, avant et après la modification : en-tête `display:none` pendant l'attente du bandeau, `display:block` ensuite (aucun changement d'affichage ; la règle était déjà globale).
- 11 non exécutables ici, dépendance absente (npm bloqué), module vérifié dans chaque sortie : `zod` (`about-page-http`, `employee-access-unit`, `employee-actions-unit`, `report-ui-harness`, `shift-attribution-share-unit`, `shift-close-attribution-unit`, `shift-report-share-unit`, `stock-movement-validation-unit`) ; `jsdom` (`calculator-dom`, `ui`) ; `exceljs` (`hr-finance`).
- 10 exigent un serveur et une base : `access-keys`, `branding-permissions`, `client-account`, `contracts`, `hr-payroll-security`, `hr-v2`, `licenses`, `security`, `smoke`, `superadmin`. S'y ajoute `tenant-isolation-integration` (variables ISO_TEST_*).
- Délais dépassés : 0. Rejoué sur `0364208` après les 14 commits du propriétaire : 224 passent, aucune régression ; puis 225 après la correction du bandeau. Résultat à rejouer dans un environnement complet (`npm ci` puis `npm test`).
