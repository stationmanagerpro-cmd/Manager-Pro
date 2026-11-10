// Profil personnel de chaque utilisateur (remplace « Mon compte ») : identité, indicateurs propres au poste, autorisations,
// journal d'activité unifié (traçabilité, audit détaillé, actions faites à son nom) et exports PDF / Excel.
//  - lecture seule et strictement personnelle : chaque route ne lit que les données de l'utilisateur connecté ;
//  - indépendant du module RH du contrat : un utilisateur sans fiche employé (ou sans module RH) garde son profil ;
//  - chaque export est lui-même journalisé dans audit_logs.
const express = require('express');
const { pool, HttpError, wrap, audit } = require('./core');
const r = express.Router();

const ymd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const num = v => (v == null ? 0 : Number(v));
const warn = (label, e) => console.warn(`[profil personnel] ${label} :`, e && e.message);
/** Exécute un bloc d'indicateurs : une table absente ou un schéma ancien ne doit jamais faire tomber tout le profil. */
async function safely(label, fn) { try { return await fn(); } catch (e) { warn(label, e); return null; } }

// ---------------------------------------------------------------- autorisations
const GROUPS = {
  sale: 'Ventes', shift: 'Quarts', price: 'Prix', stock: 'Stock', cash: 'Caisse', expense: 'Dépenses', money: 'Trésorerie', finance: 'Finance',
  report: 'Rapports', export: 'Exports', audit: 'Audit', customer: 'Clients', receivable: 'Créances clients', supplier: 'Fournisseurs',
  debt: 'Dettes fournisseurs', purchase: 'Achats', hr: 'Ressources humaines', commission: 'Commissions', accounting: 'Comptabilité',
  fiscal: 'Fiscalité', user: 'Utilisateurs', role: 'Rôles et accès', settings: 'Paramètres'
};
const groupOf = code => { const p = String(code).split('.')[0]; return { key: p, label: GROUPS[p] || (p.charAt(0).toUpperCase() + p.slice(1)) }; };

const ROLE_HELP = {
  POMPISTE: ['Enregistrer vos ventes sur les pompes qui vous sont attribuées.', 'Remettre vos espèces et vos paiements à la clôture du quart.', 'Justifier vos écarts : vous seul répondez de vos pompes.'],
  CAISSIER: ['Encaisser les ventes et les règlements pendant votre quart.', 'Remettre votre caisse à la clôture et justifier tout écart.', 'Vos encaissements sont rattachés à votre nom et à votre matricule.'],
  SUPERVISEUR: ['Suivre les quarts, les écarts et les anomalies de votre équipe.', 'Vos décisions (acceptation, contestation, attribution) sont tracées à votre nom.'],
  COMPTABLE: ['Saisir et contrôler les écritures, les paiements et les rapprochements.', 'Chaque écriture ou validation est tracée à votre nom.'],
  MAGASINIER: ['Réceptionner les achats et suivre les stocks.', 'Chaque mouvement de stock est rattaché à votre nom.'],
  GERANT: ['Piloter la station : quarts, équipes, finances, décisions sur les écarts.', 'Vos décisions engagent la station et sont toutes tracées.'],
  ADMIN: ['Administrer le compte : utilisateurs, rôles, paramètres et contrat.', 'Vos actions d’administration sont les plus sensibles : elles sont toutes tracées.']
};
const FOCUS = (role, position, perms) => {
  const p = String(position || '').toLowerCase();
  if (role === 'POMPISTE' || /pompiste/.test(p)) return 'pompiste';
  if (role === 'CAISSIER' || /caissi/.test(p)) return 'caissier';
  if (role === 'COMPTABLE' || /comptab/.test(p)) return 'comptable';
  if (role === 'SUPERVISEUR' || /supervis/.test(p)) return 'superviseur';
  if (role === 'MAGASINIER' || /magasin/.test(p)) return 'magasinier';
  if (role === 'GERANT' || /g[ée]rant/.test(p)) return 'gerant';
  if (role === 'ADMIN') return 'admin';
  if (perms && perms.has('cash.manage')) return 'caissier';
  return 'general';
};

async function myEmployee(req) {
  if (!req.sid) return null;
  const { rows: [e] } = await pool.query(
    `SELECT e.id, e.matricule, e.first_name, e.last_name, e.position, e.status, e.hired_on, e.department, e.team,
            (SELECT TRIM(m.first_name || ' ' || m.last_name) FROM employees m WHERE m.id = e.manager_id) AS manager_name
       FROM employees e WHERE e.user_id = $1 AND e.station_id = $2 AND e.deleted_at IS NULL`, [req.user.id, req.sid]);
  return e || null;
}

