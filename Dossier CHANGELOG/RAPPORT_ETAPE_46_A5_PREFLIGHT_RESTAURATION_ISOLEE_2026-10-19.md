# Étape 46 — Précontrôle Windows A5 avant restauration complète

## Ajout

- `scripts/windows/a5-preflight-restore.ps1` effectue un précontrôle en lecture seule avant toute restauration SQL complète.
- Vérifie la présence de `.env`, l’analyse de `DATABASE_URL`, un suffixe de nom de base `_test`, `_isolated` ou `_isolee`, un hôte local et les deux verrous `RESTORE_ENABLED=1` et `RESTORE_TARGET_ISOLATED=1`.
- N’affiche jamais l’URL complète (donc ne révèle pas le mot de passe), ne se connecte pas à PostgreSQL et ne lance aucune restauration.
- Test statique ajouté : `test/a5-restore-preflight-static.js`.

## Limites importantes

Un nom de base de test et un hôte local ne prouvent pas que la base ne contient pas de données importantes. Le script est une barrière préliminaire, pas une validation de contenu ni un test d’intégration PostgreSQL. Il ne doit pas être interprété comme une autorisation automatique de restauration. Aucune restauration réelle ni connexion PostgreSQL n’a été exécutée dans cette étape.

## Commandes

```powershell
node test/a5-restore-preflight-static.js
powershell -ExecutionPolicy Bypass -File .\scripts\windows\a5-preflight-restore.ps1
```

La seconde commande ne réussira que si la configuration locale est explicitement préparée pour une base de test et les deux verrous activés.
