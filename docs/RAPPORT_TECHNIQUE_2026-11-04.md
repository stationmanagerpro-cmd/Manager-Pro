# ManagePro — Rapport technique de livraison (4 novembre 2026)

Base : V1.11.30 + correctifs 33/34 · Audit de référence : 3 novembre 2026
Suivi détaillé : `ManagePro_Suivi_Corrections_2026-11-04.xlsx` (références CORR-001 à CORR-021).

## 1. Ce qui a été fait (21 corrections, 3 terminées, 18 « à vérifier »)

| Réf. | Audit | Correction |
|---|---|---|
| CORR-001 | C1 | Migration `092_index_performance.sql` : 9 index additifs (seuls ceux réellement manquants) |
| CORR-002 | B3 | Migration `093_employees_updated_at.sql` : `employees.updated_at` |
| CORR-003 | B2 | Changement de prix : `products.sell_price` ; 404 + annulation complète si produit étranger |
| CORR-004 | B2 | Ticket de caisse : `sale_details`, `payments`, `sales.status` |
| CORR-005 | D7 | Échappement HTML complet du ticket (serveur) |
| CORR-006 | D4 | `/api/health` : `{ok}` en public ; détails avec `X-Health-Token` = `HEALTH_TOKEN` |
| CORR-007 | A3 | Node 22 (Dockerfile, `engines >=22`) |
| CORR-008 | E1 | Dockerfile : `npm ci`, `USER node`, `HEALTHCHECK` |
| CORR-009 | A1 | `npm run pack` : ZIP sans `.env`, `node_modules`, `backups`, `uploads` |
| CORR-010 | D3 | `BACKUP_EMAIL_ATTACH=0` par défaut dans `.env.example` |
| CORR-011 | D2 | Limiteurs de débit (IP 600/min, utilisateur 400/min, réglables) ; corps JSON 2 Mo par défaut, 16 Mo sur les seules routes de fichiers |
| CORR-012 | D7 (client) | Fenêtre du ticket : `saleId` et `r.text` échappés (`public/ext-premium.js`) ; apostrophe ajoutée à l'export « Mes stations » (`ext-magasins.js`) |
| CORR-013 | E2 | Test `superadmin-sidebar-icons-static` mis à jour (clé `carte` du menu) : 10/10 |
| CORR-014 | B5 | Nouveau `src/safe.js` : `swallow(étiquette, repli)` journalise l'erreur (1 fois / 10 min) et renvoie le même repli qu'avant |
| CORR-015 | B5 | `swallow` appliqué à `reports.js` (3 sites) et `ops_plus.js` (5 sites, dont `cash_gaps` : le journal confirmera la table absente, B1) |
| CORR-016 | B5 | `swallow` appliqué à `search.js` (6 sites) et `fiscal.js` (8 sites : `ensureChecklist`, `fiscal_rules`, `fiscal_checklist_items`, `fiscal_audit_log`) |
| CORR-017 | B5 | `swallow` appliqué à `notification_rules.js` (4), `monthly_archive.js` (2) et `backup.js` (1). Restent silencieux volontairement : envois d'e-mails, ROLLBACK, `release`, `pool.end`, préchauffage du cache |
| CORR-018 | D5 | Politique de mots de passe (`src/password_policy.js`) : 8 caractères minimum pour tous les comptes, relevable pour ADMIN / SUPERADMIN / comptes de plateforme via `PASSWORD_MIN_PRIVILEGED`, liste de refus, identifiant interdit ; appliquée à la création de compte et au changement de mot de passe (`src/auth.js`). **À tester** : `test:security` et `test:licenses` (comptes créés avec des mots de passe de test). Hors périmètre : double authentification (TOTP), mot de passe initial du propriétaire à la création de contrat |
| CORR-019 | D1 (immédiat) | Durée de session : 4 h pour ADMIN / SUPERADMIN / comptes de plateforme (`SESSION_HOURS_PRIVILEGED`), 12 h pour les autres (`SESSION_HOURS`) ; session en base et jeton alignés (`src/session_policy.js`, `src/auth.js`). **Effet visible** : les administrateurs devront se reconnecter après 4 h. Le volet à moyen terme (cookie HttpOnly + anti-CSRF) n'est pas traité |
| CORR-020 | C2 | Règle « un numéro = un fichier » documentée (`docs/MIGRATIONS_INDEX.md`, dernière migration mise à jour : 093) et garde-fou `test/migration-numbering-static.js` (3/3) : refuse tout nouveau doublon et tout numéro non croissant. Aucune migration renumérotée |
| CORR-021 | D3-B | Sauvegardes jointes aux e-mails **chiffrées** (AES-256-GCM, `src/backup_crypto.js`) avec `BACKUP_ENCRYPTION_KEY` (16 caractères minimum, hors base). Sans clé : aucune pièce jointe, sauf `BACKUP_EMAIL_ATTACH_PLAINTEXT=1` (déconseillé). Déchiffrement : `BACKUP_ENCRYPTION_KEY=… node scripts/decrypt-backup.js fichier.enc`. **Perdre la clé = perdre la pièce jointe** (la sauvegarde sur disque reste utilisable). Envoi réel d'e-mail non testé |
| CORR-022 | E2 | Test `pdf-logo-columns-static` mis d'accord avec le code : `src/docs.js` interdit tout repli sur le logo de l'application (le logo d'une station ne doit jamais être remplacé par celui de la plateforme). Le test vérifie maintenant cette règle (8/8). Aucun code applicatif modifié |
| CORR-023 | E2 | Test `a5-full-restore-dual-guard-static` : les deux documents de livraison sont rangés dans « Dossier CHANGELOG » ; le test les cherche à la racine puis dans ce dossier (10/10). Documents ni déplacés ni modifiés |
| CORR-024 | B4 | `GET /hr/declarations` (page et CSV) renvoyait toujours une liste vide (« schéma incompatible ») : les requêtes lisaient `payslips.gross_pay`, `employees.nin` et `employees.cnss_number`, absentes du schéma. Corrigé dans `src/ops_plus.js` : `p.gross AS gross_pay`, `e.inps_number AS cnss_number`, NIN laissé vide (aucune colonne source). Noms de sortie inchangés. Test `test/ops-declarations-schema-static.js` (12/12). **À tester** sur base de recette avec un bulletin validé |
| CORR-025 | D6 (lot 1) | Défense en profondeur : `AND station_id` ajouté aux 4 écritures par id de `src/catalog.js` portant sur des tables à `station_id` (`pumps`, `customer_credits`, `customers` solde, `invoices`). Les lignes étaient déjà chargées avec contrôle de station ; aucun comportement attendu ne change. Test `test/station-scope-catalog-static.js` (5/5). Reste ~100 requêtes à traiter par lots. **À tester** : modification de pompe, imputation d'avoir, puis `test:isolation` |
| CORR-026 | D6 (lot 2) | `AND station_id` ajouté à 12 écritures par id : `src/purchases.js` (commandes, statut, paiement, dernier coût produit, dette fournisseur) et `src/hr.js` (écarts employé, ajustements de paie, numéro et suppression de bulletin). Lignes déjà chargées avec contrôle de station : comportement attendu inchangé. Test `test/station-scope-purchases-hr-static.js` (4/4). **À tester** : réception/paiement d'achat, écarts RH, bulletin brouillon, puis `test:isolation` |
| CORR-027 | D6 (lot 3) | `AND station_id` ajouté à 11 écritures par id : soldes clients (vente à crédit, annulation, règlement, carburant à crédit, import), numéros de facture de vente (ventes, ventes carburant, import), référence de virement et remboursement de prêt (`shifts.js`, `operations.js`, `fuelsales.js`, `imports.js`, `finance.js`). Lignes déjà chargées avec contrôle de station : comportement attendu inchangé. Test `test/station-scope-sales-finance-static.js` (5/5). **À tester impérativement** (flux financiers) : ventes à crédit et annulation, règlement client, clôture de quart, import, virement, prêt, puis `test:isolation` |

Principe suivi : aucune réécriture du code qui fonctionne ; modifications limitées aux lignes fautives.

## 2. Écarts avec l'audit (à connaître)

* **C1** : l'audit citait `activity_log` (n'existe pas ; le journal est `audit_logs`, déjà indexé) et `user_sessions` / `stock` (déjà indexés par la migration 021). Seuls les index réellement absents ont été créés.
* **A2** : le `.env` reçu active aussi `RESET_GLOBAL_ENABLED=1` et `CLIENT_RESET_ENABLED=1` (réinitialisations de données), non mentionnés par l'audit.
* **B2 / réconciliation** : `POST /reconcile/run` a d'autres écarts que ceux de l'audit (`products.quantity` et la table `stock`, `shift_counters`). Volontairement **non modifiée** : le calcul des ventes carburant demande un arbitrage et un test sur base réelle.

