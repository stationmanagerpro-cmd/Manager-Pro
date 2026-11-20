# Référence du projet — Station Manager Pro

Document unique de référence (remplace `CAHIER_DES_CHARGES.md` et `ARCHITECTURE_TECHNIQUE.md`).
Mis à jour le 2026-11-20 sur `main`, dernier commit vérifié : voir `docs/ETAT_ACTUEL.md`.

## 0. Synchronisation avant toute tâche (obligatoire)
D'autres agents peuvent commit ou pousser pendant une pause. Avant de se fier à ce document :
1. `git fetch --all --prune`
2. `git branch -r` : lister les branches distantes, y compris celles qui ne sont pas `main`.
3. `git log --oneline <dernier_commit_verifie>..origin/main` et, pour chaque autre branche, `git log --oneline origin/main..<branche>`.
4. Si un commit touche un fichier cité ici ou dans `ETAT_ACTUEL.md`, relire ce fichier avant d'agir. En cas de contradiction, signaler le conflit ; ne pas trancher seul.
5. Noter dans `ETAT_ACTUEL.md` le nouveau dernier commit vérifié.

## 1. Objet
Application de gestion de stations-service : ventes et carburant, quarts et caisse, stocks et produits, achats, RH et paie, comptabilité OHADA, fiscalité, flotte, contrats clients, messagerie, alertes et sauvegardes. Plusieurs stations par compte client ; un superadmin plateforme sans station (`SID` null).

## 2. Règles permanentes (ne jamais affaiblir)
- Sécurité et intégrité financière avant l'apparence.
- Isolation stricte entre comptes clients et entre stations.
- Migrations livrées jamais réécrites. Chaque fichier ne s'exécute qu'une fois (table `schema_migrations`).
- L'accès aux vues est filtré côté serveur, pas seulement dans l'interface.
- Aucune opération destructive sans vérification de ses conséquences et validation de l'utilisateur.
- Ne jamais livrer `.env` ni de secret.
- Une livraison = changelog daté dans `Dossier CHANGELOG/` + commit + `npm run build:sw` + tests ciblés.

## 3. Règles métier : où elles sont validées
Ne pas recopier les règles ici. Sources, à consulter avant toute modification :
| Sujet | Source |
|---|---|
| Priorités et dépendances | `docs/PRIORITES_DEV.md` |
| Arbitrage entre cahiers contradictoires | `docs/RECONCILIATION_CAHIERS_DES_CHARGES_2026-10-16.md` |
| Modules et interrupteurs | `docs/MATRICE_MODULES.md`, `Dossier CHANGELOG/INTERRUPTEURS_MODULES_CLIENT_2026-11-17.md` |
| Sécurité | `docs/SECURITY.md` |
| Migrations | `docs/MIGRATIONS_INDEX.md`, `docs/MIGRATIONS_NUMEROTATION.md` |
| RH et paie (Mali) | `docs/RH_PAIE_MALI.md`, `docs/RH_V2.md` |
| Comptabilité OHADA | `docs/COMPTABILITE_OHADA.md` |
| Contrats clients | `docs/CONTRATS_CLIENTS.md` |
| Messagerie | `docs/INTEGRATION_MESSAGERIE.md` |
| Hébergement PC | `docs/HEBERGEMENT_PC_WINDOWS_TAILSCALE_FUNNEL.md` |
| Design et couleurs | `docs/DESIGN_V2.md`, `docs/PERSONNALISATION_COULEURS_RAPPORTS.md` |
| Activation progressive, administration, licences | `docs/ACTIVATION_PROGRESSIVE.md`, `docs/ADMIN_COMPTES_LICENCES.md` |
| Audit et nettoyage | `docs/AUDIT_ET_NETTOYAGE.md`, `docs/RAPPORT_TECHNIQUE_2026-11-04.md` |
| Autres rapports datés | `docs/RAPPORT_*`, `docs/LIVRAISON_*`, `docs/CORRECTIONS_*`, `docs/VERIFICATION_*` |

Les documents datés (`RAPPORT_*`, `LIVRAISON_*`, `CORRECTIONS_*`, `VERIFICATION_*`) décrivent un moment précis : ils ne font pas foi sur l'état actuel.

