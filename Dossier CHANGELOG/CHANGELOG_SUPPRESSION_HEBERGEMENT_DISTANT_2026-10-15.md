# Retrait des références aux hébergements distants (2026-10-15)

L'application est exploitée uniquement sur le PC serveur (Node.js + PostgreSQL locaux).

## Supprimé
- Les deux guides de déploiement distant (fichiers dédiés à l'ancien hébergement et au dépôt en ligne).
- Les sections de checklist d'hébergement distant de `DEPLOY_MODULE_FISCALITE.md`, remplacées par une checklist de mise à jour sur le PC serveur.
- La section « migration depuis une base distante » du guide `docs/HEBERGEMENT_PC_WINDOWS_TAILSCALE_FUNNEL.md`.
- Les mentions correspondantes dans `.env.example`, `README.md`, `LISEZMOI.txt`, `src/server.js` (commentaire), les rapports historiques et les tests.

## Adapté
- `test/step24-pc-hosting-static.js` et `test/step25-local-server-static.js` : phrase de contrôle mise à jour, contrôles liés à la migration distante retirés.
- `RAPPORT_AUDIT_SUPERADMIN.md` : section « Instructions finales » réécrite pour une procédure locale.

## Aucun changement fonctionnel
Aucune route, migration ou logique métier n'a été modifiée.
