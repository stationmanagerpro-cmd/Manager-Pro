# Correctifs 2026-10-31 — Paie, Comptabilité, Vendeurs & commissions

## 1. Bulletin de paie : ligne commission sans libellé
- `src/hr.js` (PDF du bulletin) : le tableau « Gains » n'affichait que salaire de base, primes et indemnités ;
  la commission était comptée dans le Brut mais sans ligne. Ajout des lignes « Commission » / « Prime vendeur »
  (libellé « Commission sur vente », période en colonne Base/Taux), avec repli sur `gross_detail`
  pour les anciens bulletins, et ligne « Heures supplémentaires » si applicable.
- Les bulletins déjà générés se corrigent en ré-exportant le PDF (aucune donnée modifiée).

## 2. Comptabilité > Exercices > « Nouvel exercice » → « Erreur interne »
- Cause : `src/accounting.js` appelait `body(schema, req)` alors que `core.body` est un middleware Express ;
  les données saisies n'étaient jamais lues (valeurs nulles à l'INSERT → erreur 500).
- Correctif : validateur local `body(schema, req)` (zod, erreur 400 lisible). Corrige aussi la création/modification
  de compte, la saisie et l'annulation d'écritures, les immobilisations, la clôture et la réouverture d'exercice.

## 3. Vendeurs & commissions : Prime, Régler, ⚙, Rapport collectif
- Cause : `JSON.stringify(nom)` insérait des guillemets doubles dans `onclick="..."`, ce qui cassait l'attribut.
  Les boutons ne transmettent plus que l'identifiant ; les données viennent d'un cache interne.
- « Rapport collectif » : génère maintenant un rapport imprimable / PDF (KPI + tableau + totaux).
- En-tête du fichier corrompu (bloc « Mode de calcul » collé dans le commentaire) : restauré, et le sélecteur
  « Mode de calcul » est de nouveau présent dans l'onglet Paramétrage.

Aucune migration. Redémarrer le serveur et vider le cache du navigateur (Ctrl+F5).

## 4. Nom du site agrandi dans le menu de gauche
- `public/responsive-v3.css` + `public/ext-shell.js` : nom en 26 px gras (auto-réduit si le mot le plus long ne tient pas),
  retour à la ligne possible entre les mots, slogan réduit à 11 px.

## 5. Rapports des nouveaux modules : même identité que les rapports historiques
- Constat : Comptabilité, Trésorerie et Vendeurs & commissions imprimaient une page HTML générique (sans logo, coordonnées,
  pied de page ni signatures). Fiscalité utilisait déjà le moteur commun.
- Nouveau `src/docs_render.js` (`POST /api/docs/render`, monté dans `server.js`) : applique `docs.branding` + `docs.buildPdf`
  (logo et coordonnées de la station, couleurs de rapport du client, pied de page configuré, signature imposée/personnalisée,
  cases de validation, numérotation des pages).
- Nouveau `public/ext-branded-pdf.js` : `brandedPdf()` / `brandedPdfFromHtml()` (conversion titres, tableaux, indicateurs en sections).
- Branché sur : Comptabilité (`accPrint` : balance, compte de résultat, bilan…), Trésorerie (rapport de trésorerie,
  état des créances et dettes), Vendeurs & commissions (rapport collectif).
- Fiscalité : vérifiée, ses PDF utilisent déjà le moteur commun (logo, signatures) ; aucune modification.
- `public/index.html` et `public/sw.js` (cache v81) mis à jour : faire Ctrl+F5 après déploiement.

## 6. Rapport client & marges : « Exporter en PDF »
- `src/profitability.js` : valeurs normalisées avant le moteur PDF (pas d'objet, NaN ni ligne trop courte),
  cases de signature ajoutées, et en cas d'échec le message d'erreur réel est renvoyé et journalisé
  (`[client-profit] génération PDF impossible`) au lieu de « Erreur interne ».