async function permissionsOf(req) {
  const { rows: [u] } = await pool.query(
    `SELECT r.id AS role_id, r.code, r.label, r.personal_user_id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [req.user.id]);
  const { rows: all } = await pool.query('SELECT code, label FROM permissions ORDER BY code');
  const label = new Map(all.map(p => [p.code, p.label]));
  const { rows: rp } = await pool.query(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`, [u.role_id]);
  const fromRole = new Set(rp.map(x => x.code));
  const effective = req.user.perms;                      // rôle + plafonds de la station + règles du contrat
  const codes = new Set([...effective]);
  const groups = new Map();
  for (const code of [...codes].sort()) {
    const g = groupOf(code);
    if (!groups.has(g.key)) groups.set(g.key, { key: g.key, label: g.label, items: [] });
    groups.get(g.key).items.push({ code, label: label.get(code) || code });
  }
  // Droits du rôle que la station a retirés : le profil les montre pour que la personne comprenne ce qu'elle ne peut pas faire.
  const restricted = [...fromRole].filter(c => !effective.has(c)).sort().map(c => ({ code: c, label: label.get(c) || c, group: groupOf(c).label }));
  return {
    role: { code: u.code, label: u.label, personal: u.personal_user_id != null },
    total: codes.size,
    groups: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    restricted,
    note: u.personal_user_id != null
      ? 'Votre accès est un rôle individuel : il n’appartient qu’à vous et peut différer de celui de vos collègues du même poste.'
      : 'Votre accès vient du rôle commun de votre poste.'
  };
}

// ---------------------------------------------------------------- identité
r.get('/me/profile', wrap(async (req, res) => {
  const { rows: [u] } = await pool.query(
    `SELECT u.id, u.login, u.full_name, u.job_title, u.last_login_at, u.created_at, (u.photo_path IS NOT NULL) AS has_photo,
            COALESCE(u.successful_login_count, 0) AS logins, r.code AS role, r.label AS role_label, r.personal_user_id
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [req.user.id]);
  if (!u) throw new HttpError(404, 'Compte introuvable');
  const emp = await safely('fiche employé', () => myEmployee(req));
  const stations = req.user.is_global ? [] : (await pool.query(
    `SELECT s.id, s.name FROM stations s JOIN user_stations us ON us.station_id = s.id WHERE us.user_id = $1 AND s.active = true ORDER BY s.id`, [req.user.id])).rows;
  const sessions = (await safely('connexions', async () => (await pool.query(
    `SELECT id, ip_address, created_at, expires_at, revoked_at FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 8`, [req.user.id])).rows)) || [];
  const name = (u.full_name || '').trim() || (emp ? `${emp.first_name} ${emp.last_name}`.trim() : u.login);
  res.json({
    identity: {
      user_id: u.id, login: u.login, name, job_title: u.job_title || (emp && emp.position) || null, has_photo: !!u.has_photo,
      matricule: emp ? emp.matricule : null, role: { code: u.role, label: u.role_label, personal: u.personal_user_id != null },
      is_global: !!req.user.is_global, station_id: req.sid || null, stations, last_login_at: u.last_login_at, created_at: u.created_at, logins: num(u.logins)
    },
    employee: emp,
    focus: FOCUS(u.role, emp && emp.position, req.user.perms),
    role_help: ROLE_HELP[u.role] || ['Vos accès dépendent du rôle que l’administrateur local vous a attribué.', 'Toutes vos actions de saisie sont tracées à votre nom.'],
    sessions: sessions.map(s => ({ id: s.id, ip: s.ip_address, at: s.created_at, expires_at: s.expires_at, revoked: !!s.revoked_at, current: String(s.id) === String(req.sessionId) })),
    traceability: 'Chaque action d’écriture que vous faites est enregistrée avec votre nom, votre matricule, la date, l’heure et l’adresse de connexion. Vous seul voyez votre journal ici ; l’administrateur local garde l’audit global.'
  });
}));

r.get('/me/profile/permissions', wrap(async (req, res) => { res.json(await permissionsOf(req)); }));

// ---------------------------------------------------------------- indicateurs
const periodDays = q => { const d = String(q || '30'); return d === 'all' ? 0 : Math.min(Math.max(parseInt(d, 10) || 30, 1), 3650); };

async function activityBlock(req, days) {
  const p = [req.user.id, req.sid || null, days];
  const base = `FROM user_activity_log l WHERE l.user_id = $1 AND ($2::bigint IS NULL OR l.station_id = $2) AND ($3::int = 0 OR l.created_at >= now() - ($3::int || ' days')::interval)`;
  const [tot, mod, day, hour, sens, first] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n, MAX(l.created_at) AS last_at ${base}`, p),
    pool.query(`SELECT l.module, COUNT(*)::int AS n ${base} GROUP BY l.module ORDER BY n DESC, l.module LIMIT 10`, p),
    pool.query(`SELECT to_char(l.created_at::date, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n ${base} GROUP BY 1 ORDER BY 1 DESC LIMIT 60`, p),
    pool.query(`SELECT EXTRACT(HOUR FROM l.created_at)::int AS h, COUNT(*)::int AS n ${base} GROUP BY 1 ORDER BY 1`, p),
    pool.query(`SELECT l.created_at, l.label, l.record_id ${base} AND (l.method = 'DELETE' OR l.label ~* '^(Annulation|Suppression|Réinitialisation|Restauration|Rejet)') ORDER BY l.id DESC LIMIT 6`, p),
    pool.query('SELECT MIN(created_at) AS since FROM user_activity_log WHERE user_id = $1', [req.user.id])
  ]);
  const sensCount = await pool.query(`SELECT COUNT(*)::int AS n ${base} AND (l.method = 'DELETE' OR l.label ~* '^(Annulation|Suppression|Réinitialisation|Restauration|Rejet)')`, p);
  const hours = Array(24).fill(0); hour.rows.forEach(x => { hours[x.h] = x.n; });
  return {
    total: tot.rows[0].n, last_at: tot.rows[0].last_at, since: first.rows[0].since,
    by_module: mod.rows, by_day: day.rows.reverse(), by_hour: hours,
    sensitive: { count: sensCount.rows[0].n, latest: sens.rows }
  };
}

