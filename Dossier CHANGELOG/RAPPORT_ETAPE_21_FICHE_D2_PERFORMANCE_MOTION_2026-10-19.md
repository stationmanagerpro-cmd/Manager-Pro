# Rapport — Étape 21 — Fiche D2 : navigation sans animations coûteuses

Date : 2026-10-19

## Décision de conception
Le cahier des charges propose des animations modernes dans toute la navigation. Conformément à la contrainte prioritaire de l'utilisateur, l'étape privilégie la réactivité : aucun mouvement décoratif, aucune transition CSS, aucun compteur animé ni effet de chargement animé. Les changements d'état restent immédiats.

## Modifications
- `public/performance-motion.css` : désactivation globale des animations et transitions CSS, du défilement fluide et des déplacements décoratifs au survol ; règle explicite pour `prefers-reduced-motion: reduce`.
- `public/index.html` : charge cette feuille après les feuilles de style principales pour que la politique performance prévale.
- `public/sw.js` : ajoute la feuille au précache et incrémente la version du cache de `smp-static-v7` à `smp-static-v8`.
- `test/performance-motion-static.js` : neuf vérifications statiques de la politique de mouvement et de son chargement.
- `package.json` : ajoute la commande `test:performance-motion`.

## Tests exécutés
- `node --check public/sw.js` : réussi.
- `node --check test/performance-motion-static.js` : réussi.
- `node test/performance-motion-static.js` : 9/9.
- `node test/kpi-icons-d1-static.js` : 8/8.
- `node test/messaging-support-title-static.js` : 10/10.
- `node test/messaging-superadmin-contact-role-static.js` : 9/9.
- `node test/messaging-unread-notifications-static.js` : 13/13.
- `node test/messaging-recipient-search-static.js` : 10/10.
- `node test/messaging-dark-mode-static.js` : 9/9.
- `node test/messaging-attachment-security-static.js` : 7/7.
- `node test/fiscal-access-c1-static.js` : réussi.

## Limites
Tests statiques et syntaxiques uniquement. Aucun test de performance en navigateur, sur téléphone ou avec PostgreSQL réel n'a été effectué. Les transformations fonctionnelles (par exemple montrer/cacher un panneau) restent possibles mais sans transition animée.
