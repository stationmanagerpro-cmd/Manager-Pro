// Améliorations ops : dashboard jour J, déclarations, notifications e-mail, audit enrichi
const express = require('express');
const { z } = require('zod');
const { pool, wrap, need, body, audit, HttpError } = require('./core');
const { swallow, ignored } = require('./safe');
const { getSetting } = require('./admin');
const { sendMail } = require('./mailer');

const r = express.Router();

// ---------- 1. Dashboard Jour J ----------
r.get('/dashboard/jour', need('report.view', 'finance.view'), wrap(async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
  const s = req.sid;
  const q = (sql, p) => pool.query(sql, p).then(x => x.rows);

  const [sales, fuel, exp, low, cash, open, gaps, leavePend, drafts, alerts, period] = await Promise.all([
    q("SELECT COALESCE(SUM(total),0) AS total, COUNT(*)::int AS n FROM sales WHERE station_id=$1 AND status='valide' AND kind='produits' AND sold_at::date=$2::date", [s, day]),
    q(`SELECT COALESCE(SUM(m.liters),0) AS liters, COALESCE(SUM(m.amount),0) AS amount FROM meter_readings m
       JOIN shifts sh ON sh.id=m.shift_id WHERE sh.station_id=$1 AND sh.status='ferme' AND sh.closed_at::date=$2::date`, [s, day]),
    q('SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE station_id=$1 AND deleted_at IS NULL AND spent_on=$2::date', [s, day]),
    q('SELECT p.name, st.quantity, p.min_stock FROM products p JOIN stock st ON st.product_id=p.id WHERE p.station_id=$1 AND p.deleted_at IS NULL AND st.quantity<=p.min_stock LIMIT 20', [s]),
    q('SELECT id, name, balance FROM cash_registers WHERE station_id=$1 AND active', [s]),
    q("SELECT id, number, kind, opened_at FROM shifts WHERE station_id=$1 AND status='ouvert'", [s]),
    q("SELECT COUNT(*)::int AS n FROM employee_gaps WHERE station_id=$1 AND kind = 'caisse' AND status NOT IN ('cloture','regularise')", [s]).catch(swallow('ops_plus:cash_gaps', [{ n: 0 }])),
    q("SELECT COUNT(*)::int AS n FROM hr_leave_requests WHERE station_id=$1 AND status='demande'", [s]).catch(swallow('ops_plus:hr_leave_requests', [{ n: 0 }])),
    q("SELECT COUNT(*)::int AS n FROM payslips WHERE station_id=$1 AND status='brouillon'", [s]).catch(swallow('ops_plus:payslips', [{ n: 0 }])),
    q("SELECT id, level, kind, message, due_date FROM hr_alerts WHERE station_id=$1 AND status='open' ORDER BY id DESC LIMIT 15", [s]).catch(swallow('ops_plus:hr_alerts', [])),
    q(`SELECT status FROM payroll_periods WHERE station_id=$1 AND month=date_trunc('month', $2::date)::date`, [s, day]).catch(swallow('ops_plus:payroll_periods', []))
  ]);

  let contract = null;
  try {
    const { loadContractForUser } = require('./contracts');
    contract = await loadContractForUser(req.user.id, req.user.is_global);
  } catch (e) { ignored('ops_plus:contrat', e); }

  const alertsList = [];
  if (open.length) alertsList.push({ level: 'info', type: 'shift', message: `${open.length} quart(s) ouvert(s)` });
  if (low.length) alertsList.push({ level: 'warning', type: 'stock', message: `${low.length} produit(s) sous stock minimum` });
  if ((gaps[0] && gaps[0].n) > 0) alertsList.push({ level: 'warning', type: 'caisse', message: `${gaps[0].n} écart(s) de caisse non clôturé(s)` });
  if ((leavePend[0] && leavePend[0].n) > 0) alertsList.push({ level: 'info', type: 'rh', message: `${leavePend[0].n} demande(s) de congé en attente` });
  if ((drafts[0] && drafts[0].n) > 0) alertsList.push({ level: 'info', type: 'paie', message: `${drafts[0].n} bulletin(s) en brouillon` });
  if (period[0] && period[0].status === 'cloture') alertsList.push({ level: 'info', type: 'paie', message: 'Période de paie du mois clôturée' });
  if (contract && !contract.unrestricted && contract.quotas) {
    if (contract.quotas.stations?.at_limit) alertsList.push({ level: 'critical', type: 'contrat', message: 'Limite de stations atteinte' });
    if (contract.quotas.users?.at_limit) alertsList.push({ level: 'critical', type: 'contrat', message: 'Limite d\'utilisateurs atteinte' });
    if (contract.suspended) alertsList.push({ level: 'critical', type: 'contrat', message: 'Contrat suspendu ou expiré' });
  }
  for (const a of (alerts || [])) {
    alertsList.push({ level: a.level || 'info', type: a.kind || 'rh', message: a.message, due_date: a.due_date });
  }

  res.json({
    date: day,
    kpis: {
      product_sales: sales[0]?.total || 0,
      product_count: sales[0]?.n || 0,
      fuel_liters: fuel[0]?.liters || 0,
      fuel_amount: fuel[0]?.amount || 0,
      expenses: exp[0]?.total || 0,
      cash_registers: cash,
      open_shifts: open
    },
    // P4 — périmètres explicites pour éviter les divergences d'interprétation UI
    scope: {
      product_sales: 'sales kind=produits, status=valide, sold_at::date = jour',
      fuel: 'meter_readings des quarts fermés (closed_at::date = jour) uniquement ; quarts ouverts exclus',
      expenses: 'expenses.spent_on = jour, non supprimées',
      cash_registers: 'soldes instantanés (non filtrés par date)',
      note: 'Le CA fuel n’apparaît qu’après clôture de quart. Le stock cuve n’est diminué qu’à la clôture.'
    },
    low_stock: low,
    alerts: alertsList,
    hr_alerts: alerts || [],
    contract_quotas: contract && !contract.unrestricted ? contract.quotas : null,
    payroll_period: period[0]?.status || 'ouvert'
  });
}));

