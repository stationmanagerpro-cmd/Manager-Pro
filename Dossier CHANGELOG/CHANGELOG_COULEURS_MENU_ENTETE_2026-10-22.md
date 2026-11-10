# Couleurs personnalisables du menu de gauche et de l'en-tête (22/10/2026)

## Où les régler
- **Administrateur de la station** (permission « Apparence ») : *Administration → Paramètres → Apparence → « Couleurs du menu et de l'en-tête »*. S'applique à tous les utilisateurs de la station.
- **Tout utilisateur, Super Admin compris** : menu du profil (en haut à droite) → *🎨 Couleurs du menu*. S'applique à son seul affichage et remplace la couleur de la station.
- Priorité : couleur personnelle > couleur de la station > bleu par défaut.

## Détails
- Deux couleurs indépendantes : menu de gauche et en-tête (bande du nom du compte client + barre d'outils). Case décochée = couleur par défaut.
- Texte blanc conservé : une couleur trop claire est refusée (contraste 4,5:1), côté interface et côté serveur.
- API : paramètre `nav_colors` (`PUT /settings/nav_colors`, lu via `GET /appearance`) ; `GET/PUT/DELETE /me/preferences/nav-colors`.
- CSS : `--nav-bg` (menu) et `--hd-bg` (en-tête) avec repli sur `--sb-bg` : l'apparence par défaut est inchangée.
- Aucune migration : la table `user_preferences` et la table `settings` existantes sont utilisées. Cache PWA : `smp-static-v21`.

## Test
`node test/nav-colors-static.js`
