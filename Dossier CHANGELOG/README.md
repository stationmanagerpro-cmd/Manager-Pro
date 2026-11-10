# Station Manager Pro — v21 (28/10/2026)

Application de gestion de station-service multi-station : ventes produits et carburants, quarts, pompes/compteurs, caisse/finance, clients/fournisseurs, RH/paie, contrats/licences, administration de plateforme, exports et audit.

**Stack :** Node.js 18+, Express, PostgreSQL 14+, client web servi par l’API.  
**Version package :** `21.0.0` (voir `package.json`).

## Base de référence

Cette archive a été préparée à partir du projet existant et du **Prompt consolidé de correction et d’évolution du 07/10/2026**. Les migrations (`001` à `077`) ne sont jamais réécrites ; elles s’appliquent dans l’ordre des noms de fichiers. Les évolutions récentes (profils, archivage, signature, accueil, ouverture de quart datée) sont décrites dans les `CHANGELOG_*.md` à la racine.

**Configuration :** copier `.env.example` vers `.env` (modèle standard). Pour un déploiement PC Windows dédié, utiliser plutôt `.env.pc.example`.

Référence fonctionnelle : `docs/PROMPT_CONSOLIDE_2026-10-07.md`.

## Hébergement officiel retenu : PC Windows dédié

À partir de l’étape 25, l’architecture cible est autonome : l’application Node.js et PostgreSQL tournent sur un PC dédié. La base et les fichiers métier sont stockés localement ; des copies chiffrées doivent être conservées hors du PC.

Consulter `docs/HEBERGEMENT_PC_WINDOWS_TAILSCALE_FUNNEL.md` avant l’installation. Le modèle `.env.pc.example` configure PostgreSQL local et des dossiers persistants hors du code.

Depuis PowerShell, dans le dossier du projet :

```powershell
# 1. Installer/configurer PostgreSQL et créer une base vide + rôle applicatif
# 2. Copier .env.pc.example vers .env et définir DATABASE_URL + JWT_SECRET
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-local-server.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\windows\preflight-pc-server.ps1
# Pour migrer une base existante, uniquement après sauvegarde et validation :
powershell -ExecutionPolicy Bypass -File .\scripts\windows\migrate-database-to-local.ps1
# Démarrage local
powershell -ExecutionPolicy Bypass -File .\scripts\windows\start-pc-server.ps1
```

La migration ponctuelle exige une base cible locale vide et ne supprime pas la source. Ne lancez pas `npm run setup` ou une restauration sur une base existante sans comprendre leurs effets. Vérifier les comptes, stations, ventes, pièces jointes et exports avant de basculer.

## Accès à distance

Pour un accès privé aux appareils de confiance, privilégier **Tailscale Serve**. Tailscale Funnel expose l’écran de connexion sur Internet ; il ne doit être activé qu’après un audit de sécurité et si les clients doivent accéder depuis un navigateur sans installer Tailscale. Ni Funnel ni Tailscale ne remplace l’authentification de l’application ou les sauvegardes. Ne jamais exposer PostgreSQL sur Internet.

## Sauvegardes et reprise après incident

- Configurer les sauvegardes PostgreSQL automatiques et vérifier réellement les fichiers produits.
- Sauvegarder aussi le dossier `UPLOAD_DIR`, car un dump SQL ne contient pas forcément les photos et pièces jointes.
- Conserver une copie chiffrée sur un disque externe débranché après la sauvegarde et tester la restauration sur une base séparée.
- L’email de confirmation ne remplace pas le fichier de sauvegarde.
- Le PC doit rester allumé et connecté pour que le site soit accessible ; prévoir un onduleur, les mises à jour Windows, une surveillance du disque et un redémarrage automatique testé.


## Comptes et sécurité

L’Administrateur Principal est un **compte de plateforme sans station**. Il gère les clients, contrats, licences, packs, modules et plafonds, mais n’accède pas aux ventes, caisses, finances, RH ou données métier d’une station.