## 3. Bilan des tests (réel)

* Tests statiques/unitaires : référence 134 réussis / 9 échecs ; après l'ensemble des corrections (jusqu'à CORR-027) et sur l'archive complétée (« Dossier CHANGELOG ») : **145 réussis / 6 échecs**, aucune régression. Les 6 échecs restants : 5 viennent de `zod` absent (pas de `node_modules`, pas de réseau : `npm ci` puis `npm run test:ci` chez vous) et 1 est un écart code/test à arbitrer (`client-company-name-header` : nom de la station ou de l'entreprise cliente dans l'en-tête).
* `migration-safety-static` 7/7 · `migration-backup-gate-static` 7/7 · cohérence `package-lock.json` : 0 écart · `npm run pack` : `.env` absent du ZIP.
* **NON exécutés** (pas de PostgreSQL, serveur, Docker ni réseau) : application des migrations 092/093, requêtes prix et ticket, tests d'intégration (10), build Docker, `npm audit`, `contrast-audit`. C'est pourquoi les corrections concernées sont « À vérifier » et non « Terminées ».

## 4. Déploiement et vérification (ordre recommandé)

1. **Base de recette d'abord.** Sauvegarder, puis `npm ci && npm run migrate` (092 puis 093). Vérifier : `\d employees` montre `updated_at` ; `\di payments_*` liste les nouveaux index.
2. `npm run test:ci` puis les tests d'intégration (`test:security`, `test:contracts`, `test:licenses`, `test:superadmin`).
3. Contrôles manuels : modifier un employé (plus d'erreur 503) ; changer le prix d'un produit puis relire `products.sell_price` ; imprimer un ticket (articles et paiements présents) ; `curl /api/health` (→ `{"ok":true}`) et avec `-H "X-Health-Token: …"` (→ détails).
3 bis. **CORR-011 — à tester impérativement** : envoyer un logo, une photo de profil, une image produit, une signature, un QR d'abonnement, un justificatif fiscal, une pièce de messagerie et un import Excel. Un échec en 413 signalerait une route de fichiers oubliée ; retour arrière immédiat avec `JSON_BODY_LIMIT_DEFAULT=16mb`. Derrière un proxy, vérifier que l'IP réelle est bien vue (sinon tous les clients partagent le quota IP).
4. Docker : mettre Node 22 sur l'hôte si hors conteneur ; `docker build` ; si le volume `/data` existe déjà, `chown -R 1000:1000` (utilisateur `node`) ; vérifier l'état `healthy`.
5. Production : mettre en place `HEALTH_TOKEN` si une supervision a besoin des détails.

## 5. Actions qui vous reviennent (je ne peux pas les faire)

1. **Renouveler les secrets** du `.env` reçu : mot de passe SMTP, mot de passe PostgreSQL, puis `JWT_SECRET` (déconnecte tout le monde une fois). Le fichier est sorti dans l'archive : considérez-les comme exposés.
2. Sur le serveur réel : `NODE_ENV=production` et à `0` : `RESTORE_ENABLED`, `CLIENT_RESTORE_ENABLED`, `PLATFORM_RESTORE_ENABLED`, `RESTORE_TARGET_ISOLATED`, `RESET_GLOBAL_ENABLED`, `CLIENT_RESET_ENABLED`, `BACKUP_EMAIL_ATTACH`.
3. **Décision métier B1** (écarts de caisse) : table dédiée `cash_gaps`, ou calcul à partir de `shifts.cash_gap` et `employee_gaps.status` ?

## 6. Anomalies restantes

16 lignes dans la feuille « Anomalies restantes » du classeur (dont 4 de gravité élevée, 3 bloquées en attente de vous). E2 : reste la décision sur le nom affiché dans l'en-tête et `npm ci` pour les 5 tests `zod`.