// ---------- 2. Pack déclarations sociales / fiscales ----------
r.get('/hr/declarations', need('hr.payroll', 'hr.manage', 'report.view'), wrap(async (req, res) => {
  const month = req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month + '-01'
    : new Date().toISOString().slice(0, 7) + '-01';
  const format = (req.query.format || 'json').toLowerCase();

  // Requête complète (migrations 006–009). Colonnes réelles : payslips.gross (exposée sous le nom gross_pay),
  // employees.inps_number (exposé sous cnss_number) ; aucun champ NIN n'existe dans le schéma (colonne laissée vide).
  // Repli si schéma partiel : colonnes fiscales absentes → 0 / null, page utilisable.
  let slips = [];
  let schemaNote = null;
  try {
    const full = await pool.query(
      `SELECT p.number, p.status, p.gross AS gross_pay, p.net_pay,
              COALESCE(p.its_amount, 0) AS its_amount,
              COALESCE(p.inps_employee, 0) AS inps_employee,
              COALESCE(p.inps_employer, 0) AS inps_employer,
              COALESCE(p.amo_employee, 0) AS amo_employee,
              COALESCE(p.amo_employer, 0) AS amo_employer,
              COALESCE(p.employer_charges_total, 0) AS employer_charges_total,
              e.matricule, e.first_name, e.last_name,
              NULL::text AS nin, e.inps_number AS cnss_number
       FROM payslips p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.station_id = $1 AND p.month = $2::date AND p.status IN ('valide','paye')
       ORDER BY e.last_name, e.first_name`,
      [req.sid, month]
    );
    slips = full.rows;
  } catch (e) {
    if (e.code !== '42703' && e.code !== '42P01') throw e;
    // Table payslips absente ou colonnes fiscales / NIN manquantes
    try {
      const basic = await pool.query(
        `SELECT p.number, p.status, p.gross AS gross_pay, p.net_pay,
                0::numeric AS its_amount, 0::numeric AS inps_employee, 0::numeric AS inps_employer,
                0::numeric AS amo_employee, 0::numeric AS amo_employer, 0::numeric AS employer_charges_total,
                e.matricule, e.first_name, e.last_name,
                NULL::text AS nin, NULL::text AS cnss_number
         FROM payslips p
         JOIN employees e ON e.id = p.employee_id
         WHERE p.station_id = $1 AND p.month = $2::date AND p.status IN ('valide','paye')
         ORDER BY e.last_name, e.first_name`,
        [req.sid, month]
      );
      slips = basic.rows;
      schemaNote = 'Schéma paie partiel : colonnes ITS/INPS/AMO ou NIN/CNSS absentes. Affichage en mode basique (totaux sociaux à 0). Exécutez les migrations 006–009 (et colonnes employé) après sauvegarde.';
    } catch (e2) {
      if (e2.code === '42P01') {
        // Pas de table payslips du tout
        slips = [];
        schemaNote = 'Table payslips absente : aucune déclaration calculable. Appliquez les migrations RH/paie (003+) après sauvegarde, sans réinitialiser la base.';
      } else if (e2.code === '42703') {
        // Même le minimal échoue (ex. gross_pay renommé) — liste vide + note
        slips = [];
        schemaNote = 'Schéma payslips incompatible avec cette version. Consultez les journaux serveur et schema_migrations ; ne réinitialisez pas la base.';
      } else throw e2;
    }
  }

  const sum = (k) => slips.reduce((a, x) => a + Number(x[k] || 0), 0);
  const summary = {
    month: month.slice(0, 7),
    employees: slips.length,
    gross_total: sum('gross_pay'),
    net_total: sum('net_pay'),
    its_total: sum('its_amount'),
    inps_employee_total: sum('inps_employee'),
    inps_employer_total: sum('inps_employer'),
    amo_employee_total: sum('amo_employee'),
    amo_employer_total: sum('amo_employer'),
    employer_charges_total: sum('employer_charges_total'),
    note: 'Agrégats issus des bulletins validés/payés uniquement. Vérifiez les taux légaux avant dépôt officiel.',
    schema_note: schemaNote
  };

  if (format === 'csv') {
    const head = ['matricule', 'nom', 'prenom', 'nin', 'cnss', 'brut', 'its', 'inps_salarie', 'inps_employeur', 'amo_salarie', 'amo_employeur', 'charges_patronales', 'net', 'statut'];
    const lines = [head.join(';')];
    for (const s of slips) {
      lines.push([
        s.matricule, s.last_name, s.first_name, s.nin || '', s.cnss_number || '',
        s.gross_pay, s.its_amount, s.inps_employee, s.inps_employer,
        s.amo_employee, s.amo_employer, s.employer_charges_total, s.net_pay, s.status
      ].join(';'));
    }
    lines.push('');
    lines.push(['TOTAL', '', '', '', '', summary.gross_total, summary.its_total, summary.inps_employee_total, summary.inps_employer_total, summary.amo_employee_total, summary.amo_employer_total, summary.employer_charges_total, summary.net_total, ''].join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="declarations-${summary.month}.csv"`);
    return res.send('\uFEFF' + lines.join('\n'));
  }

  res.json({ summary, lines: slips });
}));

// ---------- 3. Notifications e-mail (scan + envoi) ----------
async function buildNotificationCandidates(stationId) {
  const items = [];
  const { rows: low } = await pool.query(
    `SELECT p.name, st.quantity, p.min_stock FROM products p JOIN stock st ON st.product_id=p.id
     WHERE p.station_id=$1 AND p.deleted_at IS NULL AND st.quantity <= p.min_stock LIMIT 30`, [stationId]
  );
  if (low.length) {
    items.push({
      kind: 'stock',
      level: 'warning',
      title: 'Stock bas',
      message: low.map(x => `${x.name}: ${x.quantity}/${x.min_stock}`).join(' ; ')
    });
  }

  const { rows: drafts } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM payslips WHERE station_id=$1 AND status='brouillon'`, [stationId]
  ).catch(swallow('ops_plus:196', { rows: [{ n: 0 }] }));
  if (drafts[0]?.n > 0) {
    items.push({ kind: 'paie', level: 'info', title: 'Bulletins brouillon', message: `${drafts[0].n} bulletin(s) en attente de validation` });
  }

  // Contrats clients liés aux stations
  const { rows: clients } = await pool.query(
    `SELECT c.name, ct.end_date, ct.status FROM stations s
     JOIN clients c ON c.id = s.client_id
     JOIN client_contracts ct ON ct.client_id = c.id
     WHERE s.id = $1`, [stationId]
  ).catch(swallow('ops_plus:207', { rows: [] }));
  for (const cl of clients) {
    if (cl.status === 'expire' || cl.status === 'suspendu') {
      items.push({ kind: 'contrat', level: 'critical', title: 'Contrat', message: `${cl.name}: statut ${cl.status}` });
    } else if (cl.end_date) {
      const days = Math.ceil((new Date(cl.end_date) - new Date()) / 86400000);
      if (days <= 30) items.push({ kind: 'contrat', level: 'warning', title: 'Expiration contrat', message: `${cl.name} expire dans ${days} j (${String(cl.end_date).slice(0, 10)})` });
    }
  }

  const { rows: leave } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM hr_leave_requests WHERE station_id=$1 AND status='demande'`, [stationId]
  ).catch(swallow('ops_plus:219', { rows: [{ n: 0 }] }));
  if (leave[0]?.n > 0) {
    items.push({ kind: 'rh', level: 'info', title: 'Congés', message: `${leave[0].n} demande(s) en attente` });
  }

  return items;
}

r.post('/notifications/scan', need('settings.edit', 'user.manage'), wrap(async (req, res) => {
  // Déduplication métier : même station + kind + message exact dans les 24 h → pas de doublon.
  // Aligné sur sendSystemAlert (fenêtre 24 h). Les scans répétés ne gonflent plus le centre d'alertes.
  const items = await buildNotificationCandidates(req.sid);
  let created = 0;
  let skipped = 0;
  const results = [];
  for (const it of items) {
    const message = `${it.title}: ${it.message}`;
    const kind = it.kind || 'info';
    const level = it.level || 'info';
    const { rows: [dup] } = await pool.query(
      `SELECT id FROM notifications
        WHERE station_id = $1 AND kind = $2 AND message = $3
          AND created_at > now() - interval '24 hours'
        LIMIT 1`,
      [req.sid, kind, message]
    );
    if (dup) {
      skipped++;
      results.push({ ...it, status: 'duplicate', existing_id: dup.id });
      continue;
    }
    await pool.query(
      `INSERT INTO notifications(station_id, kind, level, message) VALUES ($1,$2,$3,$4)`,
      [req.sid, kind, level, message]
    );
    created++;
    results.push({ ...it, status: 'created' });
  }
  await audit(pool, req, 'notifications', `Scan alertes (${created} créées, ${skipped} déjà signalées 24h)`, 'notifications', null, null, { created, skipped });
  res.json({ created, skipped, items: results });
}));

r.post('/notifications/email-digest', need('user.manage'), body(z.object({
  to: z.string().email().optional()
}).optional()), wrap(async (req, res) => {
  const items = await buildNotificationCandidates(req.sid);

  let to = req.body?.to;
  if (!to) {
    const { rows: [st] } = await pool.query('SELECT email FROM stations WHERE id=$1', [req.sid]);
    to = st?.email || process.env.NOTIFY_EMAIL;
  }
  if (!to) throw new HttpError(400, 'Aucun destinataire (body.to, email station ou NOTIFY_EMAIL).');

  const appName = (await require('./branding').load().catch(swallow('ops_plus:273', null)))?.name || 'Manager PRO';
  const day = new Date().toISOString().slice(0, 10);
  const sections = [`Digest direction — ${day}`, ''];

  try {
    const { rows: [rev] } = await pool.query(
      `SELECT COALESCE(SUM(total),0)::float AS product_sales FROM sales
       WHERE station_id=$1 AND status='valide' AND sold_at::date = CURRENT_DATE`, [req.sid]);
    let fuel = { fuel_amount: 0, fuel_liters: 0 };
    try {
      const fr = await pool.query(
        `SELECT COALESCE(SUM(amount),0)::float AS fuel_amount, COALESCE(SUM(liters),0)::float AS fuel_liters
         FROM fuel_sales WHERE station_id=$1 AND sold_at::date = CURRENT_DATE`, [req.sid]);
      fuel = fr.rows[0] || fuel;
    } catch (_) { /* table optionnelle */ }
    let expenses = 0;
    try {
      const er = await pool.query(
        `SELECT COALESCE(SUM(amount),0)::float AS expenses FROM expenses
         WHERE station_id=$1 AND deleted_at IS NULL AND spent_on = CURRENT_DATE`, [req.sid]);
      expenses = er.rows[0]?.expenses || 0;
    } catch (e) { ignored('ops_plus:depenses-jour', e); }
    const { rows: [osh] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM shifts WHERE station_id=$1 AND status='ouvert'`, [req.sid]);
    sections.push('INDICATEURS DU JOUR');
    sections.push(`• Ventes produits : ${Number(rev?.product_sales || 0).toLocaleString('fr-FR')}`);
    sections.push(`• Carburant : ${Number(fuel?.fuel_amount || 0).toLocaleString('fr-FR')} (${Number(fuel?.fuel_liters || 0).toLocaleString('fr-FR')} L)`);
    sections.push(`• Dépenses : ${Number(expenses || 0).toLocaleString('fr-FR')}`);
    sections.push(`• Quarts ouverts : ${osh?.n || 0}`);
    sections.push('');
  } catch (e) {
    sections.push('(Indicateurs partiellement indisponibles)', '');
  }

  if (items.length) {
    sections.push('ALERTES');
    sections.push(...items.map(i => `• [${i.level}] ${i.title}: ${i.message}`));
  } else {
    sections.push('Aucune alerte stock / caisse à signaler.');
  }
  sections.push('', `— ${appName}`);

  await sendMail({
    to,
    subject: `Digest direction ${appName} — ${day}`,
    text: sections.join('\n')
  });
  await audit(pool, req, 'notifications', `Digest e-mail direction → ${to}`, 'notifications', null, null, { to, count: items.length });
  res.json({ sent: true, to, count: items.length, items, kpis: true });
}));

