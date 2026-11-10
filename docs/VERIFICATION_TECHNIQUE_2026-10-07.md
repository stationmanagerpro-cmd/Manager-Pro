# Vérification technique — Station Manager Pro — 07/10/2026

## Résultat

La livraison a été contrôlée avant empaquetage.

### Contrôles exécutés avec succès
- 63 fichiers JavaScript du projet (src, public, test, scripts) contrôlés avec `node --check`.
- 0 erreur de syntaxe.
- Migrations historiques conservées.
- Migrations 027 et 028 présentes.
- Recherche des instructions SQL destructives usuelles (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`) dans les migrations : aucune occurrence détectée.
- Le code de démarrage impose `JWT_SECRET` d'au moins 32 caractères.
- Le projet contient les modules API, front-end, tests, migrations et documentation nécessaires à l'installation.

### Contrôles non exécutables dans cet environnement
Les tests d'intégration nécessitent une base PostgreSQL réelle. Aucun serveur PostgreSQL n'est disponible dans l'environnement de préparation et les dépendances npm n'ont pas pu être installées intégralement avant expiration du délai d'installation.

En conséquence, `npm test`, les tests licence/sécurité/RH/finance/restauration et les scénarios d'acceptation nécessitant PostgreSQL ne sont pas déclarés « verts » ici.

## Installation / validation finale

```bash
npm ci
cp .env.example .env
# renseigner DATABASE_URL et JWT_SECRET
npm run migrate
npm run setup -- admin "MotDePasseSolide1" "Ma station"
npm test
npm run test:security
npm run test:licenses
npm run test:payroll
npm run test:rhv2
npm run test:contracts
npm run test:client-account
npm run test:branding
npm run test:ui-shell
npm run test:restore
npm start
```

Ne jamais exécuter les tests sur la base de production.
