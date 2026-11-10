# Mise à jour — demandes du 21/10/2026

## 1. Bon de commande fournisseur (comme la facture client)
- Déjà livré via `public/ext-purchase-order.js` (lignes dynamiques, + Ajouter une ligne, totaux).
- `app.js` : l’ancien formulaire fixe à 3 produits ne s’affiche plus ; `addPO()` délègue à `poNew()`.

## 2. Ouverture de quart — participants dynamiques
- Une seule ligne de participant par défaut (employé + rôle + pompe).
- Bouton **+ Ajouter un participant** pour ajouter des lignes à la demande.
- Envoi de `employee_ids`, `employee_roles` et `pump_assignments` (API déjà prête).

## 3. Historique des taux Mobile Money
- Chaque enregistrement des taux ajoute une entrée d’historique (max 50).
- Affiché dans l’interface **Commissions Mobile Money** sous « Historique des taux appliqués ».
- Endpoint optionnel : `GET /money/commission-rates/history`.

## 4. Images publicitaires — zone bas de page
- Plus de mini pop-up : les images s’affichent dans une **Zone PUB** en bas du tableau de bord.
- Ordre **aléatoire** à chaque chargement ; défilement automatique (défaut **60 s**, configurable 10–3600 s).
- Champ **Délai entre images (secondes)** dans la config Super Admin du panneau publicitaire client.
- Les publicités **texte** restent en bandeau classique en haut.

## 5. Profil toujours à droite
- CSS renforcé : le chip profil reste ancré à droite et lisible sur toutes les largeurs d’écran.
- La zone de recherche conserve sa place (passe sous la barre sur très petit écran, profil reste à droite).

## Fichiers modifiés
- `public/app.js`
- `public/ext-modern-pack.js`
- `public/ext-design.js`
- `public/ext-detail-pages.js`
- `public/design-v2.css`
- `public/ext-shell.css`
- `src/finance.js`
- `src/branding.js`
