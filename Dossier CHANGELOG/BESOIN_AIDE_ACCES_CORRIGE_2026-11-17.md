# Besoin d'aide : vue inaccessible, bouton d'en-tête retiré, accès superadmin — 17 novembre 2026

## Cause du clic sans effet
- `public/app.js` : `GLOBAL_ONLY_VIEWS` est un alias de `SUPERADMIN_VIEWS` (même objet).
- En ajoutant `besoin_aide` à `SUPERADMIN_VIEWS`, la vue est devenue réservée à la plateforme : `canView` la refusait aux comptes clients.
- `go()` renvoyait alors vers le tableau de bord. Le clic ne faisait donc rien, visuellement.
- Côté superadmin, la liste des modules filtrait avec `canView`, qui refuse ces modules au superadmin : aucune carte, donc aucun bouton « Modifier ».

## Corrections
- `public/app.js` (`canView`) : `besoin_aide` est accessible à tout compte connecté, sans passer par `SUPERADMIN_VIEWS`.
- `public/ext-help.js` : la liste des modules est affichée à tous les modules existants pour le superadmin (sinon `canView` pour les clients).
- Bouton « Besoin d'aide ? » retiré de l'en-tête (`public/index.html`) et son code de rétablissement supprimé (`public/ext-help.js`).
- Menu : « Mon profil & aide » contient « Besoin d'aide » pour les clients, et pour le superadmin (nouveau groupe `SA_TREE`, `public/ext-shell.js`).
- Test `test/besoin-aide-static.js` : 14 contrôles, dont l'absence de bouton d'en-tête et l'accès des clients à la vue.
- Service worker régénéré.

## Non vérifié
- Affichage réel dans le navigateur et dans l'APK (pas de serveur disponible ici). La cause a été identifiée par lecture du code : à contrôler après déploiement.
- Pour le superadmin : le bouton « Modifier » n'apparaît que si le serveur renvoie `is_superadmin` (route `/api/help-guides`).