async function salesBlock(req, emp, days) {
  if (!emp) return null;
  const p = [emp.id, req.sid, days];
  const w = `s.employee_id = $1 AND s.station_id = $2 AND ($3::int = 0 OR s.sold_at >= now() - ($3::int || ' days')::interval)`;
  const [t, d, c] = await Promise.all([
    pool.query(`SELECT COUNT(*) FILTER (WHERE s.status = 'valide')::int AS n, COALESCE(SUM(s.total) FILTER (WHERE s.status = 'valide'), 0) AS total,
                       COUNT(*) FILTER (WHERE s.status = 'annule')::int AS cancelled FROM sales s WHERE ${w}`, p),
    pool.query(`SELECT to_char(s.sold_at::date, 'YYYY-MM-DD') AS d, COALESCE(SUM(s.total), 0) AS total, COUNT(*)::int AS n FROM sales s WHERE ${w} AND s.status = 'valide' GROUP BY 1 ORDER BY 1 DESC LIMIT 60`, p),
    pool.query(`SELECT COALESCE(SUM(l.amount), 0) AS credit FROM customer_ledger l JOIN sales s ON l.ref_table = 'sales' AND l.ref_id = s.id WHERE l.kind = 'credit' AND ${w} AND s.status = 'valide'`, p)
  ]);
  const n = t.rows[0].n, total = num(t.rows[0].total);
  return { count: n, total, cancelled: t.rows[0].cancelled, average: n ? Math.round(total / n) : 0, credit_total: num(c.rows[0].credit), by_day: d.rows.reverse().map(x => ({ d: x.d, total: num(x.total), n: x.n })) };
}

