'use strict';
const fs = require('fs');
const assert = require('assert');
const source = fs.readFileSync('public/ext-core.js', 'utf8');
assert(source.includes('Diagramme des ventes par produit'), 'le profil RH doit afficher le diagramme des ventes par produit');
assert(source.includes("type: 'bar'"), 'le diagramme doit utiliser un graphique en barres');
assert(source.includes('products.map(x => Number(x.amount || 0))'), 'les montants du diagramme doivent provenir des résultats de performance');
// Depuis P-02 (Chart.js à la demande) : le dessin passe par chartTask, qui ne s'exécute que si Chart.js est chargé.
// Sans Chart.js, rien n'est dessiné et le reste du profil reste affiché.
assert(source.includes('chartTask(() => {'), 'le dessin doit passer par chartTask (Chart.js à la demande)');
assert(source.includes('if (!canvas) return;'), 'le dessin doit ignorer un canvas absent');
assert(source.includes('Aucune donnée produit pour cette période.'), 'un état vide doit être affiché sans données');
console.log('Étape 55 — diagramme de performance employé : 5 contrôles réussis.');
