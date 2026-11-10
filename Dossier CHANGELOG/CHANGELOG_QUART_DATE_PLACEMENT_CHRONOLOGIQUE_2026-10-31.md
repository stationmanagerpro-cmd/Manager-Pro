# Ouverture de quart : date réelle + placement chronologique automatique — 31/10/2026

## Cause du « champ date absent »
`public/ext-core.js` redéfinit `openQ()` (modale avec affectation des employés aux pompes) et **remplace** la version de
`public/app.js` qui contenait déjà date/heure. La modale réellement affichée n'avait donc pas le champ.

## Interface (public/ext-core.js, public/responsive-v3.css)
- Champs **Date d'ouverture** (max = aujourd'hui) et **Heure d'ouverture** (défaut = maintenant).
- Modale **élargie** (classe `oq-wide`, jusqu'à 1080 px sur ordinateur, inchangée sur téléphone).
- Au changement de date/heure : appel `GET /shifts/placement?at=…` → message « inséré après le quart N° X et avant le quart N° Y »,
  alerte en cas de chevauchement, **index initiaux repris du quart précédent** si le quart s'insère dans l'historique.
- Confirmation si la date est antérieure ; futur refusé.

## Backend (src/shifts.js)
- `GET /shifts/placement` : quart précédent / suivant, chevauchement, index du quart précédent.
- **Ouverture** : refus si chevauchement d'un quart clôturé ; pour un quart *inséré* (un quart plus récent existe) :
  - `pump_counters.current_index` n'est plus écrasé ; écart d'index contrôlé vs la clôture du quart précédent ; index initial ≤ index initial du quart suivant ;
  - pas de recalage du solde courant de la caisse ;
  - stock d'ouverture reconstitué (clôture du quart précédent, sinon stock actuel − mouvements des quarts plus récents).
- **Clôture** d'un quart non récent : date/heure de clôture obligatoire et ≤ ouverture du quart suivant ; index final ≤ index initial du suivant ;
  caisse théorique = caisse initiale + mouvements du quart ; stock théorique = stock d'ouverture + mouvements du quart ; index courant inchangé.
- Écritures générées à l'ouverture/clôture (caisse, stock, paiements, mouvements d'argent) **horodatées à la date réelle** du quart passé.
- `shift_date` locale du client retenue si cohérente avec `opened_at` ; audit enrichi (quart précédent/suivant, `inserted_in_history`).
- Listes de quarts triées par `opened_at`, rapports financiers lus par `opened_at, number`.

## Décision de conception
Le **N° de quart reste un identifiant immuable** (ordre de création) : il figure dans les rapports PDF, e-mails, audits déjà émis.
L'ordre métier est porté par la date. Une renumérotation chronologique est possible mais modifierait des références déjà imprimées.

## Limites connues
- Un seul quart ouvert à la fois par station (inchangé) : clôturer le quart en cours avant de saisir un quart passé.
- Les réceptions / achats non rattachés à un quart ne sont pas redatés.
- Test d'intégration avec base PostgreSQL non exécuté dans cet environnement ; contrôles statiques : `npm run test:shift-chronology`.

## Fichiers modifiés
`public/ext-core.js`, `public/responsive-v3.css`, `src/shifts.js`, `src/finance.js`, `package.json`, `test/shift-chronology-static.js`
