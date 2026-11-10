# Station Manager Pro — intégration marge, rapport client, calculatrice et A1

Date : 23 octobre 2026

## Contenu intégré

- Calculatrice flottante disponible après connexion, raccourci `Alt+C`, fermeture par `Échap`, calculs avec `+ − × ÷`, parenthèses et pourcentages, copie et insertion du résultat dans le dernier champ utilisé. L'historique reste en mémoire de session et n'est pas conservé après déconnexion.
- Rapport « Rapport client & marges » avec période personnalisable, regroupement, marge brute, taux de marge et résultat de gestion, ainsi que des exports PDF/XLSX/CSV selon les droits et le contrat.
- Source commune des indicateurs de rentabilité, raccordement des estimations fiscales aux ventes/compteurs et à la vraie table de paie `payslips`.
- Contrôles A1 de sécurité des sauvegardes et migrations.
- Conservation du système d'identification des appareils clients et de ses routes Superadmin.
- Aucun nouveau fichier de migration SQL n'a été ajouté par le module marge/calculatrice.

## Installation prudente

1. Arrêter Station Manager Pro.
2. Faire une copie complète du dossier du projet avant de remplacer des fichiers. Conserver séparément les sauvegardes de la base de données.
3. Extraire cette archive **dans le dossier racine du projet**, celui qui contient `package.json`, et accepter le remplacement des fichiers existants.
4. Cette archive ne contient volontairement ni `.env`, ni `node_modules`, ni dépôt `.git`. Le fichier `.env` déjà présent sur le PC doit rester en place. Ne jamais remplacer votre configuration locale par `.env.pc.example` sans l'adapter.
5. Dans CMD, depuis le dossier du projet, exécuter `npm install` si nécessaire.

## Contrôles disponibles

```bat
npm run test:marge-calculatrice
npm run test:a1
node test/device-registry-static.js
```

Ces tests statiques/unitaires vérifient les règles de calcul de la calculatrice, les branchements de l'interface, les garde-fous de migration/sauvegarde et des éléments statiques du registre d'appareils.

## Limites de validation

Les tests ci-dessus ont été exécutés pendant la préparation de cette archive et ont réussi. Cela ne prouve pas encore que les requêtes SQL du rapport fonctionnent sur votre base réelle ni que tous les exports PDF/XLSX/CSV s'affichent correctement dans votre environnement. La restauration réelle sur PostgreSQL local et la validation A1 sur votre PC restent à faire.

**Aucune migration n'a été lancée sur une base réelle, aucune restauration de base n'a été effectuée et aucun déploiement n'a été lancé.** Ne lancez pas le test destructif de restauration avec une URL Neon, Render ou une base contenant vos données de production.
