# Corrections issues de la recette finale — 07/10/2026

## Causes racines identifiées

1. **Déconnexion après actualisation** : le jeton et la station courante étaient stockés dans `sessionStorage`. Une nouvelle session de page pouvait donc perdre l'authentification.
2. **Interfaces interdites visibles** : le shell filtrait surtout par permission brute et `go()` affichait un message d'accès refusé au lieu de rediriger vers une vue autorisée. Les restrictions de modules du contrat n'étaient pas reflétées partout dans le menu.
3. **`VM[k] is not a function` / Paramètres Client** : `settings_hub` était ajouté dans `V`, mais aucune fonction `VM.settings_hub` n'était enregistrée.
4. **Thème non personnel** : le thème clair/sombre était local à tout le navigateur et le thème de station pouvait l'écraser. Il n'existait pas de préférence de thème persistée par utilisateur.
5. **Gestion des utilisateurs** : le backend possédait déjà les routes de modification du profil/statut, mais l'interface ne proposait pas de formulaire complet pour les utiliser.
6. **Administrateur Principal** : la vue de gestion des utilisateurs exposait les comptes station et le centre de contrôle affichait encore des onglets stationnels qui ne correspondent pas au périmètre plateforme.

## Corrections

- Persistance du jeton/session courante dans `localStorage` avec suppression complète lors d'une expiration/401.
- Filtrage de navigation par permission **et par contrat/module**.
- Accès direct à une vue interdite : aucune page « Accès refusé » n'est rendue ; retour vers la première vue autorisée.
- `settings_hub` relié à `vParamHub`.
- Nouveau stockage `user_preferences` et permission `appearance.self` (migration 028).
- Thème personnel par utilisateur : mode, couleur principale, couleur secondaire ; sauvegardé côté serveur et conservé après actualisation.
- La personnalisation reste soumise au contrat (`can_access_personalization`) et au plafond de permission de la station.
- Personnalisation activée par défaut pour les contrats historiques qui n'avaient aucune valeur explicite pour cette fonctionnalité ; un `false` explicite reste inchangé.
- Ajout du réglage de personnalisation lors de la création/modification d'un client.
- Formulaire « Modifier l'utilisateur » : nom complet, fonction, actif/inactif.
- L'Administrateur Principal ne voit plus la gestion des employés/stations dans l'écran générique Utilisateurs et ne peut plus créer un utilisateur de station via cette route API.
- Le centre de contrôle Principal affiche les indicateurs de plateforme (clients, licences, expirations, suspensions, demandes de renouvellement) et masque les onglets stationnels interdits.

## Point de sécurité volontairement conservé

Le prompt maître et l'architecture existante définissent l'Administrateur Principal comme administrateur **de plateforme**, sans accès aux données métier privées des stations. La demande de recette qui voudrait lui donner un sélecteur permettant d'ouvrir ventes, caisse, finances, RH et stocks de chaque station entre en contradiction avec cette règle de sécurité. Cette élévation de périmètre n'a donc pas été introduite silencieusement.

Si une future décision produit confirme un accès de consultation du Principal aux données métier, il devra être conçu comme un mode explicitement audité (idéalement lecture seule), avec règles dédiées et tests d'isolation.

## Vérifications exécutées

- `node --check` sur tous les fichiers JavaScript `src/*.js` et `public/*.js` : **OK**.
- La suite `npm test` n'a pas pu être exécutée dans cet environnement car `node_modules` n'est pas installé (`dotenv` manquant). Aucun test DB n'est déclaré vert sur cette base.
