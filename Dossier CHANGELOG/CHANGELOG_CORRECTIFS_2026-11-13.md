# Correctifs du 13/11/2026
1. Éditeur d'accueil (Super Admin) : croix ✕ de fermeture des panneaux Éléments / Propriétés sur petit écran ; toucher l'aperçu les ferme aussi.
2. Vue par station : cartes réorganisées (2 colonnes, chiffres sans coupure, logo/nom en tête) sur tablette et téléphone.
3. Éditeur « À propos » : boutons aux couleurs du thème du compte (suppression rouge/gris figés).
4. Thème personnel : erreur 429 — relance automatique après pause, message clair, sélecteurs de couleur visibles (pastille), plafond par utilisateur 600/min, flux messagerie et lecture des préférences exclus du plafond.
5. Rôles : le Super Admin ne définit plus que le rôle Administrateur local (API 403 sinon). L'administrateur local gère ses rôles dans « Rôles de mon équipe » : création, permissions, attribution individuelle (fiche employé) et **en groupe** (nouveau POST /admin/roles/:code/assign).
6. Exports : plus d'export générique (lié aux stations) chez le Super Admin ; export PDF/Excel branché sur les rapports plateforme uniquement dans « Clients » (licences) ; Finance plateforme garde ses rapports.

## Complément 429 (14/11/2026)
- Plafond par IP : les requêtes portant un jeton valide n'y sont plus comptées (seul le plafond par utilisateur s'applique) — derrière l'hébergeur, plusieurs utilisateurs partagent la même IP vue par le serveur et se bloquaient entre eux.
- Journal serveur « [rate-limit] ip|user … bloqué sur MÉTHODE /route » (une ligne/min/clé) pour identifier la cause réelle.
- Le message 429 affiché indique le nombre de requêtes de l'écran dans la dernière minute et la route la plus appelée.
- Messagerie temps réel : reconnexions espacées (5 s → 60 s) si le flux se ferme en moins de 15 s, au lieu d'une tentative toutes les 3 s.
