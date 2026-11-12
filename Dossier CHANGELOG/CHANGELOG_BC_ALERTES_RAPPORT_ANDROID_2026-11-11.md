# Changements 2026-11-11
- Rapport de quart : tableau « Produits vendus (boutique) », stock début/fin reconstitué pour les anciens quarts, récapitulatif des ventes par employé.
- Tableau de bord : comparaison ventes 7 j / 7 j précédents ; alertes écart de caisse, écart de stock, stock négatif.
- Boutons PDF / Excel sur toutes les interfaces à tableaux (ext-export-all.js, POST /api/docs/render-xlsx).
- Bon de commande : pièces jointes (photo/PDF du bon de livraison ou de la facture, migration 104), partage PDF (WhatsApp/e-mail via feuille de partage Android), scan code-barres.
- GET /api/mobile/alerts : stock bas, factures échues, échéances fiscales, quart resté ouvert (notifications de l'application Android).
- Dossier `android_a_copier` supprimé (obsolète) : remplacé par le projet Android Studio complet `android/ManagePro-Android` (même pont `AndroidBridge` que public/native-bridge.js). Voir android/ManagePro-Android/README.md.
- Application Android : logo Manager PRO (icône, démarrage, verrouillage, notifications) et nom « Manager PRO ».
