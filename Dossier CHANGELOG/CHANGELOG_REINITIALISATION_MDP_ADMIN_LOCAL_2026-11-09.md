# Réinitialisation du mot de passe de l'administrateur local (2026-11-09)

- Profil du compte client (Super Admin) : nouveau bouton **Réinitialiser le mot de passe**, visible uniquement sur le compte de rôle **Administrateur local** et s'il est actif. Les autres comptes du client ne sont pas concernés.
- Fenêtre de confirmation : motif (3 caractères minimum) + mot de passe du Super Admin connecté. Le mot de passe temporaire est affiché **une seule fois** (copie possible), jamais journalisé.
- Effets : toutes les sessions du compte sont fermées, le verrouillage de connexion est levé, l'opération est inscrite au journal d'audit (motif, sans mot de passe).
- Nouvelle route `POST /admin/clients/:id/users/:userId/reset-password` (Super Admin uniquement ; refus si le compte n'est pas ADMIN, est global, est désactivé ou n'appartient pas à ce client).
- Fichiers : src/contracts.js, public/ext-detail-pages.js, public/sw.js (cache v111), test/client-admin-reset-password-static.js, package.json (`npm run test:client-admin-reset`).

## Complément — périmètre du Superadmin limité à l'administrateur local
- Fiche client (Super Admin) : l'onglet *Utilisateurs* n'affiche plus que les **administrateurs locaux** (`GET /admin/clients/:id/users` filtre sur le rôle ADMIN). Gérant, comptable, caissier, pompiste… n'apparaissent plus et leur profil n'est plus accessible.
- Suppression du bouton « Nommer administrateur local » (promotion d'un autre compte) dans la fiche du compte client.
- Garde-fou serveur `assertSuperadminScope` (src/roles_scope.js) : le Superadmin ne peut plus modifier le rôle, activer/désactiver, modifier le profil ni débloquer un compte client qui n'est pas ADMIN (routes `/users/:id/role`, `/active`, `/profile`, `/unlock`). Les comptes de plateforme restent dans son périmètre.
- Le premier administrateur local reste créé avec le client ; les autres rôles et administrateurs sont nommés par l'administrateur local.
- Tests : test/client-admin-reset-password-static.js (11 contrôles). Les échecs de my-profile-static.js et shift-attribution-static.js existaient déjà dans l'archive d'origine.

## Complément — administrateur local de secours
- Fiche client, onglet *Utilisateurs* : bouton **Créer un administrateur local de secours** (compte perdu, départ de l'administrateur…).
- Crée un **nouveau** compte de rôle ADMIN pour le client ; aucun compte existant (gérant, pompiste…) n'est promu. Rattaché aux stations actives du client ; devient propriétaire du compte client seulement si l'ancien propriétaire n'est plus actif.
- Garde-fous : Super Admin uniquement, motif (3 caractères minimum) + mot de passe du Super Admin, limite `max_users` du contrat respectée, identifiant unique, audit (sans mot de passe). Mot de passe temporaire affiché une seule fois.
- Route : `POST /admin/clients/:id/rescue-admin`. Tests : test/client-admin-reset-password-static.js (16 contrôles).