async function shiftsBlock(req, emp, days) {
  const out = { worked: null, as_manager: 0, closed: 0 };
  const w = `($3::int = 0 OR sh.shift_date >= (now() - ($3::int || ' days')::interval)::date)`;
  if (emp) {
    const { rows: [x] } = await pool.query(
      `SELECT COUNT(DISTINCT sh.id)::int AS n FROM shifts sh
        WHERE sh.station_id = $2 AND ${w}
          AND (EXISTS (SELECT 1 FROM shift_employees se WHERE se.shift_id = sh.id AND se.employee_id = $1)
            OR EXISTS (SELECT 1 FROM shift_employee_pumps sp WHERE sp.shift_id = sh.id AND sp.employee_id = $1))`, [emp.id, req.sid, days]);
    out.worked = x.n;
  }
  const { rows: [m] } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE sh.manager_id = $1)::int AS m, COUNT(*) FILTER (WHERE sh.closed_by = $1)::int AS c
       FROM shifts sh WHERE sh.station_id = $2 AND ${w}`, [req.user.id, req.sid, days]);
  out.as_manager = m.m; out.closed = m.c;
  return out;
}

async function gapsBlock(req, emp, days) {
  if (!emp) return null;
  const p = [emp.id, req.sid, days];
  const { rows } = await pool.query(
    `SELECT g.kind, g.status, COUNT(*)::int AS n, COALESCE(SUM(g.amount), 0) AS total
       FROM employee_gaps g WHERE g.employee_id = $1 AND g.station_id = $2 AND ($3::int = 0 OR g.created_at >= now() - ($3::int || ' days')::interval)
      GROUP BY g.kind, g.status ORDER BY g.kind, g.status`, p);
  const { rows: [a] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM shift_anomalies an JOIN shifts sh ON sh.id = an.shift_id
      WHERE an.employee_id = $1 AND sh.station_id = $2 AND ($3::int = 0 OR an.created_at >= now() - ($3::int || ' days')::interval)`, p);
  return { rows: rows.map(x => ({ kind: x.kind, status: x.status, n: x.n, total: num(x.total) })), anomalies: a.n,
    open: rows.filter(x => x.status === 'en_attente' || x.status === 'conteste').reduce((s, x) => s + x.n, 0) };
}

async function myNameBlock(req, emp, days) {
  if (!emp) return null;
  const { rows: [x] } = await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE NOT self_made)::int AS by_others,
            COUNT(*) FILTER (WHERE status = 'rejete')::int AS rejected,
            COUNT(*) FILTER (WHERE status = 'rejete' AND review_note IS NULL)::int AS awaiting_reply
       FROM employee_actions WHERE employee_id = $1 AND station_id = $2 AND ($3::int = 0 OR created_at >= now() - ($3::int || ' days')::interval)`, [emp.id, req.sid, days]);
  return x;
}

async function moneyBlock(req, days) {
  const p = [req.user.id, req.sid, days];
  const [ex, cm, cp, sm] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE created_by = $1 AND station_id = $2 AND deleted_at IS NULL AND ($3::int = 0 OR spent_on >= (now() - ($3::int || ' days')::interval)::date)`, p),
    pool.query(`SELECT COUNT(*) FILTER (WHERE m.kind = 'encaissement')::int AS in_n, COALESCE(SUM(m.amount) FILTER (WHERE m.kind = 'encaissement'), 0) AS in_total,
                       COUNT(*) FILTER (WHERE m.kind IN ('decaissement','depot_bancaire','retrait'))::int AS out_n, COALESCE(SUM(ABS(m.amount)) FILTER (WHERE m.kind IN ('decaissement','depot_bancaire','retrait')), 0) AS out_total
                  FROM cash_movements m JOIN cash_registers cr ON cr.id = m.cash_register_id
                 WHERE m.created_by = $1 AND cr.station_id = $2 AND ($3::int = 0 OR m.created_at >= now() - ($3::int || ' days')::interval)`, p),
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(cp.amount), 0) AS total FROM customer_payments cp JOIN customers cu ON cu.id = cp.customer_id
                 WHERE cp.created_by = $1 AND cu.station_id = $2 AND ($3::int = 0 OR cp.paid_at >= now() - ($3::int || ' days')::interval)`, p),
    pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE created_by = $1 AND station_id = $2 AND kind <> 'vente' AND ($3::int = 0 OR created_at >= now() - ($3::int || ' days')::interval)`, p)
  ]);
  return {
    expenses: { n: ex.rows[0].n, total: num(ex.rows[0].total) },
    cash: { in_n: cm.rows[0].in_n, in_total: num(cm.rows[0].in_total), out_n: cm.rows[0].out_n, out_total: num(cm.rows[0].out_total) },
    customer_payments: { n: cp.rows[0].n, total: num(cp.rows[0].total) },
    stock_moves: sm.rows[0].n
  };
}

