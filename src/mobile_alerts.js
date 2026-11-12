// Alertes pour les notifications de l'application mobile : stock bas, factures échues, échéances fiscales, quart resté ouvert.
// Chaque alerte porte une clé stable : l'application n'affiche une notification qu'une fois par clé.
const express = require('express');
const { pool, wrap, need } = require('./core');
const { swallow } = require('./safe');
const r = express.Router();
const OPEN_SHIFT_HOURS = Number(process.env.SHIFT_FORGOTTEN_HOURS) || 12;

r.get('/mobile/alerts', need('report.view', 'finance.view', 'stock.adjust', 'purchase.manage', 'sale.create', 'shift.open'), wrap(async (req, res) => {
  const sid = req.sid, perms = req.user.perms, can = (...p) => req.user.is_global || p.some(x => perms.has(x));
  const Q = (sql, p = [sid]) => pool.query(sql, p).then(x => x.rows).catch(swallow('mobile_alerts', []));
  const today = new Date().toISOString().slice(0, 10);
  const [low, inv, fisc, shifts] = await Promise.all([
    can('report.view', 'stock.adjust', 'purchase.manage')
      ? Q('SELECT p.id, p.name FROM products p JOIN stock st ON st.product_id = p.id WHERE p.station_id = $1 AND p.deleted_at IS NULL AND p.active AND p.min_stock > 0 AND st.quantity <= p.min_stock ORDER BY p.name LIMIT 30') : [],
    can('finance.view', 'report.view')
      ? Q("SELECT COUNT(*)::int AS n, COALESCE(SUM(total_ttc - amount_paid), 0) AS due FROM invoices WHERE station_id = $1 AND status IN ('emise','partielle') AND due_date < CURRENT_DATE") : [],
    can('finance.view', 'report.view')
      ? Q(`SELECT d.id, d.title, d.due_date FROM fiscal_deadlines d JOIN stations s ON s.client_id = d.client_id WHERE s.id = $1
            AND d.status IN ('a_venir','en_cours','depasse') AND d.due_date <= CURRENT_DATE + 7 ORDER BY d.due_date LIMIT 10`) : [],
    Q(`SELECT id, number, opened_at FROM shifts WHERE station_id = $1 AND status = 'ouvert' AND opened_at < now() - ($2 || ' hours')::interval ORDER BY opened_at`, [sid, String(OPEN_SHIFT_HOURS)])
  ]);
  const alerts = [];
  if (low.length) alerts.push({ key: 'stock:' + low.map(x => x.id).join(','), type: 'stock', level: 'warning', title: `${low.length} produit(s) sous le stock minimum`, body: low.slice(0, 4).map(x => x.name).join(', ') + (low.length > 4 ? '…' : '') });
  if (inv[0] && inv[0].n > 0) alerts.push({ key: `inv:${inv[0].n}:${today}`, type: 'facture', level: 'warning', title: `${inv[0].n} facture(s) client en retard`, body: `Reste à encaisser : ${Math.round(Number(inv[0].due))}` });
  for (const d of fisc) {
    const late = String(d.due_date).slice(0, 10) < today;
    alerts.push({ key: `fisc:${d.id}:${late ? 'late' : 'soon'}`, type: 'fiscal', level: late ? 'critical' : 'warning', title: (late ? 'Échéance fiscale dépassée : ' : 'Échéance fiscale proche : ') + d.title, body: 'Date limite ' + String(d.due_date).slice(0, 10) });
  }
  for (const s of shifts) alerts.push({ key: 'shift:' + s.id, type: 'quart', level: 'critical', title: `Quart ${String(s.number).padStart(6, '0')} toujours ouvert`, body: `Ouvert depuis plus de ${OPEN_SHIFT_HOURS} h : pensez à le clôturer.` });
  res.json({ at: new Date().toISOString(), alerts });
}));
module.exports = r;
