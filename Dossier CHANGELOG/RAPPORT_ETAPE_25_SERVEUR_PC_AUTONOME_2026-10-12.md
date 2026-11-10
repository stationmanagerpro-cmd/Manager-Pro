# Rapport — Étape 25 : hébergement autonome sur PC dédié

Date : 12 octobre 2026

## Décision prise


## Changements livrés

- `.env.pc.example` utilise PostgreSQL local sur `127.0.0.1:5432`, un répertoire d'uploads et un répertoire de sauvegardes situés hors du dossier du code, et laisse les opérations destructives désactivées.
- `docs/HEBERGEMENT_PC_WINDOWS_TAILSCALE_FUNNEL.md` réécrit comme guide principal de déploiement local, sauvegarde, migration ponctuelle et accès distant.
- `scripts/windows/install-local-server.ps1` vérifie Node/npm, crée `.env` seulement s'il est absent, prépare les répertoires et lance `npm ci`. Il ne crée ni ne modifie la base de données.
- `scripts/windows/migrate-database-to-local.ps1` permet une migration ponctuelle depuis une URL PostgreSQL vers une base locale vide. Il demande l'URL source de manière masquée, vérifie que la cible est locale et vide, exporte un dump temporaire, restaure vers la cible et ne supprime pas la source.
- `test/step25-local-server-static.js` ajoute 13 contrôles statiques de la nouvelle architecture.
- `test/step24-pc-hosting-static.js` est ajusté à la décision locale-only.

## Résultats vérifiés dans cet environnement

- 107 fichiers JavaScript/CJS de `src`, `public` et `test` : `node --check` sans erreur.
- 29 scripts de tests statiques exécutés : 29/29 réussis.
- Les 13 contrôles propres à l'étape 25 réussissent.
- Archive ZIP vérifiée avec `unzip -t`.

## Limites et étapes requises sur le PC réel

- Les scripts PowerShell n'ont pas été exécutés sur le PC de l'utilisateur.
- Aucune installation PostgreSQL réelle, aucun dump réel et aucune restauration réelle n'ont été exécutés dans cet environnement.
- Aucun email n'a été envoyé.
- Aucun service externe n'a été arrêté, aucune donnée n'a été supprimée, et aucun déploiement distant n'a été effectué.
- La migration nécessite `pg_dump`, `pg_restore` et `psql` compatibles avec les versions PostgreSQL source/cible. Elle demande une base locale vide et peut laisser la cible partiellement restaurée si l'opération échoue ; dans ce cas, ne pas basculer l'application et recréer une cible vide avant nouvel essai.
- Le script lit `DATABASE_URL` depuis `.env`; la valeur ne doit pas être partagée. L'URL source est demandée dans une entrée masquée, mais reste temporairement présente en mémoire du processus pendant la migration.
- Avant la bascule, comparer les clients, stations, utilisateurs, ventes, finances, stocks et tester les pièces jointes (dossier `UPLOAD_DIR` distinct du dump SQL).
- Le dump temporaire est supprimé à la fin du script. Faire séparément une copie chiffrée sur disque externe avant de lancer la migration.
- Tailscale Serve est recommandé pour un accès privé. Funnel expose publiquement l'application et doit rester désactivé jusqu'à validation de sécurité.

## Procédure conseillée

1. Copier le projet sur le PC dédié dans un dossier stable, par exemple `C:\StationManagerPro`.
2. Installer Node.js LTS et PostgreSQL, puis créer un rôle applicatif et une base locale vide.
3. Exécuter `scripts\windows\install-local-server.ps1` et configurer `.env` avec un mot de passe PostgreSQL fort et un `JWT_SECRET` aléatoire.
4. Si des données sont encore sur une base distante, créer d'abord une sauvegarde externe indépendante, puis exécuter `scripts\windows\migrate-database-to-local.ps1`.
5. Vérifier les données et tester les profils dans l'application avant de considérer la migration terminée.
6. Configurer les sauvegardes planifiées et un test de restauration sur une base séparée.
7. Configurer Tailscale Serve seulement après validation locale. N'activer Funnel que si un accès public est nécessaire et après audit.

Aucune migration de schéma applicatif n'est ajoutée dans cette étape.
