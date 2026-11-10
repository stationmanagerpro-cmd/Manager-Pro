// Test de bout en bout : node test/smoke.js <login> <motdepasse>   (serveur lancé, base initialisée)
const assert = require('node:assert');
const BASE = process.env.API || 'http://localhost:3000/api';
const [login, password] = process.argv.slice(2);
let token, sid;

const call = async (method, path, body, options = {}) => {
  const requestToken = options.token !== undefined ? options.token : token;
  const requestSid = options.sid !== undefined ? options.sid : sid;

  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(requestToken && { Authorization: 'Bearer ' + requestToken }),
      ...(requestSid && { 'X-Station-Id': String(requestSid) })
    },
    body: body != null ? JSON.stringify(body) : undefined
  });

  return { s: r.status, j: await r.json().catch(() => null) };
};


const ok = (cond, msg) => { assert(cond, msg); console.log('  ✔ ' + msg); };

(async () => {
  const t = Date.now();
  const gPass = 'GerantTest1!';
  const gLogin = 'gerant' + (t % 100000);

  // Connexion de l'administrateur global
  let r = await call(
    'POST',
    '/auth/login',
    { login, password },
    { token: null, sid: null }
  );

  ok(r.s === 200 && !!r.j?.token, 'connexion admin');

  if (r.s !== 200 || !r.j?.token) {
    throw new Error('Connexion admin impossible : ' + JSON.stringify(r.j));
  }

  token = r.j.token;

  // Verifier que le compte est bien administrateur global
  r = await call('GET', '/me', null, { sid: null });
  ok(!!r.j?.is_global, 'administrateur global');

  if (!r.j?.is_global) {
    throw new Error('Le compte doit etre un administrateur global.');
  }

  // Verifier le refus d'un mauvais mot de passe
  r = await call(
    'POST',
    '/auth/login',
    { login, password: 'mauvais-mot-de-passe' },
    { token: null, sid: null }
  );
  ok(r.s === 401, 'mauvais mot de passe refuse');

  // Creer un client, son gerant et sa station
  r = await call(
    'POST',
    '/admin/clients',
    {
      name: 'Client Smoke ' + t,
      code: 'CS' + (t % 10000),
      owner_login: gLogin,
      owner_password: gPass
    },
    { sid: null }
  );

  ok(r.s === 201, 'client de test cree');

  if (r.s !== 201 || !r.j?.id || !r.j?.station_id) {
    throw new Error('Creation client impossible : ' + JSON.stringify(r.j));
  }

  const clientId = r.j.id;
  sid = String(r.j.station_id);

  // Configurer le contrat de test
  r = await call(
    'PUT',
    `/admin/clients/${clientId}/contract`,
    {
      can_create_station: true,
      max_stations: 1,
      can_manage_users: true,
      max_users: 3,
      features: {
        can_access_hr: false,
        modules: { hr: false },
        can_customize_signature: false
      }
    },
    { sid: null }
  );

  ok(r.s === 200, 'contrat de test configure');

  if (r.s !== 200) {
    throw new Error('Configuration contrat impossible : ' + JSON.stringify(r.j));
  }

  // Connecter le gerant et poursuivre les tests sur sa station
  r = await call(
    'POST',
    '/auth/login',
    { login: gLogin, password: gPass },
    { token: null, sid: null }
  );

  ok(r.s === 200 && !!r.j?.token, 'connexion gerant');

  if (r.s !== 200 || !r.j?.token) {
    throw new Error('Connexion gerant impossible : ' + JSON.stringify(r.j));
  }

  token = r.j.token;

  r = await call('GET', '/products');
  ok(r.s === 200, 'acces station');


  const mk = async (name, category, pa, pv, stock) => (await call('POST', '/products', { category, name: name + t, buy_price: pa, sell_price: pv, initial_stock: stock, min_stock: 10, unit: category === 'CARBURANT' ? 'L' : 'pce' })).j;
  const es = await mk('Essence', 'CARBURANT', 700, 775, 5000), ga = await mk('Gasoil', 'CARBURANT', 650, 720, 5000), eau = await mk('Eau', 'BOUTIQUE', 300, 500, 50);
  ok(es.id && ga.id && eau.id, 'produits créés');
  r = await call('POST', '/pumps', { number: 1 + (t % 30000), name: 'Pompe test', counters: [{ counter_number: 1, product_id: es.id }, { counter_number: 2, product_id: ga.id }] });
  ok(r.s === 201, 'pompe créée (compteur 1 → Essence, compteur 2 → Gasoil)');
  const emp = (await call('POST', '/employees', { matricule: 'T' + t, last_name: 'Test', first_name: 'Pompiste', position: 'pompiste' })).j;
  const counters = (await call('GET', '/pumps')).j.filter(p => p.status === 'active').flatMap(p => p.counters);
  const reg = (await call('GET', '/cash/registers')).j[0];

  r = await call('POST', '/shifts/open', { kind: 'Matin', cash_register_id: reg.id, opening_cash: 10000, employee_ids: [emp.id], counters: counters.map(c => ({ counter_id: c.id, index_start: c.current_index })) });
  ok(r.s === 201, 'quart ouvert: ' + (r.j.error || 'N° ' + r.j.number)); const shift = r.j;
  ok((await call('POST', '/shifts/open', { kind: 'Nuit', cash_register_id: reg.id, opening_cash: 0, counters: [{ counter_id: counters[0].id, index_start: 0 }] })).s === 409, 'second quart ouvert refusé');

  r = await call('POST', '/sales', { employee_id: emp.id, items: [{ product_id: eau.id, quantity: 2 }], payments: [{ method: 'especes', amount: 1000 }] });
  ok(r.s === 201 && r.j.total === 1000, 'vente de 2 eaux = 1000');
  ok((await call('POST', '/sales', { employee_id: emp.id, items: [{ product_id: es.id, quantity: 1 }], payments: [{ method: 'especes', amount: 775 }] })).s === 400, 'vente de carburant hors compteurs refusée');
  ok((await call('POST', '/sales', { employee_id: emp.id, items: [{ product_id: eau.id, quantity: 1 }], payments: [{ method: 'especes', amount: 1 }] })).s === 400, 'paiement ≠ total refusé');

  const closeBody = extra => ({ counters: counters.map(c => ({ counter_id: c.id, index_end: c.current_index + 100 })), counted_cash: 0, ...extra });
  r = await call('POST', `/shifts/${shift.id}/close?preview=1`, closeBody());
  ok(r.s === 200 && r.j.preview, 'aperçu de clôture'); const th = r.j.report.cash.theoretical;
  ok(r.j.report.cash.gap === -th, 'écart de caisse détecté quand la caisse comptée est fausse');
  r = await call('POST', `/shifts/${shift.id}/close`, closeBody({ counted_cash: th - 500 }));
  ok(r.s === 422, 'clôture avec écart sans justification refusée');
  r = await call('POST', `/shifts/${shift.id}/close`, closeBody({ counted_cash: th }));
  ok(r.s === 200 && !r.j.report.anomalies.length, 'clôture sans anomalie : caisse théorique ' + th);

  ok((await call('POST', `/shifts/${shift.id}/close`, closeBody({ counted_cash: th }))).s === 409, 'quart déjà clôturé : verrouillé');
  ok((await call('POST', '/sales', { employee_id: emp.id, items: [{ product_id: eau.id, quantity: 1 }], payments: [{ method: 'especes', amount: 500 }] })).s === 409, 'vente sans quart ouvert refusée');
  const stock = (await call('GET', '/products')).j.find(p => p.id === es.id).stock;
  ok(stock === 4900, 'stock Essence = 5000 − 100 L');

  // ---- Achats fournisseurs : commande → réception → facture → paiement → archivage
  const sup = (await call('POST', '/suppliers', { name: 'Fournisseur ' + t })).j;
  ok(sup.id, 'fournisseur créé');
  r = await call('POST', '/purchases', { supplier_id: sup.id, items: [{ product_id: eau.id, quantity: 20, unit_cost: 300 }] });
  ok(r.s === 201 && r.j.status === 'commande' && r.j.total === 6000, 'commande ' + r.j.order_no + ' (6000)'); const po = r.j;
  const det = (await call('GET', '/purchases/' + po.id)).j.details[0];
  ok((await call('POST', `/purchases/${po.id}/invoice`, { invoice_no: 'F1' })).s === 409, 'facture avant réception refusée');
  ok((await call('POST', `/purchases/${po.id}/receive`, { lines: [{ detail_id: det.id, quantity: 25 }] })).s === 409, 'réception supérieure à la commande refusée');
  r = await call('POST', `/purchases/${po.id}/receive`, { lines: [{ detail_id: det.id, quantity: 10 }] });
  ok(r.j.status === 'partiel', 'réception partielle');
  r = await call('POST', `/purchases/${po.id}/receive`, { lines: [{ detail_id: det.id, quantity: 10 }] });
  ok(r.j.status === 'recu', 'réception complète');
  ok((await call('GET', '/products')).j.find(p => p.id === eau.id).stock === 68, 'stock Eau : 48 + 20 = 68');
  r = await call('POST', `/purchases/${po.id}/invoice`, { invoice_no: 'F-' + t, due_date: '2030-01-31' });
  ok(r.j.status === 'facture' && r.j.invoice_total === 6000, 'facture enregistrée (6000)');

ok((await call('GET', '/suppliers')).j.find(x => x.id === sup.id).balance_due === null, 'dette fournisseur masquee sans permission');

  ok((await call('POST', `/purchases/${po.id}/pay`, { amount: 7000, method: 'especes' })).s === 400, 'paiement supérieur à la dette refusé');
  const cash0 = (await call('GET', '/cash/registers')).j[0].balance;
  r = await call('POST', `/purchases/${po.id}/pay`, { amount: 2000, method: 'especes' });
  ok(r.j.status === 'facture' && r.j.paid === 2000, 'paiement partiel de 2000');
  ok((await call('GET', '/cash/registers')).j[0].balance === cash0 - 2000, 'caisse diminuée de 2000');
  r = await call('POST', `/purchases/${po.id}/pay`, { amount: 4000, method: 'mobile_money' });
  ok(r.j.status === 'paye', 'achat soldé');

ok((await call('GET', '/suppliers')).j.find(x => x.id === sup.id).balance_due === null, 'dette fournisseur toujours masquee sans permission');

  ok((await call('POST', `/purchases/${po.id}/archive`)).j.status === 'archive', 'achat archivé');
  console.log('\nTous les tests sont passés.');
})().catch(e => { console.error('\n✖ ' + e.message); process.exit(1); });
