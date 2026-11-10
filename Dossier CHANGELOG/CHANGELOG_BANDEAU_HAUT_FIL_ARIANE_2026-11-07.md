# Bandeau en haut, heure sous le profil, fil d'Ariane cliquable (2026-11-07, rev35)

- Le bandeau (photo, logo, nom, slogan) s'affiche tout en haut de toutes les pages (grand sur le tableau de bord, plus bas ailleurs), au-dessus de la barre d'en-tête ; la ligne d'identité en double est masquée.
- L'heure quitte l'en-tête et descend sous le profil, à côté de la date (fil d'Ariane).
- Le bandeau ne se modifie plus que dans Administration → Paramètres → Apparence (bouton retiré du tableau de bord et de « Général ») ; le serveur exige `appearance.manage` pour `/station-banner` et la photo du bandeau.
- Fil d'Ariane : ⌂ (accueil), la rubrique (ouvre sa première page) et la page sont cliquables.
- Politique de mot de passe : minimum 8 caractères aussi pour les comptes ADMIN (rev34).
- Superadmin : même bandeau en haut de toutes ses pages, aux couleurs de la plateforme (nom, logo, slogan du site), sans photo (rev37).
- Superadmin : photo du bandeau réglable dans Identité de l'application (route /api/branding/banner, clé app_banner_path) (rev38).
