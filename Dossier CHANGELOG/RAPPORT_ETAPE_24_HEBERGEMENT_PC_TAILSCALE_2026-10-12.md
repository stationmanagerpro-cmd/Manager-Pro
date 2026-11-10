# Rapport — Étape 24 : préparation de l'hébergement sur PC Windows et Tailscale

Date : 2026-10-12

## Objectif


## Modifications

- `.env.pc.example` fournit un modèle de configuration Windows, avec `HOST=127.0.0.1`, dossier de sauvegarde distinct et fonctions de restauration/réinitialisation désactivées.
- `scripts/windows/preflight-pc-server.ps1` vérifie les prérequis : Node, npm, `.env`, dépendances, pg_dump et Tailscale CLI.
- `scripts/windows/start-pc-server.ps1` démarre l'application localement et force l'écoute sur `127.0.0.1`.
- `scripts/windows/start-tailscale-funnel.ps1` vérifie l'endpoint local et affiche la commande à exécuter ; il n'active pas Funnel automatiquement.
- `scripts/windows/backup-now.ps1` lance la vraie commande de sauvegarde et échoue explicitement si celle-ci échoue.
- README et `.gitignore` mis à jour pour inclure la documentation et le modèle d'environnement non secret.
- Nouveau test statique `test/step24-pc-hosting-static.js` et script `test:step24-pc-hosting-static`.

## Résultats réellement exécutés

- `node --check` sur 108 fichiers JavaScript/CJS dans `src`, `public`, `test`, `scripts` : réussite, aucune erreur de syntaxe.
- 25 scripts de tests statiques lancés : 25 réussis, 0 échec.
- Le nouveau test de l'étape 24 : 10/10 contrôles statiques réussis.
- Archive ZIP validée par `unzip -t` après création.

## Limites

- Aucun test PowerShell sur un vrai Windows n'a été exécuté dans cet environnement.
- Aucune installation Node/PostgreSQL/Tailscale n'a été réalisée sur le PC de l'utilisateur.
- Aucun test de connexion réel, de sauvegarde PostgreSQL, de restauration, de disponibilité internet ou de Funnel n'a été exécuté.

## Mise en service prudente

1. Extraire cette archive dans un dossier stable sur le PC.
3. Copier `.env.pc.example` vers `.env`, renseigner les secrets localement et ne jamais committer `.env`.
4. Installer les dépendances avec `npm ci`.
5. Exécuter le script de pré-vérification, puis lancer l'application localement et vérifier `/api/health`.
6. Tester une sauvegarde et restaurer sur une base séparée ; conserver une copie chiffrée hors du PC.
7. N'activer Funnel manuellement qu'après vérification de tous les contrôles d'accès. Pour une utilisation privée, préférer Tailscale Serve.

