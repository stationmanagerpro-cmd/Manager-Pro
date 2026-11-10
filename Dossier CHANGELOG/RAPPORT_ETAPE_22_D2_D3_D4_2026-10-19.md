# Station Manager Pro V1 — Étape 22 (19/10/2026)

## Fiches traitées

### D2 — Animations modernes et fluides, adaptées à la performance
- Remplacement du bloc qui supprimait globalement tous les effets par trois niveaux configurables : `off`, `subtle` et `full`.
- Ajout d'un panneau « Animations et effets visuels » dans « Ma fiche ».
- La préférence est enregistrée par utilisateur dans `user_preferences` sous la clé `motion`, via `GET/PUT /api/me/preferences/motion`.
- Les effets restent limités aux transitions courtes de `transform`, `box-shadow`, couleurs et soulèvement/zoom léger au survol.
- Aucun compteur animé, aucun effet de scintillement ou boucle JavaScript ajoutée. Les indicateurs de chargement animés sont désactivés.
- `prefers-reduced-motion: reduce` prime sur le réglage enregistré.
- Cache PWA incrémenté de `smp-static-v9` à `smp-static-v10`.

### D3 — Page d'accueil
- Titre principal avec graisse renforcée, taille responsive et dégradé discret.
- Contenu, textes et boutons centrés par défaut.
- Évite d'afficher deux fois le même slogan lorsque sous-titre et slogan sont identiques.

### D4 — Bouton « Se connecter » et clé d'accès : vérification de l'existant
- Les deux boutons appellent déjà le même flux `homeLogin()`.
- Si la politique l'exige, l'écran demande une clé à quatre chiffres, la valide par `/api/public/access/verify` et affiche clairement les erreurs.
- Le serveur revérifie aussi la clé lors de la connexion. Aucun changement fonctionnel n'était nécessaire pour cette fiche lors de cette étape.

## Tests réalisés
- `node --check` : `src/auth.js`, `public/ext-ux-v2.js`, `public/ext-core.js`, `public/app.js`, `public/ext-home.js`, `public/sw.js` — réussis.
- `node test/performance-motion-static.js` — 12/12.
- `node test/homepage-centering-static.js` — 6/6.
- `node test/home-login-key-static.js` — 6/6.
- `node test/access-keys-unit.js` — 8/8.
- `node test/step18-expired-subscription-screen-static.js` — 12/12.
- `node test/messaging-support-title-static.js` — 10/10.
- `node test/messaging-unread-notifications-static.js` — 13/13.
- `node test/messaging-recipient-search-static.js` — 10/10.
- `node test/messaging-dark-mode-static.js` — 9/9.
- `node test/messaging-superadmin-contact-role-static.js` — 9/9.
- `node test/roles-messaging-static.js` — 10/10.
- `package.json` valide.

## Limites connues
Les tests sont des vérifications statiques/unitaires ; aucun test navigateur automatisé, mesure réelle des performances, ni validation avec PostgreSQL de production n'a été effectué. La préférence s'appuie sur la table `user_preferences` créée par la migration 028, laquelle doit être présente dans la base installée.
