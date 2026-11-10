# CORR-050 — Tous les formulaires au design « Pro » (2026-11-07)

## Demande
« Tous les formulaires de saisie comme le formulaire de vente, sans exception » + règle employé / pompe / quart + suivi de la réalisation totale.

## Règle métier employé / pompe / quart (vérifiée, aucun changement de code)
- L'employé n'est choisi qu'à l'ouverture du quart ; chaque employé y est rattaché à 1 pompe ou plus.
- En vente, choisir la pompe renseigne automatiquement l'employé responsable ; une vente avec un autre employé est refusée (409).
- À la clôture, l'argent remis par chaque employé fixe ses écarts séparément ; recettes, dettes et écarts restent rattachés à son historique (/hr/employees/:id/…).
- Preuve : scénario sur PostgreSQL réel, quart partagé par 2 employés.

## Changements
- public/ext-skin-pro.js / .css : habillage commun appliqué à toute fenêtre (modal/form) et aux champs intégrés aux pages : en-tête avec icône, champs en cartes, boutons Annuler / Enregistrer.
- Formulaire « vente produit » refait (employé = équipe du quart, récapitulatif, paiements).
- Écran de connexion au même style.
- Bandeau/slogan ajustés ; cache du service worker v99.

## Mesures
- Parcours automatique : 56/56 fenêtres ouvertes conformes, 17/17 pages à champs intégrés stylées, 0 erreur JS.
- 23 boutons n'ouvrent pas de fenêtre (navigation ou droit requis) : non mesurés.
- contrast-audit : 3744 mesures OK ; test skin-pro 20/20 ; suite 176/191 (15 non concluants : comptes, base de test, navigateur requis).

## Limites
Autres navigateurs non essayés ; écrans réservés à user.manage/superadmin non ouverts un par un.
