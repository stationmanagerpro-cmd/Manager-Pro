# Correctifs : test ui-shell, robustesse de `sadUsage`, cohérence du changelog de l'en-tête — 19 novembre 2026

Suite à la revue de la branche `refactor/en-tete-unique` (commit `b30b373`). Le refactor de l'en-tête lui-même n'a pas été modifié : aucun défaut n'y a été trouvé.

## 1. Test `test/ui-shell/ui-shell.test.js` en échec (sélecteur périmé)
- **Problème :** le test cliquait sur `.login-card button`. Le premier bouton de la carte de connexion est désormais le bouton « œil » du mot de passe (`#lpeye`, `public/app.js`), et non « Se connecter ». La première tentative de connexion ne faisait rien ; le test attendait en vain `#toast.show` et tombait en délai dépassé (30 s). Sans rapport avec l'en-tête.
- **Correction :** les 5 occurrences utilisent maintenant `.login-card button:has-text("Se connecter")`.
- **Fichier :** `test/ui-shell/ui-shell.test.js`.

## 2. `sadUsage` plante sur une réponse mal formée
- **Problème :** `public/ext-sa-dash.js` (`window.sadUsage`) appelait `d.clients.reduce(...)` sans vérifier la réponse de `/admin/platform/usage`. Avec une réponse vide, un tableau (`[]`) ou un ancien serveur, l'erreur « Cannot read properties of undefined (reading 'reduce') » interrompait l'écran Utilisation de la plateforme du Superadmin. Le simulateur d'API du test ui-shell renvoie `[]` pour ce point d'accès (il n'a pas été mis à jour lors de l'ajout de la route).
- **Correction :** après le chargement, la réponse est normalisée : objet attendu, sinon `{}` ; `clients`, `users`, `daily`, `views` forcés en tableaux ; `hours` en 24 zéros par défaut. L'écran s'affiche vide au lieu de planter.
- **Test :** le simulateur n'est volontairement pas complété (commentaire ajouté dans le test) : la réponse `[]` sert de cas « réponse mal formée » et vérifie l'absence d'erreur JavaScript.
- **Fichiers :** `public/ext-sa-dash.js`, `public/sw.js` (régénéré par `npm run build:sw`, cache `smp-static-bc1d8f6e9a1`).

## 3. Changelog de l'en-tête non conforme au code
- **Repli du bandeau :** la note « Bandeau : affichage initial » annonçait 2,5 s ; le CSS (`ext-skin-pro.css`, règle `heroPendingReveal`) et le test `banner-pending-static` utilisent 10 s. Le texte est corrigé : l'identité peut rester invisible jusqu'à 10 s si aucune décision de bandeau n'est prise. Le CSS n'est pas modifié.
- **Horloge :** la note de refonte disait l'horloge déplacée dans `#topbar-ctx`. Sous le skin « pro » (par défaut), `#live-clock` reste masqué (`display:none !important`) et l'heure est affichée dans le fil d'Ariane (`.skin-datepill`). Précision ajoutée ; aucun changement de comportement.
- **Fichier :** `Dossier CHANGELOG/CORRECTIFS_AUDIT_2026-11-18.md`.

## Vérifications
- `test/ui-shell/ui-shell.test.js` : 66 contrôles réussis, 0 échec, code de sortie 0 (avant : délai dépassé, puis 2 échecs dus à `sadUsage`).
- `sw-coherence-static` 8/8, `banner-pending-static` 5/5, `banner-static` 15, `besoin-aide-static` 14, `repo-hygiene-static` 7/7, `client-company-name-header-static` 10/10, `usage-report-static` OK, `client-usage-unit` 7.
- Non vérifié : suite complète `npm test` (environnement sans PostgreSQL) ; rendu sur téléphone réel.
- Non traité (à tester à la main) : à 860 px et moins sans grand bandeau, `#tenant-brand` est masqué (`ext-skin-pro.css`, ligne 131) et `#stsel` est caché pour une seule station : aucun nom d'entreprise visible dans ce cas.

## Retour arrière
Remplacer les fichiers par leur version précédente (aucune migration, aucune donnée touchée).
