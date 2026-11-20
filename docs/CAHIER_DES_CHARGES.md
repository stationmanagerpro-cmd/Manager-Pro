# Cahier des charges — Station Manager Pro (référence)

Date de mise à jour : 2026-11-20. Ce document est un **index** : il ne recopie pas les règles, il indique où elles sont validées.
En cas de contradiction entre deux documents, ne pas trancher seul : le signaler (voir `docs/RECONCILIATION_CAHIERS_DES_CHARGES_2026-10-16.md`, qui fixe la règle appliquée jusqu'ici : solution la plus sûre pour un serveur PC local).

## 1. Objet
Application de gestion de stations-service : ventes et carburant, quarts et caisse, stocks et produits, achats, RH et paie, comptabilité OHADA, fiscalité, flotte, contrats clients, messagerie, alertes et sauvegardes. Plusieurs stations par compte client ; un superadmin plateforme.

## 2. Sources des règles validées (à consulter avant toute modification)
| Sujet | Document de référence |
|---|---|
| Priorités et dépendances | `docs/PRIORITES_DEV.md` |
| Réconciliation des cahiers | `docs/RECONCILIATION_CAHIERS_DES_CHARGES_2026-10-16.md` |
| Modules et interrupteurs | `docs/MATRICE_MODULES.md`, `Dossier CHANGELOG/INTERRUPTEURS_MODULES_CLIENT_2026-11-17.md` |
| Sécurité | `docs/SECURITY.md` |
| Migrations | `docs/MIGRATIONS_INDEX.md`, `docs/MIGRATIONS_NUMEROTATION.md` |
| RH et paie (Mali) | `docs/RH_PAIE_MALI.md`, `docs/RH_V2.md` |
| Comptabilité | `docs/COMPTABILITE_OHADA.md` |
| Contrats clients | `docs/CONTRATS_CLIENTS.md` |
| Messagerie | `docs/INTEGRATION_MESSAGERIE.md` |
| Hébergement PC | `docs/HEBERGEMENT_PC_WINDOWS_TAILSCALE_FUNNEL.md` |
| Design | `docs/DESIGN_V2.md`, `docs/PERSONNALISATION_COULEURS_RAPPORTS.md` |

## 3. Règles permanentes (rappel, à ne jamais affaiblir)
- Sécurité et intégrité financière avant l'apparence.
- Isolation stricte entre comptes clients et entre stations (un compte ne voit jamais les données d'un autre).
- Migrations livrées jamais réécrites ; chaque migration reste idempotente.
- Le superadmin n'a pas de station (`SID` null) ; l'accès aux vues est filtré côté serveur, pas seulement dans l'interface.
- Aucune opération destructive sans vérification préalable de ses conséquences et sans validation de l'utilisateur.
- Ne jamais livrer de fichier `.env` ni de secret.

## 4. Points validés récemment
- Bandeau d'accueil : photo de la station (si enregistrée) posée directement ; sinon photo par défaut Manager PRO, pleine largeur, nom du compte client (superadmin : nom du site).
- Menu latéral : pas d'animation au chargement.
- Bouton « Besoin d'aide » : dans le bandeau ; plus dans la barre d'en-tête.
- Aide : les cartes d'aide sont gérées depuis « Mon profil & aide » (superadmin : Modifier à vérifier, voir `docs/ETAT_ACTUEL.md`).

## 5. Décisions à valider par l'utilisateur
Voir `docs/ETAT_ACTUEL.md`, section « Questions ouvertes ».