// ---------- 4. Audit filtrable ----------
r.get('/audit/search', need('audit.view'), wrap(async (req, res) => {
  const limit = Math.min(+req.query.limit || 100, 500);
  const offset = +req.query.offset || 0;
  const params = [req.sid];
  const where = ['a.station_id = $1'];
  if (req.query.module) { params.push(req.query.module); where.push(`a.module = $${params.length}`); }
  if (req.query.user_id) { params.push(+req.query.user_id); where.push(`a.user_id = $${params.length}`); }
  if (req.query.login) { params.push(req.query.login); where.push(`u.login ILIKE $${params.length}`); }
  if (req.query.from) { params.push(req.query.from); where.push(`a.created_at >= $${params.length}::date`); }
  if (req.query.to) { params.push(req.query.to); where.push(`a.created_at < $${params.length}::date + 1`); }
  if (req.query.q) { params.push('%' + req.query.q + '%'); where.push(`(a.action ILIKE $${params.length} OR a.table_name ILIKE $${params.length})`); }
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT a.*, u.login FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: [cnt] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(' AND ')}`,
    params.slice(0, -2)
  );
  res.json({ total: cnt.n, limit, offset, lines: rows });
}));

r.get('/audit/modules', need('audit.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT module, COUNT(*)::int AS n FROM audit_logs WHERE station_id=$1 GROUP BY module ORDER BY n DESC`,
    [req.sid]
  );
  res.json(rows);
}));


