# Allègement du 14/11/2026
Audit : tous les fichiers de public/ (124) et de src/ (100) sont référencés (index.html, require() depuis server.js, scripts npm) ; aucun fichier vide ni doublon exact. Aucun code fonctionnel supprimé.
- Image d'accueil par défaut : home-default-hero.png (1,7 Mo) remplacée par home-default-hero.webp (165 Ko), même rendu ; référence mise à jour dans home-core.js.
- .dockerignore : docs, Dossier CHANGELOG, test, scripts/windows et fichiers .md exclus de l'image de production (aucun n'est lu à l'exécution).
- sw.js régénéré.
- Non touchés : APK (15 Mo) et manuel PDF (12 Mo), servis seulement au téléchargement ; compression gzip déjà assurée par l'hébergeur.