Le gérant travaille dans sa station et délègue les permissions à ses utilisateurs. Le plafond de permissions par station est appliqué côté serveur. Une révocation d’accès bloque les sessions sans supprimer les données.

La permission effective d’un utilisateur station est limitée par le contrat/licence, le plafond de la station et les droits délégués.

## Fonctionnalités consolidées

- Correction de la création/liaison gérant → station (B1) et rattrapage des comptes orphelins.
- Carburants présents dans le flux de nouvelle vente (B2), sans double comptage.
- Fiche complète / Voir quart / PDF de quart (B3).
- Déclarations et déclarations sociales (B4), paramètres station (B5).
- Modules RH avec contrôle licence et refus API si module désactivé (B6/B9).
- SMTP : aucun envoi fictif ; absence de SMTP clairement signalée.
- Validation réelle des PNG/JPEG/PDF selon le contexte et limite de taille (B8).
- Espace abonnement, dashboard plateforme, flux d’activité du gérant.
- Ouverture de quart avec chef, participants, rôle dans le quart, pompes, compteurs et caisse initiale.
- Profils clients/fournisseurs enrichis et exports.
- Préférences de colonnes d’export côté serveur avec liste blanche.
- Règles de paie versionnées, confirmées et activées explicitement ; les taux maliens ne sont pas inventés.
- Compteur de connexions et « Premiers pas » pour les trois premières connexions réussies.
- Responsive, FR/EN, thème clair/sombre, focus pompiste et animations respectant `prefers-reduced-motion`.

## Tests et preuve de livraison

Contrôles réellement exécutables dans l’environnement de préparation :

```bash
node --check src/server.js
node --check src/auth.js
# et contrôle syntaxique de tous les fichiers JavaScript
```

Le contrôle syntaxique des fichiers JavaScript de cette archive a été exécuté sans erreur.

Les tests d’intégration nécessitant PostgreSQL ne sont **pas déclarés verts** dans cette archive tant qu’ils n’ont pas été exécutés sur une base de test. La livraison contient le rapport `docs/RAPPORT_LIVRAISON_FINAL_2026-10-07.md` avec cette distinction.

## Commandes de validation complète sur une base de test

```bash
createdb station_manager_test
DATABASE_URL=postgres://.../station_manager_test npm run migrate
DATABASE_URL=postgres://.../station_manager_test npm run setup -- admin MotDePasse123 "Station test"

npm test
npm run test:security
npm run test:licenses
npm run test:payroll
npm run test:rhv2
npm run test:contracts
npm run test:ci
```

## Règles de non-régression

- aucune migration historique déjà appliquée n’est modifiée ;
- aucune suppression physique de compte client par l’interface ;
- aucune donnée métier supprimée ;
- aucun succès fictif pour sauvegarde, SMTP ou paie ;
- toute restriction importante est contrôlée par l’API, pas seulement par l’interface ;
- les paramètres et règles métier restent configurables et historisés.

## Documentation

- `LISEZMOI.txt` — démarrage et points importants.
- `docs/PROMPT_CONSOLIDE_2026-10-07.md` — exigences de référence.
- `docs/RAPPORT_LIVRAISON_FINAL_2026-10-07.md` — état de cette livraison et preuves disponibles.
- `docs/HEBERGEMENT_PC_WINDOWS_TAILSCALE_FUNNEL.md` — hébergement autonome sur PC, PostgreSQL local, Tailscale et sauvegardes.
- `docs/RH_PAIE_MALI.md` et `docs/ACTIVATION_PROGRESSIVE.md` — paie et activation progressive.

## Couleurs des rapports PDF / Excel

Les instructions d’autorisation préalable des clients et de personnalisation indépendante des rapports Super Admin sont dans [`docs/PERSONNALISATION_COULEURS_RAPPORTS.md`](docs/PERSONNALISATION_COULEURS_RAPPORTS.md). La migration additive `040_platform_report_export_preferences.sql` doit être appliquée après une sauvegarde vérifiée.
