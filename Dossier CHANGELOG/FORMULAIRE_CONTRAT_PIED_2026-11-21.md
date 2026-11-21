# Formulaire contrat : boutons Enregistrer / Annuler / Initialiser hors écran

**Constat** (capture téléphone, 21/11/2026 01:11) : en bas de la fiche « Gérer client », les boutons ne sont pas accessibles.

**Cause** : le conteneur de la modale (`#m > div`, `max-height: 90vh`) reçoit `overflow: visible` (`public/ext-sectioned-form.js`, ligne 138). Quand l'en-tête, les packs et le corps dépassent la hauteur de la modale, le pied de formulaire déborde sous la zone visible et ne peut pas défiler. La modale est en position fixe : la page ne défile pas.

**Changement** (branche `fix/formulaire-contrat-pied-visible`, depuis origin/main (d0bf4a3)) : `box.style.overflow = 'auto'`. Le conteneur devient défilant et le pied reste atteignable.

**Vérification** : rendu hors site, avec `app.css` réel et la règle `.sf` extraite du fichier réel, en 390×844 avec un bandeau de 260 px.
- Avant (`visible`) : bouton « Enregistrer » à 970 px, hors écran, non atteignable.
- Après (`auto`) : après défilement du conteneur, bouton à 800 px, visible.

**Non vérifié** : rendu sur le site réel et sur le téléphone. Le site n'est pas joignable depuis le bac à sable.

**Restant** : push, PR et fusion à autoriser. Le service worker est régénéré (`node scripts/build-sw.js`).
