// Test de l'interface dans un navigateur simulé : node test/ui.js <login> <motdepasse>   (serveur lancé)
const { JSDOM } = require('jsdom');
const BASE = process.env.BASE || 'http://localhost:3000';
const [login, password] = process.argv.slice(2);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails++; };
const sl = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const errors = [];
  const d = await JSDOM.fromURL(BASE + '/', { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, BASE).href, o); w.scrollTo = () => {}; w.print = () => {}; w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {}; w.addEventListener('error', e => errors.push(e.message)); } });
  const w = d.window, $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)], ev = c => w.eval(c);
  const text = () => $('#pg').textContent, modalText = () => $('#m').textContent, toast = () => $('#toast').textContent;
  const wait = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sl(60); } return false; };
  const go = async (k, a) => { await w.go(k, a); await sl(250); };
  const click = async sel => { $(sel).click(); await sl(700); };
  const hasErr = () => $('#pg').innerHTML.includes('color:var(--r)');
  await sl(900);

  console.log('\nConnexion et navigation');
  $('#lu').value = login; $('#lp').value = password; await w.doLogin(); ok(await wait(() => $('#app').style.display == 'flex'), 'connexion via l\'interface');
  const nav = () => $$('#nav a').map(a => a.textContent.replace(/\s+/g, ' ').trim());
  ok(['Gestion RH', 'Rapports financiers', 'Paramètres', 'Employés', 'Mon profil'].every(l => nav().some(n => n.startsWith(l))), "menu administrateur complet : " + nav().length + ' entrées');
  const first = (await w.api('GET', '/me')).stations[0].id;
  const st = await w.api('POST', '/stations', { name: 'Station UI ' + Date.now() }); await w.chSt(st.id); await sl(300);
  ok(+ev('SID') === st.id, 'station de test isolée sélectionnée');
  for (const k of ['dash', 'quart', 'ventes', 'prod', 'pompes', 'cli', 'four', 'emp', 'caisse', 'alert', 'audit', 'rh', 'fin', 'moi', 'param']) { await go(k); ok(!hasErr() && text().length > 15, 'vue « ' + k + ' » affichée'); }

  console.log('\nParamètres par catégories, apparence, pied de page');
  for (const [k, h] of [['gen', 'Général'], ['app', 'Apparence'], ['sec', 'Utilisateurs et sécurité'], ['exp', 'Exploitation'], ['fin', 'Finances'], ['rh', 'Gestion RH'], ['doc', 'Rapports et documents'], ['data', 'Données et maintenance']]) { ev("SEC='" + k + "'"); await go('param'); ok(($('.grow h2') || {}).textContent === h && !hasErr(), 'paramètres : section « ' + h + ' » affichée'); }
  ev("SEC='app'"); await go('param'); $('#a_pri').value = '#0b5fa5'; w.prevTheme();
  ok(w.document.documentElement.style.getPropertyValue('--p') == '#0b5fa5', 'aperçu immédiat de la couleur principale');
  $('#a_pri').value = '#ffffff'; w.prevTheme(); await w.saveTheme(); await sl(400); ok(/trop claire/.test(toast()), 'couleur trop claire refusée (lisibilité)');
  $('#a_pri').value = '#0b5fa5'; $('#a_mode').value = 'dark'; await w.saveTheme(); await sl(600);
  ok(ev('AP.theme.primary') == '#0b5fa5' && w.document.documentElement.dataset.theme == 'dark', 'thème enregistré et appliqué à tout le site');
  await w.api('POST', '/settings/reset/theme'); await w.applyAppearance(); ok(ev('AP.theme.primary') == '#0a6b5c', 'réinitialisation du thème');
  ev("SEC='doc'"); await go('param'); $('#d_sa').checked = true; w.prevFooter(); ok(/Salon Informatique Log/.test($('#d_prev').textContent), 'aperçu : mention publicitaire visible quand activée');
  $('#d_text').value = 'Station de test'; await w.saveFooter(); await sl(500);
  ok(/Salon Informatique Log — 70 76 84 94/.test($('#ft').textContent) && /Station de test/.test($('#ft').textContent), 'pied de page du site : texte et mention affichés');
  await go('param'); $('#d_sa').checked = false; await w.saveFooter(); await sl(500); ok(!/Salon Informatique/.test($('#ft').textContent), 'mention désactivée : plus affichée');

  console.log('\nProduits, pompe, employé, quart (interface)');
  const es = await w.api('POST', '/products', { category: 'CARBURANT', name: 'Essence', buy_price: 700, sell_price: 800, initial_stock: 5000, min_stock: 100, unit: 'L' });
  await w.api('POST', '/products', { category: 'BOUTIQUE', name: 'Eau', buy_price: 300, sell_price: 500, initial_stock: 50, min_stock: 5, unit: 'pce' });
  await w.api('POST', '/pumps', { number: 1, name: 'Pompe 1', counters: [{ counter_number: 1, product_id: es.id, current_index: 0 }] });
  const emp = await w.api('POST', '/employees', { matricule: 'U' + (Date.now() % 1000), last_name: 'Traoré', first_name: 'Moussa', position: 'pompiste' });
  await w.api('PATCH', '/hr/employees/' + emp.id, { base_salary: 120000, contract_type: 'CDI' });
  await go('emp'); ok(/Traoré/.test(text()) && /120\s?000/.test(text().replace(/\u202f|\u00a0/g, ' ')), 'liste des employés avec photo/initiales et salaire (droits RH)');
  await w.openQ(); await sl(700); $('#f_ci').value = '30000'; $('#f_i0').value = '0'; const em = $$('#m select').find(s => /^e\d+$/.test(s.id.replace('f_', ''))); em.value = 'oui';
  const ep = $$('#m select').find(s => s.id.startsWith('f_ep')); ep.selectedIndex = 1; await click('#ok'); await go('quart'); ok(/OUVERT/.test(text()), 'quart ouvert avec affectation employé → pompe');

  console.log('\nVente de carburant : index, litres, montant');
  await w.addFuel(); await sl(900); ok(/Par index de compteur/.test(modalText()) && $('#fo').value === '0', "mode index : ancien index prérempli avec l'historique");
  $('#fn').value = '10'; $('#fn').dispatchEvent(new w.Event('input')); ok(/10 L/.test($('#fsum').textContent) && /8\s?000/.test($('#fsum').textContent.replace(/\u202f|\u00a0/g, ' ')), 'calcul en temps réel : 10 L = 8 000');
  $('#fn').value = '0'; $('#fn').dispatchEvent(new w.Event('input')); ok(/doit être supérieur/.test($('#fsum').textContent), 'contrôle en temps réel : index incohérent signalé'); $('#fn').value = '10'; $('#fn').dispatchEvent(new w.Event('input'));
  await click('#fok'); await go('ventes'); ok(/Carburant \(index\)/.test(text()), 'vente par index enregistrée (mode tracé : index)');
  await w.addFuel(); await sl(900); ok(/10/.test($('#fo').value), 'ancien index suivant = dernier nouvel index (10)');
  $('a[data-m="litres"]').click(); await sl(100); ok($('.fl').style.display !== 'none' && $('.fi').style.display === 'none', 'champs conditionnels selon le mode'); $('#fq').value = '5'; $('#fq').dispatchEvent(new w.Event('input')); await click('#fok'); await go('ventes'); ok(/Carburant \(litres\)/.test(text()), 'vente en litres enregistrée');
  await w.addFuel(); await sl(900); $('a[data-m="montant"]').click(); await sl(100); $('#fa').value = '1002'; $('#fa').dispatchEvent(new w.Event('input')); ok(/Arrondi/.test($('#fsum').textContent), 'montant : problème d\'arrondi signalé');
  await click('#fok'); ok(/Incohérences détectées/.test(modalText()), 'confirmation demandée avant enregistrement'); await click('#yes'); await go('ventes'); ok(/Carburant \(montant\)/.test(text()), 'vente en montant enregistrée après confirmation');
  const cur = await w.api('GET', '/shifts/current'); ok(Math.abs(cur.fuel_declared.liters - 16.253) < 0.0011 && cur.fuel_declared.total === 13002, 'les trois saisies sont cumulées sans écraser les autres : 16,253 L / 13 002');
  await w.api('PUT', '/settings/fuel_amount_entry_allowed', { value: false }); await w.applyAppearance(); await w.addFuel(); await sl(700); ok(!$('a[data-m="montant"]'), 'saisie par montant masquée quand désactivée'); ev('closeM()');
  await w.api('PUT', '/settings/fuel_amount_entry_allowed', { value: true }); await w.applyAppearance();

  console.log('\nFiche employé : onglets, photo, dettes, paie');
  await w.api('PUT', '/images/employees/' + emp.id, { data_url: PNG }); ev("ETAB='id'"); await go('empf', emp.id); await sl(500);
  ok(/Traoré/.test(text()) && /Identité professionnelle/.test(text()), 'fiche : identité professionnelle'); ok(!!$('img[data-ent="employees"]') || !!$('.av'), 'photo / avatar affiché');
  for (const t of ['quarts', 'perf', 'ecarts', 'dettes', 'paie', 'fin']) { ev("ETAB='" + t + "'"); await go('empf', emp.id); ok(!hasErr() && /Traoré/.test(text()), 'onglet « ' + t + ' » chargé'); }
  ev("ETAB='perf'"); await go('empf', emp.id); ok(/Chiffre d'affaires attribué/.test(text()) && /ni un bénéfice|attribué/.test(text()), 'performances : CA attribué (distinct d\'un bénéfice)');
  ev("ETAB='dettes'"); await go('empf', emp.id); w.newDebt(); await sl(200); $('#dm').value = '8000'; $('#dr').value = 'Manquant de caisse'; await click('#dok'); ok(/Manquant de caisse/.test(text()) && /8\s?000/.test(text().replace(/\u202f|\u00a0/g, ' ')), 'dette créée depuis la fiche');
  const debt = (await w.api('GET', `/hr/employees/${emp.id}/debts`))[0]; ev('payDebt(' + debt.id + ',8000)'); await sl(300); $('#f_amount').value = '3000'; await click('#ok');
  ok(/RD-/.test(text()) && /5\s?000/.test(text().replace(/\u202f|\u00a0/g, ' ')), 'remboursement partiel : reçu généré, solde 5 000');
  await w.dlFile(`/hr/debt-payments/${(await w.api('GET', `/hr/employees/${emp.id}/debts`))[0].payments[0].id}/receipt.pdf`, 'recu'); ok(!/impossible|Erreur/.test(toast()), 'reçu PDF téléchargeable');
  ev('newAdv()'); await sl(300); $('#f_amount').value = '20000'; await click('#ok'); ok(/20\s?000/.test(text().replace(/\u202f|\u00a0/g, ' ')), 'avance sur salaire enregistrée');
  ev("ETAB='paie'"); ev(`EMON='${new Date().toISOString().slice(0, 7)}'`); await go('empf', emp.id); ev('newAdj()'); await sl(300); $('#f_label').value = 'Prime'; $('#f_amount').value = '10000'; await click('#ok');
  w.prepPay(); await sl(300); $('#f_debt_mode').value = 'all'; await click('#ok'); ok(/NET FINAL À PAYER/.test(modalText()) && /Aperçu avant validation/.test(modalText()) && /obligations applicables au Mali/.test(modalText()), 'aperçu de paie avant validation (avertissement légal inclus)');
  ok(/130\s?000/.test(modalText().replace(/\u202f|\u00a0/g, ' ')) && /105\s?000/.test(modalText().replace(/\u202f|\u00a0/g, ' ')), 'brut 130 000 et net 105 000 (130 000 − 20 000 d\'avance − 5 000 de dette restante)');
  await click('#pk'); const sl1 = (await w.api('GET', `/hr/payroll?employee_id=${emp.id}`))[0]; ok(sl1 && sl1.status == 'brouillon', 'bulletin créé en brouillon');
  await ev('valSlip(' + sl1.id + ')'); await sl(300); await click('#yes'); await sl(300); ok((await w.api('GET', `/hr/payroll?employee_id=${emp.id}`))[0].status == 'valide', 'bulletin validé (figé)');
  await go('empf', emp.id); ok(!/Supprimer/.test(text().split('Bulletins de paie')[1] || ''), 'bulletin validé : plus de suppression possible');
  await w.dlFile(`/hr/payroll/${sl1.id}/pdf`, 'bulletin'); ok(!/impossible|Erreur/.test(toast()), 'bulletin PDF téléchargeable');
  ev("ETAB='fin'"); await go('empf', emp.id); ok(/Activité de vente/.test(text()) && /ne pas confondre/.test(text()), 'situation financière : ventes distinguées de la rémunération'); ok(/Net à payer \(validé\)/.test(text()), 'situation financière : net à payer');
  await go('rh'); ok(/Écarts de caisse et de stock/.test(text()) && /Bulletins/.test(text()), 'Gestion RH : vue d\'ensemble');

  console.log('\nRapports financiers');
  await go('fin'); const kinds = (await w.api('GET', '/finance/kinds')).map(k => k.key);
  for (const k of kinds) { $('#fk').value = k; await ev('finPreview()'); await sl(700); ok($('#finout h2') && !/Erreur/.test(toast() + $('#finout').textContent.slice(0, 80)), 'aperçu du rapport « ' + k + ' »'); }
  $('#fk').value = 'ventes'; await ev('finPreview()'); await sl(600); ok(/Ventes par produit/.test($('#finout').textContent) && /Moyens de paiement/.test($('#finout').textContent), 'rapport des ventes : produits et moyens de paiement');
  $('#fmd').value = 'date'; w.finMode(); $('#fdt').value = new Date(Date.now() - 864e5).toISOString().slice(0, 10); await ev('finPreview()'); await sl(600); ok(/Situation au/.test($('#finout').textContent), 'mode « date précise » (soldes à la date)');
  await ev('finControls()'); await sl(500); ok(/Contrôles et réconciliations/.test($('#finout').textContent), 'contrôles et réconciliations');
  await ev('finExport(\'pdf\')'); await sl(500); ok(!/impossible|Erreur/.test(toast()), 'export PDF depuis l\'interface'); await ev('finExport(\'xlsx\')'); await sl(500); ok(!/impossible|Erreur/.test(toast()), 'export Excel depuis l\'interface');
  await ev('finPreview()'); await sl(500); $('#vs').value = 'verifie'; await ev('finValidate()'); await sl(500); ok(/Validation enregistrée/.test(toast()), 'validation électronique enregistrée');

  console.log('\nDroits (menu et accès) pour un utilisateur limité');
  const u = 'cais' + (Date.now() % 100000); await w.api('POST', '/users', { login: u, password: 'Passw0rd!x1', role: 'CAISSIER', station_ids: [st.id] });
  await w.logout(); await sl(500); $('#lu').value = u; $('#lp').value = 'Passw0rd!x1'; await w.doLogin(); ok(await wait(() => $('#app').style.display == 'flex'), 'connexion du caissier'); await sl(1200);   // laisse la page d'accueil se charger
  ok(!nav().some(n => /^(Gestion RH|Rapports financiers|Paramètres|Employés|Journal)/.test(n)) && nav().some(n => n.startsWith('Ventes')), 'menu du caissier : pas de RH, finances ni paramètres : ' + nav().join(' | '));
  await go('rh'); ok(/Accès refusé/.test(text()), 'accès direct à la Gestion RH refusé : « ' + text().slice(0, 50) + ' »');
  await go('param'); ok(/Accès refusé/.test(text()), 'accès direct aux paramètres refusé');
  ok(ev("typeof ME.permissions.includes == 'function' && !ME.permissions.includes('hr.payroll')"), 'permissions du caissier sans paie');
  w.chgPwd(); await sl(200); $('#f_current').value = 'Passw0rd!x1'; $('#f_next').value = 'Nouveau!Pass2'; $('#f_again').value = 'Nouveau!Pass2'; $('#ok').click(); ok(await wait(() => /Mot de passe modifié/.test(toast()), 6000), 'changement de mot de passe (ancien mot de passe exigé, bcrypt)');
  await w.logout(); await sl(400);

  ok(errors.length === 0, 'aucune erreur JavaScript dans la console' + (errors.length ? ' : ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `\n✖ ${fails} vérification(s) en échec` : '\nTous les tests de l\'interface sont passés.');
  w.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('\n✖ ERREUR : ' + (e.stack || e.message)); process.exit(1); });
