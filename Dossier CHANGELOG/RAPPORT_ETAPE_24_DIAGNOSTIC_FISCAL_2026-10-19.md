# Étape 24 — Diagnostic exécutable de la Fiscalité

## Ajout
- Ajout de `npm run diagnose:fiscal` (`scripts/diagnose-fiscal.js`).
- Contrôle local de `DATABASE_URL` sans afficher sa valeur ni son mot de passe.
- Messages ciblés pour URL invalide, mot de passe absent, connexion refusée et hôte introuvable.
- Après connexion, lecture seule de la base réellement ciblée, tables fiscales dont `fiscal_audit_log`, historique des migrations `046`, `050`, `057`, permission `fiscal.access` et attribution au rôle `ADMIN`.
- Aucune migration, écriture ou modification de données n'est exécutée par ce diagnostic.

## Vérifications effectuées dans cet environnement
- `node --check scripts/diagnose-fiscal.js` : OK.
- `node test/fiscal-diagnostic-script-static.js` : 9/9 assertions.
- Lecture syntaxique de `package.json` : OK.
- L'exécution intégrale `npm run diagnose:fiscal` n'a pas pu démarrer ici car les dépendances du projet (`dotenv`, `pg`) ne sont pas installées dans la copie de travail. Aucun test PostgreSQL réel n'a donc été réalisé.

## Utilisation sur le PC du projet
Depuis PowerShell, dans `C:\StationManagerPro` :

```powershell
npm.cmd run diagnose:fiscal
```

Le script est en lecture seule. Si la connexion échoue, corriger d'abord `.env` localement. Ne pas envoyer le fichier `.env` ni publier le mot de passe.
