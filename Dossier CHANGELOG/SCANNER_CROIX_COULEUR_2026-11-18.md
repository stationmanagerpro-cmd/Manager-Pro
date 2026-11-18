# Application Android — bouton Scanner et sa croix

**Demande :** la croix pour réduire le bouton Scanner doit être posée sur son haut et respecter la couleur du système.

**Constat :** la croix (`scan_close`) et l'exclusion de l'écran de connexion existent déjà dans les sources (commit 9864994, 15 nov.) et dans l'APK publiée du 17 nov. La capture montre un téléphone avec une version plus ancienne (pas de croix, bouton sur la connexion) : il faut installer la dernière APK.

**Changement :** couleur de marque (`@color/brand`, #1D4ED8) pour la croix (`drawable/scan_close_bg.xml`) et le bouton Scanner (`layout/activity_main.xml`, fond et texte). Le bouton n'était pas à la couleur de la charte (violet par défaut).

**Vérifications :** XML bien formés (analyse). **Non vérifié :** compilation et rendu — aucun SDK Android dans l'environnement.

**Statut :** branche `fix/scanner-flottant-reduire`, PR à ouvrir, non fusionnée, APK non recompilée.