// ---------- Priorité 8 — Centre d'alertes unifié ----------
r.get('/alerts/center', wrap(async (req, res) => {
  const s = req.sid;
  const items = [];
  const push = (x) => items.push({
    source: x.source,
    type: x.type,
    level: x.level || 'info',
    message: x.message,
    module: x.module || x.source,
    ref_table: x.ref_table || null,
    ref_id: x.ref_id || null,
    user_concerned: x.user_concerned || null,
    employee_id: x.employee_id || null,
    status: x.status || 'open',
    created_at: x.created_at || null,
    id: x.id || null
  });

  // Notifications système
  const { rows: notifs } = await pool.query(
    `SELECT id, level, kind, message, ref_table, ref_id, read_at, created_at
     FROM notifications WHERE station_id = $1 AND read_at IS NULL
     ORDER BY id DESC LIMIT 50`, [s]
  ).catch(swallow('ops_plus:384', { rows: [] }));
  for (const n of notifs) {
    const typeMap = {
      stock: 'STOCK', stock_critique: 'STOCK', ecart_caisse: 'ECART', anomalie: 'ERREUR',
      contrat: 'SYSTEME', paie: 'PAIEMENT', rh: 'SYSTEME'
    };
    push({
      source: 'notifications', id: n.id, type: typeMap[n.kind] || 'SYSTEME',
      level: n.level, message: n.message, module: n.kind,
      ref_table: n.ref_table, ref_id: n.ref_id, status: n.read_at ? 'done' : 'open',
      created_at: n.created_at
    });
  }

  // Alertes RH
  const { rows: hr } = await pool.query(
    `SELECT a.id, a.level, a.kind, a.message, a.due_date, a.status, a.employee_id, a.created_at,
            e.first_name || ' ' || e.last_name AS employee
     FROM hr_alerts a LEFT JOIN employees e ON e.id = a.employee_id
     WHERE a.station_id = $1 AND a.status = 'open' ORDER BY a.id DESC LIMIT 40`, [s]
  ).catch(swallow('ops_plus:404', { rows: [] }));
  for (const a of hr) {
    push({
      source: 'hr_alerts', id: a.id, type: 'SYSTEME', level: a.level || 'info',
      message: a.message + (a.employee ? ` (${a.employee})` : ''),
      module: 'rh', employee_id: a.employee_id, user_concerned: a.employee,
      status: a.status, created_at: a.created_at
    });
  }

  // Écarts employés
  const { rows: gaps } = await pool.query(
    `SELECT g.id, g.kind, g.amount, g.status, g.employee_id, g.created_at,
            e.first_name || ' ' || e.last_name AS employee
     FROM employee_gaps g LEFT JOIN employees e ON e.id = g.employee_id
     WHERE g.station_id = $1 AND g.status NOT IN ('cloture')
     ORDER BY g.id DESC LIMIT 30`, [s]
  ).catch(swallow('ops_plus:421', { rows: [] }));
  for (const g of gaps) {
    push({
      source: 'employee_gaps', id: g.id, type: 'ECART', level: 'warning',
      message: `Écart ${g.kind} : ${g.amount}` + (g.employee ? ` — ${g.employee}` : ''),
      module: 'caisse', employee_id: g.employee_id, user_concerned: g.employee,
      status: g.status, created_at: g.created_at, ref_table: 'employee_gaps', ref_id: g.id
    });
  }

  // Stock bas
  const { rows: low } = await pool.query(
    `SELECT p.id, p.name, st.quantity, p.min_stock FROM products p
     JOIN stock st ON st.product_id = p.id
     WHERE p.station_id = $1 AND p.deleted_at IS NULL AND st.quantity <= p.min_stock LIMIT 20`, [s]
  ).catch(swallow('ops_plus:436', { rows: [] }));
  for (const p of low) {
    push({
      source: 'stock', id: p.id, type: 'STOCK', level: 'warning',
      message: `Stock bas : ${p.name} (${p.quantity}/${p.min_stock})`,
      module: 'stock', ref_table: 'products', ref_id: p.id, status: 'open'
    });
  }

  // Créances élevées (clients balance > credit_limit si limit > 0)
  const { rows: debtors } = await pool.query(
    `SELECT id, name, balance, credit_limit FROM customers
     WHERE station_id = $1 AND deleted_at IS NULL AND balance > 0
       AND (credit_limit = 0 OR balance >= credit_limit)
     ORDER BY balance DESC LIMIT 15`, [s]
  ).catch(swallow('ops_plus:451', { rows: [] }));
  for (const c of debtors) {
    push({
      source: 'customers', id: c.id, type: 'DETTE', level: c.credit_limit > 0 && c.balance >= c.credit_limit ? 'critical' : 'info',
      message: `Créance client ${c.name} : ${c.balance}` + (c.credit_limit ? ` (limite ${c.credit_limit})` : ''),
      module: 'clients', ref_table: 'customers', ref_id: c.id, status: 'open'
    });
  }

  // Dettes fournisseurs
  const { rows: supp } = await pool.query(
    `SELECT id, name, balance_due FROM suppliers
     WHERE station_id = $1 AND deleted_at IS NULL AND balance_due > 0
     ORDER BY balance_due DESC LIMIT 10`, [s]
  ).catch(swallow('ops_plus:465', { rows: [] }));
  for (const srow of supp) {
    push({
      source: 'suppliers', id: srow.id, type: 'DETTE', level: 'info',
      message: `Dette fournisseur ${srow.name} : ${srow.balance_due}`,
      module: 'fournisseurs', ref_table: 'suppliers', ref_id: srow.id, status: 'open'
    });
  }

  // Le journal des sauvegardes est global à la plateforme, pas isolé par station.
  // Ne jamais l'inclure dans le centre d'alertes des comptes clients.
  if (req.user.is_global) {
    const { rows: bakFail } = await pool.query(
      `SELECT id, kind, error_message, started_at, finished_at FROM backup_logs
       WHERE status = 'failed' AND started_at > now() - interval '7 days'
       ORDER BY started_at DESC LIMIT 10`
    ).catch(swallow('ops_plus:481', { rows: [] }));
    for (const b of bakFail) {
      push({
        source: 'backup_logs', id: b.id, type: 'SAUVEGARDE', level: 'critical',
        message: `Échec sauvegarde ${b.kind || ''} : ${b.error_message || 'erreur'}`,
        module: 'sauvegarde', status: 'open', created_at: b.finished_at || b.started_at
      });
    }
  }

  // Bulletins brouillon
  const { rows: drafts } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM payslips WHERE station_id = $1 AND status = 'brouillon'`, [s]
  ).catch(swallow('ops_plus:494', { rows: [{ n: 0 }] }));
  if (drafts[0]?.n > 0) {
    push({
      source: 'payroll', type: 'PAIEMENT', level: 'info',
      message: `${drafts[0].n} bulletin(s) de paie en brouillon`,
      module: 'paie', status: 'open'
    });
  }

  // Filtrage selon rôle : employé non gérant ne voit que ce qui le concerne (si employee lié)
  // Simplification : CAISSIER/POMPISTE voient stock+caisse+leurs écarts ; GERANT/ADMIN voient tout
  let filtered = items;
  const role = req.user.role;
  if (!req.user.is_global && !['ADMIN', 'GERANT', 'SUPERVISEUR', 'COMPTABLE'].includes(role)) {
    filtered = items.filter(i =>
      ['STOCK', 'CAISSE', 'ECART', 'COMPTEUR'].includes(i.type) ||
      (i.employee_id && false) // sans lien user↔employee fiable : limiter aux types ops
    );
  }

  const byLevel = { critical: 0, warning: 0, info: 0, error: 0 };
  for (const i of filtered) {
    const lv = i.level === 'critical' ? 'critical' : i.level === 'warning' ? 'warning' : i.level === 'error' ? 'error' : 'info';
    byLevel[lv] = (byLevel[lv] || 0) + 1;
  }

  res.json({
    count: filtered.length,
    by_level: byLevel,
    items: filtered.sort((a, b) => {
      const rank = { critical: 0, error: 1, warning: 2, info: 3 };
      return (rank[a.level] ?? 9) - (rank[b.level] ?? 9);
    }),
    types: ['ERREUR', 'ECART', 'DETTE', 'AVANCE', 'PAIEMENT', 'STOCK', 'COMPTEUR', 'CAISSE', 'SAUVEGARDE', 'SECURITE', 'SYSTEME'],
    note: 'Centre d\'alertes P8 — agrégation multi-sources, isolation par station.'
  });
}));

r.post('/alerts/center/:source/:id/ack', wrap(async (req, res) => {
  const { source, id } = req.params;
  if (source === 'notifications') {
    await pool.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND station_id = $2', [id, req.sid]);
  } else if (source === 'hr_alerts') {
    await pool.query(`UPDATE hr_alerts SET status = 'done' WHERE id = $1 AND station_id = $2`, [id, req.sid]).catch(() => {});
  } else {
    return res.status(400).json({ error: 'Source non acquittable directement : ' + source });
  }
  await audit(pool, req, 'alertes', `Acquittement ${source} #${id}`, source, +id);
  res.json({ ok: true });
}));


