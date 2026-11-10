# Rapport Étape 30 — Fiche B4 : cloche et messages non lus

La fiche B4 est corrigée au niveau du code interface : le clic sur la cloche ouvre maintenant une liste des messages non lus plutôt que de rediriger les comptes clients vers les alertes générales. Le Superadmin conserve aussi la liste des demandes de renouvellement, séparée des messages de support.

La liste utilise l'API `/messaging/unread` existante, échappe les données affichées et ouvre la conversation sélectionnée. L'API garde ses filtres d'appartenance et d'isolation client.

Vérifications : syntaxe JavaScript OK ; test ciblé 8/8 ; notifications non lues 13/13 ; titres support 10/10.

Statut : correction et tests statiques réussis. Non certifié en navigateur ni par intégration PostgreSQL. Ne pas considérer la recette B4 comme terminée avant un essai connecté avec plusieurs rôles et deux clients isolés.
