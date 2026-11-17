'use strict';
// Rapport de clôture : rapprochement par jaugeage, drapeau « non vérifié », continuité des index (présents et reliés aux champs serveur).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
assert(app.includes('Rapprochement par jaugeage'), 'section rapprochement absente');
assert(app.includes('Écarts individuels non vérifiés par jaugeage'), 'drapeau non vérifié absent');
assert(app.includes('Continuité des index'), 'section continuité absente');
assert(app.includes('r.tank_check.dip_verified') && app.includes('r.counter_continuity'), 'champs serveur non reliés');
console.log('ok rapprochement-display');
