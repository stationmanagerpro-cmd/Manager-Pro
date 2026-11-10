# Étape 30 — Partie 2 (13 oct. 2026)

## Corrections

### Point 1 — Fiche complète (historique de quart)
- `public/ext-p7.js` : validation de l’ID, toast « Chargement… », gestion d’erreur existante conservée.
- Parcours API `GET /shifts/:id/full` inchangé (déjà complet : équipe, compteurs, paiements, dépenses, anomalies, avances, observations).

### Corriger index (pompes)
- **Cause racine** : `JSON.stringify(productName)` dans un `onclick="..."` en double quotes cassait le HTML dès qu’un nom de produit contenait des guillemets → bouton mort.
- Correction : arguments numériques uniquement (`pumpId`, `counterNumber`, `currentIndex`) ; libellé produit relu depuis `window.PU`.
- Validation motif ≥ 3 caractères côté UI avant l’API.
- Toast distinct pour avertissement « quart ouvert ».

### Point 9 — Photo / logo station (Administration)
- Bouton explicite « Changer le logo de la station » dans l’onglet Station du centre d’admin (`ext-p12.js`).
- `pickImage` exposé sur `window` pour les appels depuis le hub.
- API `PUT /images/stations/:id` + `files.save` (PNG/JPEG, 2 Mo) déjà en place.

### Points 2 / 4 / 6 / 12 — Messagerie & alertes (messages / commentaires)
- Message « fonctionnalité désactivée » mis à jour : nouveaux contrats **actifs par défaut** ; Super Admin peut désactiver.
- Commentaire UI messagerie aligné.
- Dédup Scanner déjà livrée en Partie 1.
- Scheduler `sendSystemAlert` conserve la dédup 24 h.

## Fichiers modifiés
- public/app.js
- public/ext-p7.js
- public/ext-p12.js
- public/ext-core.js
- public/ext-messaging.js
- src/messaging.js

## Non inclus (Partie 3+)
- Multistation UI dédiée client (P3/P13)
- Menus horizontaux (P7)
- PDF situation client (P8)
- Branding login accessibilité SA (P10) — code présent, à vérifier en runtime
- Activation env restore/reset
