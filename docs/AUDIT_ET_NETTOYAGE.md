# Audit, nettoyage et améliorations — Station Manager Pro
Date : 2026-10-04

## 1. Nettoyage effectué
- Suppression du dossier imbriqué dupliqué `station-manager-pro/station-manager-pro/`
- Suppression des fichiers parasites vides : `0`, `type`, `{`, `powershell`
- Suppression de `node_modules` (à re-générer avec `npm install`)
- Suppression du fichier `.env` (contenait secrets) → remplacé par `.env.example`
- Suppression des backups de test (recréés vides avec `.gitkeep`)
- Ajout de `uploads/.gitkeep`

## 2. Vérification des migrations (001 → 020)
- 20 fichiers SQL présents, nommés séquentiellement, triés alphabétiquement (correct pour `migrate.js`)
- Toutes les migrations sont **non destructives** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, pas de DROP/TRUNCATE)
- `migrate.js` : sauvegarde automatique avant migration si données présentes, transactions par fichier, table `schema_migrations`
- **Statut : À JOUR et cohérent**

## 3. Audit sécurité (résumé)
| Point | Statut | Commentaire |
|-------|--------|-------------|
| JWT + sessions révocables | OK | Session en base, expiration 12h, révocation logout |
| Rate-limit login | OK | 30 / 15 min |
| Lockout compte | OK | 5 échecs → 423 |
| bcrypt cost 12 | OK | |
| Helmet + CSP | OK | script-src-attr unsafe-inline (nécessaire pour onclick) |
| CORS | OK | Contrôlé par env |
| Isolation station | OK | X-Station-Id + user_stations |
| Anti-élévation is_global / ADMIN | OK | Côté serveur |
| Permissions `need()` | OK | |
| Audit logs | OK | |
| Contrats / licences / modules | OK | Middleware + feature flags |
| Secrets dans archive | Corrigé | .env retiré |

**Recommandations production** :
- Changer JWT_SECRET (≥ 32 car. aléatoires)
- Activer HTTPS (reverse-proxy nginx/caddy)
- `BACKUP_AUTO=1` + email notification
- Ne jamais exposer le port PostgreSQL
- `CORS_ORIGIN` strict en production

## 4. Améliorations UI (cette version)
- **Onglets (`.tabs`)** : désormais **horizontaux avec défilement** (plus de wrap qui prend de la hauteur)
  - `flex-wrap: nowrap` + `overflow-x: auto`
  - `white-space: nowrap` + `flex-shrink: 0` sur les liens
  - Barre de défilement fine et discrète (webkit + scrollbar-width)
- **Barres de roulement personnalisées** sur :
  - Tables (`.tw`)
  - Modales
  - Résultats de recherche
  - Navigation latérale
  - Contenu principal
- Gain d’espace vertical notable sur les fiches employés, ventes, admin, etc. qui ont beaucoup d’onglets.

## 5. Tests
Impossible d’exécuter la suite complète ici (PostgreSQL non disponible dans l’environnement d’audit).
Commandes à lancer chez vous :

```bash
createdb station_manager_test
DATABASE_URL=postgres://.../station_manager_test npm run migrate
DATABASE_URL=postgres://.../station_manager_test npm run setup -- admin MotDePasse123 "Station test"
npm test
npm run test:security
npm run test:payroll
npm run test:licenses
```

## 6. Démarrage propre
```bash
cd station-manager-api
cp .env.example .env          # éditer DATABASE_URL + JWT_SECRET
createdb station_manager
npm install
npm run migrate
npm run setup -- admin "MotDePasseSolide1" "Ma station"
npm start
# → http://localhost:3000
```

Docker :
```bash
export DB_PASSWORD=... JWT_SECRET=...
docker compose up -d --build
docker compose run --rm api node src/setup.js admin "MotDePasseSolide1" "Ma station"
```

## 7. Structure finale livrée
```
station-manager-pro/
├── LISEZMOI.txt
├── AUDIT_ET_NETTOYAGE.md   ← ce fichier
├── SECURITY.md, PRIORITES_DEV.md, RH_*.md, …
├── demo-hors-ligne/
└── station-manager-api/
    ├── .env.example
    ├── Dockerfile + docker-compose.yml
    ├── package.json
    ├── migrations/ (001…020)
    ├── src/
    ├── public/ (UI modernisée + tabs scrollables)
    ├── test/
    ├── backups/  (vide + .gitkeep)
    └── uploads/  (vide + .gitkeep)
```

Archive prête à l’emploi.


## 8. Onglets imbriqués (demande utilisateur 2026-10-04)

### Objectif
Réduire le nombre d'onglets visibles, gagner de l'espace, et proposer des onglets **verticaux + horizontaux** avec barres de défilement.

### Fiche employé (`empf`)
**Avant** : 7 onglets horizontaux plats  
**Après** : 3 groupes verticaux + sous-onglets horizontaux

| Groupe (vertical) | Sous-onglets (horizontal) |
|-------------------|---------------------------|
| Identité | Identité |
| Activité | Quarts · Performances · Écarts |
| Finances RH | Dettes & avances · Paie & bulletins · Situation financière |

### Centre administrateur (`admin`)
**Avant** : 9 boutons  
**Après** : 4 groupes verticaux + sous-onglets

| Groupe | Sous-onglets |
|--------|--------------|
| Vue d'ensemble | Synthèse |
| Accès | Utilisateurs · Rôles & permissions · Contrats |
| Station | Station · Paramètres · Dashboard |
| Système | Sauvegardes · Système |

### CSS ajouté
- `.tabs-v` : onglets verticaux avec barre de défilement
- `.subtabs` : sous-onglets horizontaux style « underline »
- `.tab-layout` : layout flex (vertical + contenu)
- Responsive : sur mobile les groupes verticaux basculent en horizontal scrollable

