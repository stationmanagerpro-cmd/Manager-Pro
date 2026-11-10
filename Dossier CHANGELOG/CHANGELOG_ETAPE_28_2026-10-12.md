# Étape 28 — suspension du contrat et couleurs des rapports

## Correctif

Le moteur de documents récupérait le statut du contrat uniquement pour la route de réglage des couleurs, mais ne le vérifiait pas au moment de construire les exports. Ainsi, une palette déjà enregistrée pouvait encore être utilisée après suspension du contrat.

Le moteur de documents lit désormais `features` et `status` ensemble et n'applique les couleurs personnalisées que si le contrat n'est pas suspendu et si la fonctionnalité est autorisée. Dans le cas contraire, les couleurs standard sont utilisées. Les préférences sauvegardées ne sont pas supprimées : une réactivation contractuelle autorisée peut les rendre de nouveau disponibles.

## Tests ajoutés

- `test/step28-report-colors-suspension-static.js` vérifie le contrôle du statut suspendu, l'autorisation contractuelle, l'isolation client/plateforme et l'application des couleurs Excel.
- `test/step27-platform-report-colors-static.js` étendu pour vérifier le statut suspendu.

## Limites

Ce correctif a été vérifié statiquement. Il n'a pas été testé avec PostgreSQL, ni par génération réelle de PDF/Excel. Il n'a modifié aucune base de données et n'a provoqué aucun déploiement.
