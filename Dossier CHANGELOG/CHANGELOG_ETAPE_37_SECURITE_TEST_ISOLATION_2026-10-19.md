# Étape 37 — Sécurisation du test d'isolation multi-clients

- Les identifiants et mots de passe de test sont désormais lus depuis des variables d'environnement plutôt que des arguments de ligne de commande.
- Ajout de vérifications HTTP négatives : `/me` sans jeton et avec jeton invalide doivent retourner HTTP 401.
- Documentation clarifiée : les données métier ne sont pas modifiées, mais les connexions réussies créent des sessions et des journaux d'audit, et une tentative incorrecte peut mettre à jour les compteurs d'échec/verrouillage.
- Le script continue à refuser les hôtes API non locaux et les identifiants de stations identiques.
