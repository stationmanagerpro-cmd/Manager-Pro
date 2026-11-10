# CORR-052 — Grand bandeau d'accueil personnalisable (2026-11-07)

## Demande
Photo de bandeau personnalisable par le client depuis son interface ; nom de la station en gros caractères avec slogan et titre personnalisés ; le nom doit rester lisible sur chaque photo, sinon le client est signalé.

## Réalisé
- **Bandeau géant** en haut du tableau de bord : photo de la station, nom en grands caractères (taille adaptée à la longueur), slogan, bouton « Accéder aux ventes ». Sans photo : dégradé aux couleurs de la station (toujours lisible). Fonctionne dans les deux designs, mode sombre et mobile.
- **Fenêtre « Personnaliser le bandeau »** (tableau de bord ou Paramètres station → Général) : photo (redimensionnée à 1920 px, JPEG < 1,8 Mo), titre (vide = nom officiel), slogan, position du texte (gauche/centre/droite), couleur (blanc/noir), assombrissement, aperçu en direct.
- **Contrôle de lisibilité** : contraste mesuré sur la zone du texte (pire cas sur deux formats de bandeau), seuil 4,5 : 1. Bouton « Optimiser automatiquement » (choisit couleur, assombrissement et au besoin la position). Réglage automatique appliqué dès le choix de la photo.
- **Blocage si illisible (décision du 07/11)** : message orange ; le bouton Enregistrer est désactivé (« Corrigez la lisibilité pour enregistrer ») ; le serveur refuse aussi un verdict « warn » (HTTP 422). Seul un réglage lisible s'enregistre. (L'étiquette « ⚠ Nom difficile à lire » ne concerne plus que d'éventuels cas hérités.)
- Base : migration `099_station_banner_style.sql` (banner_title, banner_style, banner_legibility, banner_checked_at). Route `PUT /api/station-banner` (settings.edit ou appearance.manage, validée zod strict, auditée). Nom et slogan échappés à l'affichage.
- Manuel : chapitre 30 réécrit pour le bandeau ; manuel 80 pages.
- Cache hors ligne v101 ; fichiers ext-banner.css/js ajoutés.

## Vérifications
Chromium + PostgreSQL réel : 4 photos (claire, sombre, damier, colorée) → verdicts corrects ; réglage défavorable → enregistrement bloqué (bouton désactivé, API refuse en 422), réactivé après optimisation ; retrait de photo → marquage effacé ; titre de 58 caractères sans coupure ; mobile sans débordement ; mode sombre ; design classique ; 0 erreur JS. Tests : banner-static 8, skin-pro 20, offline-sales 9, demo-mode 10/10, contraste 3936 mesures OK.

## Limites
Mesure faite dans le navigateur du client (le serveur enregistre le verdict reçu, il ne recalcule pas). La lisibilité réelle dépend aussi de la taille d'écran : deux formats sont testés. Un client techniquement habile peut contourner le contrôle (mesure côté navigateur) ; le serveur refuse seulement un verdict « warn » déclaré.