r.get('/me/profile/summary', wrap(async (req, res) => {
  const days = periodDays(req.query.days);
  if (req.user.is_global || !req.sid) return res.json({ days, activity: await safely('activité', () => activityBlock(req, days)), employee: null });
  const emp = await safely('fiche employé', () => myEmployee(req));
  const [activity, sales, shifts, gaps, inMyName, money] = await Promise.all([
    safely('activité', () => activityBlock(req, days)), safely('ventes', () => salesBlock(req, emp, days)), safely('quarts', () => shiftsBlock(req, emp, days)),
    safely('écarts', () => gapsBlock(req, emp, days)), safely('actions à mon nom', () => myNameBlock(req, emp, days)), safely('mouvements', () => moneyBlock(req, days))
  ]);
  res.json({ days, employee: emp ? { id: emp.id, matricule: emp.matricule } : null, activity, sales, shifts, gaps, in_my_name: inMyName, money });
}));

// ---------------------------------------------------------------- journal unifié
const SOURCES = { trace: 'Journal des écritures', audit: 'Audit détaillé', a_mon_nom: 'Fait à mon nom' };

function journalSql() {
  // $1 user · $2 station · $3 employé · $4 depuis · $5 jusqu'à · $6 source · $7 module · $8 recherche · $9 limite · $10 décalage · $11 nom courant · $12 matricule
  return `
  WITH j AS (
    SELECT 'trace'::text AS source, l.id AS ref, l.created_at AS at, l.module, l.label AS action,
           CASE WHEN l.record_id IS NOT NULL THEN l.method || ' ' || l.route || ' · réf. ' || l.record_id ELSE l.method || ' ' || l.route END AS detail,
           l.record_id, COALESCE(l.user_name, $11) AS actor, COALESCE(l.matricule, $12) AS matricule, l.ip_address AS ip, NULL::numeric AS amount,
           'enregistré'::text AS status, FALSE AS can_reject
      FROM user_activity_log l WHERE l.user_id = $1 AND ($2::bigint IS NULL OR l.station_id = $2)
    UNION ALL
    SELECT 'audit', a.id, a.created_at, a.module, a.action,
           NULLIF(CONCAT_WS(' · ', CASE WHEN a.table_name IS NOT NULL THEN a.table_name || COALESCE(' #' || a.record_id, '') END,
             CASE WHEN a.old_value IS NOT NULL THEN 'avant : ' || LEFT(a.old_value::text, 160) END,
             CASE WHEN a.new_value IS NOT NULL THEN 'après : ' || LEFT(a.new_value::text, 160) END), ''),
           a.record_id, $11, $12, host(a.ip_address), NULL::numeric, 'enregistré', FALSE
      FROM audit_logs a WHERE a.user_id = $1 AND ($2::bigint IS NULL OR a.station_id = $2)
    UNION ALL
    SELECT 'a_mon_nom', ea.id, ea.created_at, 'Fait à mon nom', ea.description,
           NULLIF(CONCAT_WS(' · ', CASE WHEN ea.status = 'rejete' THEN 'Rejetée : ' || COALESCE(ea.rejected_reason, '') END,
                                  CASE WHEN ea.review_note IS NOT NULL THEN 'Réponse : ' || ea.review_note END), ''),
           ea.ref_id, COALESCE(NULLIF(TRIM(au.full_name), ''), au.login, 'Inconnu'), (SELECT e2.matricule FROM employees e2 WHERE e2.user_id = ea.performed_by AND e2.deleted_at IS NULL LIMIT 1), NULL::text, ea.amount,
           CASE WHEN ea.status = 'rejete' THEN 'rejetée' WHEN ea.self_made THEN 'fait par moi' ELSE 'fait par un tiers' END,
           (ea.status = 'actif' AND NOT ea.self_made)
      FROM employee_actions ea LEFT JOIN users au ON au.id = ea.performed_by
     WHERE ea.employee_id = $3::bigint AND ($2::bigint IS NULL OR ea.station_id = $2)
  )
  SELECT j.*, COUNT(*) OVER()::int AS total_rows FROM j
   WHERE j.at >= $4::date AND j.at < ($5::date + 1)
     AND ($6 = '' OR j.source = $6) AND ($7 = '' OR j.module = $7)
     AND ($8 = '' OR j.action ILIKE '%' || $8 || '%' OR COALESCE(j.detail, '') ILIKE '%' || $8 || '%' OR j.module ILIKE '%' || $8 || '%')
   ORDER BY j.at DESC, j.ref DESC LIMIT $9 OFFSET $10`;
}

function journalFilters(req) {
  const to = ymd(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);
  const from = ymd(req.query.from) ? req.query.from : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const source = SOURCES[req.query.source] ? String(req.query.source) : '';
  return { from, to, source, module: String(req.query.module || '').slice(0, 60), q: String(req.query.q || '').trim().slice(0, 60) };
}

