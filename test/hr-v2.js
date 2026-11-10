// Tests RH V2 (node test/hr-v2.js <login> <password>)
const BASE = process.env.API || 'http://localhost:3000/api';
const [login, password] = process.argv.slice(2);
if (!login || !password) { console.error('Usage: node test/hr-v2.js <login> <password>'); process.exit(2); }
let token, sid, fails = 0;
const hdr = (t, s) => ({ 'Content-Type': 'application/json', ...(t && { Authorization: 'Bearer ' + t }), ...(s && { 'X-Station-Id': String(s) }) });
const call = async (method, p, body, o = {}) => {
  const r = await fetch(BASE + p, { method, headers: hdr(o.token ?? token, o.sid ?? sid), body: body != null ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) };
};
const ok = (c, m) => { if (c) console.log('  ✔ ' + m); else { fails++; console.log('  ✖ ' + m); } };
const section = t => console.log('\n' + t);

(async () => {
  const t = Date.now();
  let r = await call('POST', '/auth/login', { login, password }, { token: null, sid: null });
  ok(r.s === 200, 'login'); token = r.j.token;
  const me = (await call('GET', '/me', null, { sid: null })).j;
  const first = me.stations[0].id;
  r = await call('POST', '/stations', { name: 'Station RHV2 ' + t, currency: 'FCFA' }, { sid: first });
  sid = r.j.id; ok(r.s === 201, 'station');

  section('Modules & dashboard');
  r = await call('GET', '/hr/v2/modules');
  ok(r.s === 200 && r.j.modules, 'modules RH');
  r = await call('GET', '/hr/v2/dashboard');
  ok(r.s === 200 && r.j.headcount, 'dashboard');

  section('Employé + contrat + document');
  const emp = (await call('POST', '/employees', {
    matricule: 'V2' + (t % 10000), last_name: 'Coulibaly', first_name: 'Awa', position: 'pompiste'
  })).j;
  ok(emp?.id, 'employé');
  await call('PATCH', `/hr/employees/${emp.id}`, { base_salary: 200000, status: 'actif', email: 'awa.test@example.com' });
  r = await call('POST', '/hr/v2/contracts', {
    employee_id: emp.id, contract_type: 'CDI', start_date: '2026-01-01', end_date: '2027-01-01', trial_end: '2026-04-01'
  });
  ok(r.s === 201, 'contrat créé');
  r = await call('POST', '/hr/v2/documents', {
    employee_id: emp.id, category: 'permis', title: 'Permis B', expires_on: '2026-12-31'
  });
  ok(r.s === 201, 'document créé');

  section('Présence + correction auditée');
  const today = new Date().toISOString().slice(0, 10);
  r = await call('POST', '/hr/v2/attendance', { employee_id: emp.id, work_date: today, status: 'present' });
  ok(r.s === 201, 'présence');
  const attId = r.j.id;
  r = await call('POST', `/hr/v2/attendance/${attId}/correct`, { status: 'retard', late_minutes: 15, reason: 'Embouteillage test' });
  ok(r.s === 200, 'correction présence');

  section('Congés');
  const types = (await call('GET', '/hr/v2/leave-types')).j || [];
  const typeId = types[0]?.id;
  r = await call('POST', '/hr/v2/leaves', {
    employee_id: emp.id, leave_type_id: typeId, start_date: '2026-11-01', end_date: '2026-11-05', days: 5, reason: 'Repos'
  });
  ok(r.s === 201, 'demande congé');
  const leaveId = r.j.id;
  r = await call('POST', `/hr/v2/leaves/${leaveId}/decide`, { decision: 'approuve' });
  ok(r.s === 200 && r.j.status === 'approuve', 'congé approuvé');

  section('Heures sup. workflow');
  r = await call('POST', '/hr/v2/overtime', { employee_id: emp.id, work_date: today, hours: 2, reason: 'Pic activité' });
  ok(r.s === 201 && r.j.status === 'propose', 'HS proposée');
  const otId = r.j.id;
  r = await call('POST', `/hr/v2/overtime/${otId}/approve`, {});
  ok(r.s === 409, 'approbation directe refusée (pas encore validée)');
  r = await call('POST', `/hr/v2/overtime/${otId}/validate`, {});
  ok(r.s === 200, 'HS validée responsable');
  r = await call('POST', `/hr/v2/overtime/${otId}/approve`, {});
  ok(r.s === 200 && r.j.status === 'approuve_rh', 'HS approuvée RH');
  ok(/SIMULATION/i.test(r.j.warning || ''), 'avertissement simulation');

  section('Contrôle de paie');
  r = await call('GET', '/hr/v2/payroll-control?month=' + new Date().toISOString().slice(0, 7));
  ok(r.s === 200 && (r.j.status === 'PAIE_PRETE' || r.j.status === 'PAIE_BLOQUEE'), 'contrôle paie');

  section('Alertes');
  r = await call('POST', '/hr/v2/alerts/refresh', {});
  ok(r.s === 200, 'refresh alertes');

  section('Formation coût informatif');
  r = await call('POST', '/hr/v2/trainings', {
    title: 'Sécurité station', cost_info: 50000, participant_ids: [emp.id]
  });
  ok(r.s === 201 && /informatif/i.test(r.j.note || ''), 'formation sans écriture financière');

  console.log('\n' + (fails ? `✖ ${fails} échec(s)` : '✔ RH V2 OK'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
