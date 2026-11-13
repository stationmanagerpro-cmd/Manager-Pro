'use strict';
// Rendu des écrans ajoutés par l'audit (RH, règles de paie, transferts, compteurs, licence…) dans Chromium, API simulée.
let chromium; try { chromium = require('playwright').chromium; } catch (_) { console.log('gaps-ui-dom : ignoré (playwright absent)'); process.exit(0); }
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../public/ext-gaps.js'), 'utf8');
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.setContent('<div id="m"></div><div id="out"></div>');
  await p.evaluate(() => {
    window.V = {}; window.VM = {}; window.NAV_ICONS = {}; window.can = () => true;
    window.esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    window.T = (h, r) => '<table><tr>' + h.map(x => '<th>' + x + '</th>').join('') + '</tr>' + r.map(x => '<tr>' + x.map(y => '<td>' + y + '</td>').join('') + '</tr>').join('') + '</table>';
    window.nfr = n => String(n); window.f = n => n + ' F'; window.dt = t => String(t); window.toast = () => {}; window.go = () => {};
    window.modal = h => { document.getElementById('m').innerHTML = '<div>' + h + '</div>'; }; window.closeM = () => {};
    window.mods = { schedule: true, skills: true, training: true, evaluation: true, disciplinary: true, portal: true, leave: true, attendance: true, payroll_email: true };
    window.G = async p => {
      if (p.startsWith('/hr/v2/modules')) return { modules: mods };
      if (p === '/employees') return [{ id: 1, first_name: 'Awa', last_name: 'Traoré', active: true }];
      if (p.startsWith('/hr/v2/teams')) return [{ code: 'J', name: 'Jour', start_time: '06:00:00', end_time: '14:00:00' }];
      if (p === '/hr/v2/skills') return [{ id: 1, label: 'Conduite' }];
      if (p.startsWith('/hr/v2/employee-skills')) return [{ employee: 'Awa Traoré', skill_label: 'Conduite', level: 'expert', evaluated_on: '2026-11-01' }];
      if (p === '/hr/v2/trainings') return [{ id: 4, title: 'Sécurité incendie', organism: 'Pompiers', start_date: '2026-11-02', end_date: '2026-11-03', duration_hours: 8, cost_info: 5000 }];
      if (p.startsWith('/hr/v2/evaluation-templates')) return [{ id: 1, label: 'Pompiste', criteria: [{ code: 'a', label: 'Ponctualité', max: 5 }] }];
      if (p === '/hr/v2/evaluations') return [{ employee: 'Awa Traoré', period_label: '2026', overall_score: 16, evaluated_on: '2026-11-05', status: 'ok', comment: 'RAS' }];
      if (p === '/hr/v2/disciplinary') return [{ occurred_on: '2026-11-04', employee: 'Awa Traoré', kind: 'sanction', type_label: 'Avertissement', description: 'retard' }];
      if (p === '/hr/v2/me/summary') return { linked: true, employee: { id: 1, first_name: 'Awa', last_name: 'Traoré' }, leaves: [], attendance: [], documents: [], payslips: [{ number: 'B1', month: '2026-10-01', status: 'valide', net_pay: 100000 }], note: 'Portail limité' };
      if (p === '/hr/v2/leave-types') return [{ id: 1, code: 'CP', label: 'Congé payé', paid: true, annual_days: 30 }];
      if (p.startsWith('/hr/v2/attendance')) return [{ id: 9, work_date: '2026-11-12', employee: 'Awa Traoré', status: 'present', time_in: '06:00:00', time_out: '14:00:00' }];
      if (p.startsWith('/hr/v2/overtime/approved-hours')) return { month: '2026-11', lines: [{ employee_id: 1, hours: 5, amount_estimate: 7000 }], note: 'SIMULATION' };
      if (p.startsWith('/hr/v2/periods/check')) return { open: false, month: '2026-11' };
      if (p.startsWith('/hr/payroll?')) return [{ id: 3, employee: 'Awa Traoré', number: 'B1', status: 'valide', net_pay: 100000 }];
      if (p === '/hr/v2/email-template') return { subject: 'Fiche de paie', body: 'Bonjour {{prenom}}' };
      if (p === '/admin/smtp/diagnostics') return [{ created_at: '2026-11-12', success: false, diagnostic: 'aucun serveur SMTP configuré', login: 'adm' }];
      if (p === '/hr/activation-status') return { modules: [{ code: 'payroll_its_enabled', label: 'ITS', flag_on: false, can_enable_flag: true, active_rules: 1, pending_rules: 0, prerequisites: [{ label: 'Barème confirmé', ok: true }] }], checklist: [{ id: 'security_mode', value: 'strict' }] };
      if (p === '/hr/rules') return { warning: 'À valider' };
      if (p === '/hr/its-brackets') return [{ id: 1, version: 1, label: 'Barème 2026', brackets: [{ from: 0, to: 100000, rate: 0 }, { from: 100000, to: null, rate: 10 }], legal_status: 'a_confirmer', technical_status: 'desactivee' }];
      if (p.startsWith('/hr/')) return [];
      if (p === '/stock/transfers') return [{ id: 7, status: 'envoye', outgoing: true, to_station: 'Station B', from_station: 'A', sent_at: '2026-11-12', items: [{ product: 'Huile', quantity: 20 }] }];
      if (p === '/stock/transfers/stations') return [{ id: 2, name: 'Station B' }];
      if (p === '/pumps/counter-history') return [{ kind: 'correction', at: '2026-11-12', pump: 'P1', counter_number: 1, index_before: 10, index_after: 12, reason: 'erreur', login: 'adm' }];
      if (p === '/me/quotas') return { client_name: 'ACME', contract_status: 'actif', quotas: { stations: { used: 1, max: 3 } } };
      if (p === '/modules/catalog') return [{ code: 'sales', label: 'Ventes', description: 'POS' }, { code: 'price_history', label: 'Historique des prix', premium: true }];
      if (p === '/license/warnings') return { contract: { end_date: '2026-12-01', days_left: 18 }, warnings: [{ threshold_days: 30, warned_at: '2026-11-01', channel: 'messagerie' }] };
      if (p === '/dashboard/config') return { config: { cards: { revenue: true, fuel: true } } };
      if (p === '/dashboard/my-prefs') return { cards: { fuel: false } };
      if (p === '/fiscal/modules') return { modules: [{ code: 'tva', label: 'TVA', activated_by_client: true }], disclaimer: 'Indicatif' };
      throw new Error('route ?' + p);
    };
    window.Po = async () => ({}); window.api = async () => ({});
  });
  await p.addScriptTag({ content: src });
  const out = {};
  for (const k of ['rhteams', 'rhskills', 'rhtrain', 'rheval', 'rhdisc', 'rhme', 'rhrules', 'transferts', 'histcompteurs', 'licence', 'moidash', 'fiscalest'])
    out[k] = await p.evaluate(async k => { document.getElementById('out').innerHTML = await VM[k](); return document.getElementById('out').innerText; }, k);
  assert.match(out.rhteams, /Jour/); assert.match(out.rhskills, /Expert|expert/i); assert.match(out.rhtrain, /Sécurité incendie/);
  assert.match(out.rheval, /Ponctualité|Pompiste/); assert.match(out.rhdisc, /Avertissement/); assert.match(out.rhme, /B1/);
  assert.match(out.rhrules, /ITS[\s\S]*Barème 2026[\s\S]*100000→∞|0→100000/); assert.match(out.transferts, /Station B[\s\S]*Huile × 20/); assert.match(out.histcompteurs, /10 → 12/);
  assert.match(out.licence, /ACME[\s\S]*Ventes[\s\S]*J-30/); assert.match(out.moidash, /Ventes carburant/); assert.match(out.fiscalest, /TVA/);
  // module désactivé : message clair, pas d'erreur
  await p.evaluate(() => { smpHrModsReset(); mods.training = false; });
  assert.match(await p.evaluate(async () => { document.getElementById('out').innerHTML = await VM.rhtrain(); return document.getElementById('out').innerText; }), /désactivé/);
  // enveloppes (congés, présences, périodes, paramètres) sans vue d'origine : pas de plantage
  await p.evaluate(() => { smpHrModsReset(); mods.training = true; });
  for (const k of ['rhleaves', 'rhatt', 'rhot', 'rhperiods', 'rhsettings']) out[k] = await p.evaluate(async k => { document.getElementById('out').innerHTML = await VM[k](); return document.getElementById('out').innerText; }, k);
  assert.match(out.rhleaves, /Congé payé/); assert.match(out.rhatt, /Corriger/); assert.match(out.rhot, /Traoré[\s\S]*7000/); assert.match(out.rhperiods, /Rouvrir[\s\S]*Envoyer/); assert.match(out.rhsettings, /Modèle de l’e-mail[\s\S]*SMTP/);
  assert.deepStrictEqual(errs, []); console.log('✓ gaps-ui-dom : 17 écrans rendus sans erreur'); await b.close();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