/** PDF fin de journée — synthèse station (serveur). */
r.get('/reports/eod.pdf', need('report.view', 'finance.view', 'shift.close'), wrap(async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
    ? String(req.query.date)
    : new Date().toISOString().slice(0, 10);
  const sid = req.sid;
  const docs = require('./docs');

  const [sales, fuel, exp, shifts, low, st] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(total),0)::float AS total, COUNT(*)::int AS n FROM sales
       WHERE station_id=$1 AND status='valide' AND sold_at::date=$2::date`, [sid, day]),
    pool.query(
      `SELECT COALESCE(SUM(m.amount),0)::float AS amount, COALESCE(SUM(m.liters),0)::float AS liters
         FROM meter_readings m
         JOIN shifts sh ON sh.id = m.shift_id
        WHERE sh.station_id=$1 AND sh.status='ferme'
          AND sh.closed_at::date=$2::date`, [sid, day]
    ).catch(swallow('ops_plus:564', { rows: [{ amount: 0, liters: 0 }] })),
    pool.query(
      `SELECT COALESCE(SUM(amount),0)::float AS total FROM expenses
       WHERE station_id=$1 AND deleted_at IS NULL AND spent_on=$2::date`, [sid, day]
    ).catch(swallow('ops_plus:568', { rows: [{ total: 0 }] })),
    pool.query(
      `SELECT number, kind, status, opened_at, closed_at, cash_gap, theoretical_cash, counted_cash
       FROM shifts WHERE station_id=$1
         AND (opened_at::date=$2::date OR closed_at::date=$2::date)
       ORDER BY opened_at`, [sid, day]),
    pool.query(
      `SELECT p.name, st.quantity, p.min_stock FROM products p
       JOIN stock st ON st.product_id=p.id
       WHERE p.station_id=$1 AND p.deleted_at IS NULL AND p.min_stock>0 AND st.quantity<=p.min_stock
       ORDER BY p.name LIMIT 30`, [sid]),
    pool.query(`SELECT name, currency FROM stations WHERE id=$1`, [sid])
  ]);

  const b = await docs.branding(sid);
  const product_sales = sales.rows[0]?.total || 0;
  const fuel_amount = fuel.rows[0]?.amount || 0;
  const fuel_liters = fuel.rows[0]?.liters || 0;
  const expenses = exp.rows[0]?.total || 0;
  const stationName = st.rows[0]?.name || 'Station';

  const kpiRows = [
    ['Ventes produits', product_sales],
    ['Carburant (montant)', fuel_amount],
    ['Carburant (litres)', fuel_liters],
    ['Dépenses', expenses],
    ['Résultat brut (ventes+fuel - dépenses)', product_sales + fuel_amount - expenses]
  ];

  const shiftRows = (shifts.rows || []).map(x => [
    x.number, x.kind, x.status,
    x.closed_at ? docs.fmtDate(x.closed_at) : '—',
    Number(x.cash_gap || 0)
  ]);

  const lowRows = (low.rows || []).map(x => [x.name, Number(x.quantity), Number(x.min_stock)]);

  const buf = await docs.buildPdf({
    b,
    title: 'RAPPORT FIN DE JOURNEE',
    subtitle: `${stationName} — ${day}`,
    ref: `EOD-${day.replace(/-/g, '')}`,
    sections: [
      { type: 'table', title: 'Indicateurs', head: ['Indicateur', 'Valeur'], rows: kpiRows, sumCols: [] },
      { type: 'table', title: 'Quarts du jour', head: ['N°', 'Type', 'Statut', 'Fermeture', 'Écart caisse'], rows: shiftRows, sumCols: [4] },
      { type: 'table', title: 'Stock sous minimum', head: ['Produit', 'Qté', 'Min'], rows: lowRows, sumCols: [] }
    ],
    signatures: [{ label: 'Gérant' }, { label: 'Contrôle' }]
  });
  docs.send(res, 'pdf', buf, `fin-journee-${day}`);
}));



/** Période (du … au …) validée : jours inclus. Retourne null si ni from ni to ; lève 400 si incomplète, invalide ou inversée. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseRange(q) {
  const from = String(q.from || ''), to = String(q.to || '');
  if (!from && !to) return null;
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) throw new HttpError(400, 'Période invalide : renseignez la date de début ET la date de fin (AAAA-MM-JJ)');
  if (from > to) throw new HttpError(400, 'La date de début ne peut pas être postérieure à la date de fin');
  return { from, to };
}
const eachDay = (from, to) => { const out = []; for (let t = Date.parse(from + 'T00:00:00Z'), e = Date.parse(to + 'T00:00:00Z'); t <= e; t += 864e5) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;

/** Rapprochement pompes / ventes / caisse (lecture seule, gratuit) pour un jour (?date=) ou une période (?from=&to=, jours inclus).
 *  Mode « jour » inchangé (les quarts encore ouverts sont toujours listés) ; mode « période » strict : uniquement les quarts ouverts ou fermés dans la période. */
r.get('/reports/reconciliation', need('report.view', 'finance.view', 'shift.close'), wrap(async (req, res) => {
  const range = parseRange(req.query);
  const day = DAY_RE.test(String(req.query.date || '')) ? String(req.query.date) : new Date().toISOString().slice(0, 10);
  const from = range ? range.from : day, to = range ? range.to : day;
  const sid = req.sid;

  const { rows: shifts } = await pool.query(
    `SELECT id, number, kind, status, opened_at, closed_at,
            opening_cash, theoretical_cash, counted_cash, cash_gap
     FROM shifts WHERE station_id=$1
       AND (opened_at::date BETWEEN $2::date AND $3::date OR closed_at::date BETWEEN $2::date AND $3::date OR ($4::boolean AND status='ouvert'))
     ORDER BY opened_at`, [sid, from, to, !range]);

  const { rows: meters } = await pool.query(
    `SELECT sh.id AS shift_id, sh.number AS shift_number, p.name AS product, m.liters, m.amount,
            m.index_start, m.index_end
       FROM meter_readings m
       JOIN shifts sh ON sh.id = m.shift_id
       JOIN products p ON p.id = m.product_id
      WHERE sh.station_id=$1 AND sh.closed_at::date BETWEEN $2::date AND $3::date
      ORDER BY sh.closed_at, sh.number, p.name`, [sid, from, to]).catch(swallow('ops_plus:643', { rows: [] }));

  const { rows: [salesAgg] } = await pool.query(
    `SELECT COALESCE(SUM(total),0)::float AS product_sales, COUNT(*)::int AS n
       FROM sales WHERE station_id=$1 AND status='valide' AND sold_at::date BETWEEN $2::date AND $3::date`, [sid, from, to]);

  const { rows: payByMethod } = await pool.query(
    `SELECT COALESCE(pm.kind, p.method) AS kind, COALESCE(pm.label, p.method) AS label,
            SUM(p.amount)::float AS amount
       FROM payments p
       LEFT JOIN sales s ON s.id = p.sale_id
       LEFT JOIN payment_methods pm ON pm.station_id = p.station_id AND pm.code = p.method
      WHERE p.station_id=$1 AND p.paid_at::date BETWEEN $2::date AND $3::date
        AND (s.id IS NULL OR s.status='valide')
      GROUP BY 1, 2 ORDER BY 3 DESC`, [sid, from, to]).catch(swallow('ops_plus:657', { rows: [] }));

  const { rows: [exp] } = await pool.query(
    `SELECT COALESCE(SUM(amount),0)::float AS total FROM expenses
      WHERE station_id=$1 AND deleted_at IS NULL AND spent_on BETWEEN $2::date AND $3::date`, [sid, from, to]).catch(swallow('ops_plus:661', { rows: [{ total: 0 }] }));

  const liters = meters.reduce((a, x) => a + Number(x.liters || 0), 0);
  const fuel_amount = meters.reduce((a, x) => a + Number(x.amount || 0), 0);
  const cash_gaps = shifts.filter(s => s.status === 'ferme' && s.cash_gap != null);
  const total_gap = cash_gaps.reduce((a, s) => a + Number(s.cash_gap || 0), 0);

  // Opérations (un quart = une opération de rapprochement) : rapproché (caisse comptée, écart nul), avec écart, non rapproché (quart ouvert ou caisse non comptée).
  const fuelByShift = new Map();
  for (const m of meters) { const g = fuelByShift.get(m.shift_id) || { liters: 0, amount: 0 }; g.liters += Number(m.liters || 0); g.amount += Number(m.amount || 0); fuelByShift.set(m.shift_id, g); }
  const operations = shifts.map(sh => {
    const counted = sh.status === 'ferme' && sh.counted_cash != null && sh.cash_gap != null;
    const gap = counted ? Number(sh.cash_gap) : null;
    const state = !counted ? 'unreconciled' : (Math.abs(gap) < 0.005 ? 'reconciled' : 'gap');
    const fu = fuelByShift.get(sh.id) || { liters: 0, amount: 0 };
    return { shift_id: sh.id, number: sh.number, kind: sh.kind, status: sh.status, opened_at: sh.opened_at, closed_at: sh.closed_at,
      fuel_liters: fu.liters, fuel_amount: fu.amount, theoretical: sh.theoretical_cash != null ? Number(sh.theoretical_cash) : null,
      counted: sh.counted_cash != null ? Number(sh.counted_cash) : null, gap, state };
  });
  const counts = { total: operations.length, reconciled: 0, gap: 0, unreconciled: 0 };
  operations.forEach(o => { counts[o.state]++; });

  res.json({
    date: from === to ? from : undefined, from, to,
    pumps: { lines: meters, total_liters: liters, total_amount: fuel_amount },
    sales: { product_sales: salesAgg?.product_sales || 0, count: salesAgg?.n || 0 },
    payments: payByMethod,
    expenses: exp?.total || 0,
    shifts: shifts,
    operations,
    cash: { gaps: cash_gaps.map(s => ({ number: s.number, gap: Number(s.cash_gap || 0), theoretical: Number(s.theoretical_cash || 0), counted: Number(s.counted_cash || 0) })), total_gap },
    summary: {
      fuel_vs_sales_note: 'Les litres pompés (quarts fermés) et les ventes produits sont présentés séparément pour contrôle manuel.',
      total_in: fuel_amount + Number(salesAgg?.product_sales || 0),
      total_expenses: Number(exp?.total || 0),
      cash_gap_total: total_gap,
      counts
    }
  });
}));

/** Fin de journée sur une période (?from=&to=, jours inclus ; 1 jour = même résultat que /dashboard/jour). Mêmes périmètres que /dashboard/jour :
 *  ventes produits (kind='produits', valides, sold_at::date), carburant des quarts FERMÉS (closed_at::date), dépenses (spent_on). Stock bas = état actuel. */
r.get('/reports/eod-period', need('report.view', 'finance.view', 'shift.close'), wrap(async (req, res) => {
  const range = parseRange(req.query) || { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
  const { from, to } = range, sid = req.sid;
  const days = eachDay(from, to);
  if (days.length > 1100) throw new HttpError(400, 'Période trop longue (1 100 jours maximum)');
  const q = (sql, p) => pool.query(sql, p).then(x => x.rows);
  const [sales, fuel, exp, shifts, low] = await Promise.all([
    q(`SELECT sold_at::date::text AS day, COALESCE(SUM(total),0) AS total, COUNT(*)::int AS n FROM sales
        WHERE station_id=$1 AND status='valide' AND kind='produits' AND sold_at::date BETWEEN $2::date AND $3::date GROUP BY 1`, [sid, from, to]),
    q(`SELECT sh.closed_at::date::text AS day, COALESCE(SUM(m.liters),0) AS liters, COALESCE(SUM(m.amount),0) AS amount
         FROM meter_readings m JOIN shifts sh ON sh.id=m.shift_id
        WHERE sh.station_id=$1 AND sh.status='ferme' AND sh.closed_at::date BETWEEN $2::date AND $3::date GROUP BY 1`, [sid, from, to]).catch(swallow('ops_plus:eodp_fuel', [])),
    q(`SELECT spent_on::text AS day, COALESCE(SUM(amount),0) AS total FROM expenses
        WHERE station_id=$1 AND deleted_at IS NULL AND spent_on BETWEEN $2::date AND $3::date GROUP BY 1`, [sid, from, to]).catch(swallow('ops_plus:eodp_exp', [])),
    q(`SELECT id, number, kind, closed_at, cash_gap, closed_at::date::text AS day FROM shifts
        WHERE station_id=$1 AND closed_at IS NOT NULL AND closed_at::date BETWEEN $2::date AND $3::date ORDER BY closed_at`, [sid, from, to]),
    q('SELECT p.name, st.quantity, p.min_stock FROM products p JOIN stock st ON st.product_id=p.id WHERE p.station_id=$1 AND p.deleted_at IS NULL AND st.quantity<=p.min_stock LIMIT 20', [sid])
  ]);
  const idx = rows => new Map(rows.map(x => [x.day, x]));
  const S = idx(sales), F = idx(fuel), E = idx(exp);
  const by_day = days.map(d => {
    const s1 = S.get(d), f1 = F.get(d), e1 = E.get(d), sh = shifts.filter(x => x.day === d);
    const product_sales = Number(s1?.total || 0), fuel_amount = Number(f1?.amount || 0), expenses = Number(e1?.total || 0);
    return { date: d, product_sales, product_count: s1?.n || 0, fuel_liters: Number(f1?.liters || 0), fuel_amount, expenses,
      result: r2(product_sales + fuel_amount - expenses), shifts_closed: sh.length, cash_gap: r2(sh.reduce((a, x) => a + Number(x.cash_gap || 0), 0)) };
  });
  const sum = k => r2(by_day.reduce((a, x) => a + x[k], 0));
  res.json({
    from, to, days: days.length,
    kpis: { product_sales: sum('product_sales'), product_count: by_day.reduce((a, x) => a + x.product_count, 0), fuel_liters: Math.round(by_day.reduce((a, x) => a + x.fuel_liters, 0) * 1000) / 1000,
      fuel_amount: sum('fuel_amount'), expenses: sum('expenses'), result: sum('result'), shifts_closed: shifts.length, cash_gap: sum('cash_gap') },
    by_day,
    shifts: shifts.map(({ day, ...x }) => x),
    low_stock: low,
    scope: { low_stock: 'État actuel du stock (non filtré par date)', fuel: 'Quarts fermés dans la période uniquement' }
  });
}));


module.exports = r;