Les barres de roulement (scrollbars) personnalisées sont déjà en place sur tables, modales, nav, etc.

## 9. Pack d'améliorations implémenté (demande « ajoutez tous ces mises à jour »)

### Haute priorité
| # | Amélioration | Statut |
|---|--------------|--------|
| 1 | Index performance RH / ventes / caisse / audit | **FAIT** — migration `021_performance_indexes.sql` |
| 2 | Messages d'erreur enrichis (Zod path + traductions) | **FAIT** — `ext-improvements.js` |
| 3 | File hors-ligne (IndexedDB) + badge réseau | **FAIT** — base solide, sync au retour online |
| 4 | Test sauvegarde automatisé | **FAIT** — `npm run test:restore` + `test:ci` |
| 5 | Secrets / `.env.example` strict | **FAIT** |

### Priorité moyenne
| # | Amélioration | Statut |
|---|--------------|--------|
| 6 | Mode Focus pompiste ultra-minimal (vente rapide) | **FAIT** |
| 7 | Filtres persistants (période, mois) | **FAIT** — sessionStorage |
| 8 | Branding PDF (logo station) | **Déjà présent** dans `docs.js` |
| 9 | Email alertes backup | **Déjà présent** (SMTP + BACKUP_NOTIFY_EMAIL) |
| 10 | Recherche globale enrichie (employés + aide) | **FAIT** |

### Priorité basse / polish
| # | Amélioration | Statut |
|---|--------------|--------|
| 11 | Overlay raccourcis clavier (`?`) | **FAIT** |
| 12 | Thème sombre contraste renforcé | **FAIT** |
| 13 | Skeletons systématiques | **FAIT** |
| 14 | Page « Premiers pas » | **FAIT** — menu `onboard` |
| 15 | Helpers journal d'activité filtré | **FAIT** |

### Architecture / déploiement
| # | Amélioration | Statut |
|---|--------------|--------|
| — | Docker Compose + healthchecks | **FAIT** |
| — | Profil HTTPS Caddy (reverse-proxy) | **FAIT** — `docker compose --profile proxy up` |
| — | Caddyfile + headers sécurité | **FAIT** |
| — | Scripts CI `test:ci` / `test:restore` | **FAIT** |

### Non implémenté à 100 % (bases fournies)
- Sync offline complète multi-appareils (file locale OK, pas encore de résolution de conflits avancée)
- Tests e2e Playwright (script restore + suite unitaire existante)
- Push notifications mobiles natives (email SMTP déjà en place)
- Découpage bundler esbuild (structure `ext-*.js` conservée pour compatibilité)

### Fichiers ajoutés / modifiés
- `migrations/021_performance_indexes.sql`
- `public/ext-improvements.js` (nouveau)
- `public/app.js` (focus, recherche)
- `public/app.css` (thème sombre, skeletons, focus, kbd)
- `public/index.html` (script)
- `scripts/ci-restore-test.js`
- `package.json` (scripts test:restore, test:ci)
- `docker-compose.yml` + `Caddyfile`
- `.env.example` enrichi

## 10. Refonte UX v2 (cahier des charges complet)

### 1. Profils Clients & Fournisseurs
- Fiches enrichies avec KPI (solde, limite, fidélité, CA/achats cumulés)
- Graphiques Chart.js (CA mensuel client / achats fournisseur)
- Onglets imbriqués : Ventes · Règlements · Avoirs
- Historique transactions déjà côté API (`/customers/:id/history`, `/suppliers/:id/history`)

### 2. Dashboard principal
- En-tête utilisateur (avatar, nom, rôle)
- Horloge / date temps réel
- Menu horizontal supérieur (Accueil, Quarts, Ventes, Caisse, Clients, Fournisseurs, RH, Alertes, Journal, Paramètres)
- Activité récente + config par rôle (P10/P11 existants renforcés)

### 3. Stats par rôle admin
- Déjà en place (`dashboard_config` + UI `dashcfg`)

### 4. Exports PDF/Excel
- Hub `/exports/:kind` : customers, suppliers, stock, sales, expenses, cash, pumps, shifts
- Rapport quart PDF (`/shifts/:id/report.pdf`) + full report

### 5. Réorganisation menus
- Menu horizontal avec raccourcis Alertes + Journal
- Produits / Pompes accessibles via admin, recherche, et toujours routés

### 6. Caisse miroir financier
- Liquidités multi-canaux (espèces, MM, banque) existants
- **Nouveau** : module Prêts hors-exploitation (CRUD + remboursement)
  - Migration `022_loans_and_settings.sql`
  - API `/finance/loans`, `/finance/loans/:id/repay`

### 7. Paramètres admin avancés
- Centre admin unifié (P12) + config emails backup

### 8. Sauvegardes auto + emails
- Scheduler 24h (`BACKUP_AUTO=1`)
- Journal `backup_logs`
- **Nouveau** : jusqu'à 2 e-mails secondaires (env + settings `backup_emails`)

### 9. Multilingue FR/EN
- i18n.js enrichi (loans, loyalty, liquidity, etc.)

### 10. Espace employé
- « Mes alertes personnelles » (écarts, dettes, avances) sur la fiche moi
- Offline queue (IndexedDB) déjà en place
- Push natif / Playwright e2e : bases documentées, non bloquants

### Fichiers clés ajoutés/modifiés
- `migrations/022_loans_and_settings.sql`
- `src/finance.js` (prêts)
- `src/backup.js` (multi-destinataires)
- `src/admin.js` (backup_emails)
- `public/ext-ux-v2.js` (topbar, profils, prêts, employé)
- `public/app.css`, `i18n.js`, `index.html`