## 4. Architecture technique
- Serveur : Node.js + Express (`src/server.js`), routes sous `/api`. Environ 779 déclarations de route (comptage par expression régulière, indicatif).
- Base : PostgreSQL 16 testé. `migrations/NNN_nom.sql` (122 fichiers, ordre alphabétique), exécutés par `src/migrate.js` (une transaction par fichier, verrou consultatif, `schema_migrations`). Résultat attendu : 173 tables.
- Front : JavaScript sans framework. `public/app.js` (démarrage, navigation, `canView`), `public/ext-*.js` (extensions : bandeau, menu, aide…), `public/index.html`.
- Service worker : `public/sw.js`, généré par `scripts/build-sw.js` (`npm run build:sw`). Ne jamais le modifier à la main.
- Permissions : `needPrincipal` contrôle `req.user.is_global`. Le middleware de station (`src/core.js`, lignes 74–84) exige `X-Station-Id` sauf pour le superadmin.
- Bandeau : `public/ext-banner.js` et `public/ext-banner.css`. Photo enregistrée (IndexedDB) posée directement ; sinon `public/banner-defaut.webp`. Au démarrage, `index.html` pose `data-hero-pending` (en-tête masqué ; repli à 10 s). Le bandeau attend `window.__viewSettled` (posé par `app.js` en fin de démarrage).
- Menu : `public/ext-shell.js`. Une règle de démarrage (`#nav-boot`, dans `index.html`) coupe les animations au premier rendu.
- Aide : `public/ext-help.js` (bouton « Besoin d'aide ») et `src/help_guides.js`.
- Android : `android/`, projet séparé, non compilé dans l'environnement de développement.
- Dossiers : `src/` (116 modules serveur), `public/` (103 scripts), `migrations/`, `test/` (238 fichiers), `scripts/`, `docs/`, `Dossier CHANGELOG/`.

## 5. Moyens de test
| Moyen | Commande | Statut ici |
|---|---|---|
| Tests statiques (lecture du code) | `node test/<nom>.js` | Fonctionnent. Ex. `banner-static.js` 15/15, `sw-coherence-static.js` 8/8, `migration-safety-static.js` 7/7, `tenant-isolation-static.js` 11/11, `auth-lockout-static.js` 9/9, `links-audit-static.js` (975 appels reliés à 828 routes). |
| Migrations sur PostgreSQL réel | Voir section 6 | Fonctionne (PostgreSQL 16 local, `service postgresql start`). |
| Tests serveur (express, pg, zod, exceljs, jsdom…) | `npm test` | **Bloqué** : `node_modules` incomplet (dépendances « invalid » et absentes) ; registre npm injoignable (ENOTFOUND, `npm ci` échoue). Pour débloquer : autoriser le registre npm pour cette session. |
| Simulation navigateur (bandeau, menu, en-tête) | Playwright chromium, stubs de `/api/*`, `public/` servi sur un port local | Fonctionne. Le harnais est dans le dossier de travail de session, non versionné. |
| Appareil réel | — | Non fait. |

## 6. Vérifier les migrations sur PostgreSQL local
```
cp migrations/*.sql /var/tmp/migcheck/ && chmod 644 /var/tmp/migcheck/*.sql
su postgres -c "dropdb --if-exists smp_check && createdb smp_check"
for f in $(ls /var/tmp/migcheck/*.sql | sort); do su postgres -c "psql -q -X -v ON_ERROR_STOP=1 -d smp_check -f $f" || echo "ECHEC $f"; done
```
Résultat constaté le 2026-11-20 : 0 échec, 173 tables. Un second passage échoue sur `001_initial.sql` (`CREATE TABLE` sans `IF NOT EXISTS`) : normal, car le runner n'exécute chaque fichier qu'une fois ; les autres fichiers passent. Cela contredit la phrase « conçu idempotent » de `docs/MIGRATIONS_INDEX.md` : à corriger ou à préciser.

## 7. Limites connues
- Pas de rendu sur appareil réel dans l'environnement de développement.
- Registre npm bloqué : impossible d'installer les dépendances tant que la session n'y a pas accès.
- Les tests qui démarrent le serveur ne sont pas exécutés ici : à lancer dans un environnement complet avant toute livraison touchant le serveur.
