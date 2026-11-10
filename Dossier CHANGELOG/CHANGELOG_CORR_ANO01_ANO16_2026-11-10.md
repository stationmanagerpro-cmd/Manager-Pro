# Correctifs ANO-01 à ANO-16 — version 1.11.31 (10/11/2026)

Base : V1.11.30 + correctifs 33/34. Source : `ManagePro_Feuille_de_route_corrections_2026-11-09.xlsx` (audit statique).
Suivi détaillé (statut, preuve, journal) : `ManagePro_Feuille_de_route_corrections_2026-11-10.xlsx` (même dossier).

## Après déploiement (obligatoire)
1. `npm ci` puis `npm run migrate` (nouvelles migrations 102 et 103 ; sauvegarde automatique préalable).
2. Renseigner `APP_DOMAIN` dans `.env` si Caddy est utilisé ; contrôler avec `npm run doctor`.
3. Changer les mots de passe de tous les comptes : l'ancienne archive contenait des sauvegardes avec empreintes de mots de passe (ANO-02).
4. Le gérant et le comptable reçoivent `cost.view` ; les rôles personnalisés doivent l'obtenir explicitement s'ils doivent voir les prix d'achat.
5. Après toute modification de `public/` : `npm run build:sw` (le cache hors ligne change avec le contenu).

## Détail
| ID | Correction | Test |
|---|---|---|
| ANO-01 | Permission `cost.view` ; prix d'achat, marges, valeur d'achat masqués (produits, stock, fiche produit, exports, interface) | test:cost-confidentiality |
| ANO-02 | Sauvegardes retirées de l'archive ; .gitignore/.dockerignore | test:cost-confidentiality |
| ANO-03 | 12 caractères minimum pour ADMIN/SUPERADMIN/plateforme | test:password-policy |
| ANO-04 | Verrou par identifiant + IP (table `login_throttle`), réponse neutre, journalisation | test:auth-lockout |
| ANO-05 | Échappement HTML/JS des 3 points signalés (+ 3 apparentés). CSP sans `unsafe-inline` : reste à faire | test:dynamic-html-security |
| ANO-06 | Verrou consultatif PostgreSQL dans `migrate.js` | test:scheduler-locks |
| ANO-07 | `task_lock.js` : sauvegarde automatique et règles de notification mono-exécution | test:scheduler-locks |
| ANO-08 | Mouvements de stock : bornes, décimales, motif obligatoire | test:stock-movement-validation |
| ANO-09 | Tests périmés réparés ; régression export Clients/Fournisseurs (filtre) corrigée | 125 tests statiques/unitaires + ui-shell |
| ANO-10 | Pré-chargement généré (`build:sw`), cache dérivé du contenu | test:sw-coherence |
| ANO-11 | Scripts de dépannage dans `scripts/dev/` | test:repo-hygiene |
| ANO-12 | LF partout (.bat/.ps1 en CRLF) | test:repo-hygiene |
| ANO-13 | Exceptions documentées (`docs/MIGRATIONS_NUMEROTATION.md`) | test:migration-numbering |
| ANO-14 | Version unique 1.11.31, affichée dans Administration | test:repo-hygiene |
| ANO-15 | Outil de mesure `npm run bench:auth` ; cache volontairement non ajouté | — |
| ANO-16 | Caddyfile `{$APP_DOMAIN}` ; contrôle `npm run doctor` | test:repo-hygiene |

## Non vérifié dans l'environnement de correction (pas de PostgreSQL)
`npm test`, `npm run test:ci`, double `migrate` simultané, deux instances en parallèle, connexions réelles POMPISTE/CAISSIER, chargement hors ligne, `docker build`.

## Fichiers modifiés par effet de bord
`migrations/029_messaging.sql` : fins de ligne uniquement (contenu SQL identique).
