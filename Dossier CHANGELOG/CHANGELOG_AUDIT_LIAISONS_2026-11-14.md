# Audit des liaisons écrans ↔ sources (14/11/2026)
Résultat : 926 appels du front reliés à 788 routes serveur ; aucun appel sans route. 12 routes n'avaient pas d'écran ; 
- **Branchées** : plafonds de droits par station (Super Admin, via fiche client → « Plafonds de droits »), droits de diffusion des messages (menu Administration), contrôles financiers (intégrité des caisses, événements du mois, historique des taux — menu Finance), solde fidélité affiché en saisie dans les formulaires de vente, écritures de commission vendeur avec annulation (onglet Primes).
- **API seule, documentées** (test `links-audit`) : durées de licence prédéfinies, préférences d'export, mouvements d'un compte, scan des échéances fiscales, correction d'index d'un compteur par PUT, lecture/archivage unitaire de message (historique), plus routes externes (pages publiques, Android, terminal carte).
- Nouveau garde-fou `npm run test:links-audit` : échoue si un écran appelle une route inexistante ou si une nouvelle route n'a aucun écran.
- Fraîcheur : /api jamais mis en cache (réseau seul) ; sw.js porte l'empreinte du contenu → chaque déploiement déclenche la bannière « Recharger ».