async function whoAmI(req) {
  const { rows: [u] } = await pool.query(`SELECT COALESCE(NULLIF(TRIM(full_name), ''), login) AS name FROM users WHERE id = $1`, [req.user.id]);
  const emp = req.sid ? await safely('fiche employé', () => myEmployee(req)) : null;
  return { name: (u && u.name) || req.user.login, matricule: emp ? emp.matricule : null, employeeId: emp ? emp.id : null, position: emp ? emp.position : null };
}

async function loadJournal(req, f, limit, offset) {
  const me = await whoAmI(req);
  const { rows } = await pool.query(journalSql(), [req.user.id, req.sid || null, me.employeeId, f.from, f.to, f.source, f.module, f.q, limit, offset, me.name, me.matricule]);
  return { me, rows };
}

r.get('/me/profile/activity', wrap(async (req, res) => {
  const f = journalFilters(req);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200), offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const { rows } = await loadJournal(req, f, limit, offset);
  res.json({ filters: f, sources: SOURCES, limit, offset, total: rows.length ? rows[0].total_rows : 0,
    items: rows.map(({ total_rows, ...x }) => ({ ...x, ref: String(x.ref) })) });
}));

r.get('/me/profile/activity/modules', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT module, COUNT(*)::int AS n FROM user_activity_log WHERE user_id = $1 AND ($2::bigint IS NULL OR station_id = $2) GROUP BY module ORDER BY n DESC, module`, [req.user.id, req.sid || null]);
  res.json(rows);
}));

// ---------------------------------------------------------------- export PDF / Excel du journal personnel
r.get('/me/profile/activity/export', wrap(async (req, res) => {
  const fmt = String(req.query.format || 'pdf').toLowerCase();
  if (!['pdf', 'xlsx'].includes(fmt)) throw new HttpError(400, 'format=pdf|xlsx');
  if (!req.sid) throw new HttpError(400, 'Export disponible dans une station (en-tête X-Station-Id requis)');
  const docs = require('./docs');
  const f = journalFilters(req);
  const { me, rows } = await loadJournal(req, f, 5000, 0);
  const fmtAt = d => docs.fmtDate ? docs.fmtDate(d) : new Date(d).toLocaleString('fr-FR');
  const head = ['Date / heure', 'Source', 'Module', 'Action', 'Détail', 'Auteur', 'Matricule', 'Adresse IP', 'Statut'];
  const body = rows.map(x => [fmtAt(x.at), SOURCES[x.source] || x.source, x.module, x.action, x.detail || '', x.actor || me.name, x.matricule || '', x.ip || '', x.status || '']);
  const b = await docs.branding(req.sid);
  const who = `${me.name}${me.matricule ? ' · matricule ' + me.matricule : ''} · rôle ${req.user.role}`;
  const subtitle = `${who} · ${f.from} → ${f.to} · ${rows.length} ligne(s)` + (rows.length === 5000 ? ' (limité aux 5 000 plus récentes)' : '');
  const ref = `PROFIL-${(me.matricule || req.user.login || req.user.id).toString().replace(/[^\w-]/g, '')}-${f.to.replace(/-/g, '')}`;
  const notes = ['Document personnel : il ne contient que les actions de ' + me.name + (f.q ? ' — recherche : ' + f.q : '') + (f.module ? ' — module : ' + f.module : '') + (f.source ? ' — source : ' + SOURCES[f.source] : '')];
  await audit(pool, req, 'profil', `Export de mon journal d'activité (${fmt}) : ${rows.length} ligne(s)`, null);   // la sortie de données est elle-même tracée
  if (fmt === 'xlsx') {
    const buf = await docs.buildXlsx({ b, title: 'Journal d’activité personnel', subtitle, ref, sheets: [{ name: 'Journal', head, rows: body, notes }] });
    return docs.send(res, 'xlsx', buf, ref);
  }
  const buf = await docs.buildPdf({ b, title: 'JOURNAL D’ACTIVITÉ PERSONNEL', subtitle, ref, landscape: true,
    sections: [{ type: 'table', title: 'Actions et événements', head, rows: body }, { type: 'text', title: 'Note', text: notes[0] }],
    signatures: [{ label: me.name, name: me.name, function: me.position || req.user.role }] });
  docs.send(res, 'pdf', buf, ref);
}));

module.exports = r;
module.exports.journalSql = journalSql; module.exports.FOCUS = FOCUS; module.exports.groupOf = groupOf; module.exports.periodDays = periodDays;
