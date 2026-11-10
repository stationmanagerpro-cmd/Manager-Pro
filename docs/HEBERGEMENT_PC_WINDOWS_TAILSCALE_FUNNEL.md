# Station Manager Pro — serveur autonome sur PC Windows dédié

## Décision d'architecture (à partir de l'étape 25)

Le PC dédié devient l'hôte principal de l'application et de la base PostgreSQL. Le fonctionnement normal ne dépend d'aucun service cloud. Le code, les fichiers téléversés et la base sont conservés localement sur le PC. Il faut toutefois conserver des copies de sauvegarde indépendantes du PC pour survivre à une panne, un vol, un incendie ou un rançongiciel.

- Application : Node.js LTS, dans un dossier stable comme `C:\StationManagerPro`.
- Base : PostgreSQL installé sur le PC, accessible uniquement sur `127.0.0.1` pour l'application.
- Fichiers et sauvegardes : idéalement `D:\StationManagerData\uploads` et `D:\StationManagerData\backups`, séparés du dossier du code.
- Accès sur le même réseau : adresse LAN du PC et pare-feu Windows configuré pour les seuls réseaux nécessaires.
- Accès à distance : Tailscale Serve pour les appareils autorisés dans le tailnet. Funnel est public et ne doit être activé que si les clients doivent ouvrir le site depuis tout navigateur sans installer Tailscale, après audit de sécurité.
- Copies de secours : disque externe chiffré, débranché après sauvegarde, et si possible une deuxième copie chiffrée conservée dans un lieu distinct.

Garder une copie du dossier du projet et de ses versions sur le PC et sur un disque externe. Ne jamais inclure `.env`, secrets, données clients ou dumps dans une archive de partage.

## Pré-requis

1. Windows maintenu à jour, compte Windows dédié avec mot de passe fort, antivirus actif et verrouillage automatique.
2. Installer Node.js LTS compatible avec `engines` dans `package.json`.
3. Installer PostgreSQL pour Windows et conserver les outils `pg_dump.exe`, `pg_restore.exe`, `psql.exe`, `createdb.exe` et `pg_isready.exe` correspondant à la version majeure installée.
4. Créer un rôle PostgreSQL dédié à l'application et une base `station_manager`. Ne pas utiliser le rôle superutilisateur PostgreSQL dans `DATABASE_URL`.
5. Extraire le projet dans `C:\StationManagerPro` ou un chemin sans synchronisation cloud automatique.
6. Copier `.env.pc.example` en `.env`, puis configurer le mot de passe PostgreSQL, `JWT_SECRET` (long, aléatoire et unique), les chemins de données et éventuellement SMTP.
7. Dans PowerShell à la racine du projet, exécuter `npm ci`, puis `scripts\windows\preflight-pc-server.ps1`.
8. Ne lancer `npm run setup` que sur une base neuve après avoir lu son effet. Ne jamais exécuter `setup`, `migrate` ou une restauration sur des données existantes sans sauvegarde vérifiée.

## Démarrer et tester en local

Depuis la racine du projet :

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File .\scripts\windows\preflight-pc-server.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\windows\start-pc-server.ps1
```

Pour que les autres postes du réseau local ouvrent directement `http://adresse-du-PC:3000`, démarrer avec `start-pc-server.ps1 -Lan` (écoute sur toutes les interfaces) et limiter le pare-feu Windows au réseau privé. Sans cette option, le serveur reste accessible uniquement depuis le PC lui-même (et Tailscale Serve).

Sur le PC, vérifier `http://127.0.0.1:3000/api/health`, puis tester les connexions Super Admin et client. Le serveur reste attaché à `127.0.0.1` afin qu'il ne soit pas exposé directement sur toutes les interfaces Windows. Pour Tailscale Serve, le proxy HTTPS peut joindre le port local.

## Accès distant : privé d'abord

### Recommandé : Tailscale Serve

Utiliser Serve si seuls les appareils ou personnes autorisés doivent accéder à l'application. Installer Tailscale sur le PC et sur les appareils clients autorisés, activer HTTPS dans le tailnet, puis utiliser la commande adaptée à la version installée, par exemple `tailscale serve 3000`. Les règles d'accès Tailscale et les rôles de Station Manager Pro sont deux protections complémentaires.

### Funnel : accès public seulement si nécessaire

Funnel expose l'application sur Internet à toute personne qui possède l'URL. L'URL n'est pas un mécanisme d'authentification. Ne pas l'activer automatiquement. Avant activation, tester les permissions API, les mots de passe, le verrouillage de connexion, les uploads, les sauvegardes et les limites de requêtes. Ne jamais exposer PostgreSQL (port 5432) ni le bureau à distance Windows.

Le script `start-tailscale-funnel.ps1` affiche une procédure mais ne lance pas Funnel de lui-même. Pour arrêter l'exposition, utiliser la commande `tailscale funnel reset` ou la procédure officielle de la version installée.

Documentation officielle :
- Tailscale Serve : https://tailscale.com/docs/features/tailscale-serve
- Tailscale Funnel : https://tailscale.com/docs/features/tailscale-funnel

## Sauvegardes indispensables

- Programmer une sauvegarde PostgreSQL chaque nuit, et vérifier le fichier et le journal de résultat.
- Garder au moins une copie chiffrée sur un disque externe débranché après copie. Une sauvegarde uniquement sur le PC n'est pas suffisante.
- Effectuer périodiquement un test de restauration sur une base distincte.
- Conserver séparément les fichiers téléversés (`UPLOAD_DIR`) : un dump PostgreSQL contient les références mais pas nécessairement les fichiers eux-mêmes.
- Pour créer un package cohérent sur un disque externe, lancer depuis la racine du projet : `powershell -ExecutionPolicy Bypass -File .\scripts\windows\backup-complete.ps1 -DestinationRoot E:\StationManagerBackups`. Choisir une destination hors du dossier projet, idéalement sur un disque externe chiffré. Le script déclenche la sauvegarde PostgreSQL, copie les fichiers téléversés, écrit un manifeste SHA-256, extrait l’archive dans un répertoire temporaire et vérifie les tailles et empreintes. Il n’inclut pas `.env` et n’efface pas les sauvegardes existantes.
- La vérification d’intégrité de l’archive ne remplace pas un test de restauration PostgreSQL : planifier aussi une restauration d’essai sur une base distincte.
- Le mail de confirmation ne remplace pas le fichier de sauvegarde. Le SMTP est facultatif et peut avoir ses propres limites.
- Garder les fonctions de réinitialisation/restauration désactivées jusqu'à validation de bout en bout.

## Continuité de service

Le site ne sera accessible que si le PC est allumé, le réseau Internet fonctionne, PostgreSQL et Node démarrent correctement, et Tailscale fonctionne. Prévoir un onduleur, ventilation, surveillance de l'espace disque, mises à jour Windows contrôlées, compte Windows dédié et une tâche planifiée pour démarrer l'application après redémarrage uniquement après essais.

## Sécurité des secrets

Ne pas envoyer `.env` par email, ne pas le mettre dans une archive destinée à être partagée et ne pas inscrire les mots de passe dans les commandes ou captures d'écran. Si un secret a été exposé, le remplacer immédiatement. Ne jamais ouvrir les ports 3000 ou 5432 sur le routeur sans étude de sécurité ; privilégier le tunnel Tailscale.
