'use strict';
/** Logique pure de la facture mensuelle flotte (testable sans base). */
const r2 = v => Math.round(Number(v) * 100) / 100;

/** Regroupe les prises (use) par carte + produit : une ligne de facture par groupe. Le total est la somme exacte des montants. */
function buildFleetInvoiceLines(events) {
  const groups = new Map();
  for (const e of events) {
    const key = e.card_id + '|' + (e.product_id || 0);
    if (!groups.has(key)) groups.set(key, { product_id: e.product_id || null, card_label: e.label, card_number: e.card_number, product_name: e.product_name || 'Carburant', liters: 0, amount: 0, count: 0 });
    const g = groups.get(key); g.liters += Number(e.liters); g.amount += Number(e.amount); g.count += 1;
  }
  const lines = [...groups.values()].sort((a, b) => String(a.card_label).localeCompare(String(b.card_label)) || a.product_name.localeCompare(b.product_name)).map(g => {
    const liters = Math.round(g.liters * 1000) / 1000, amount = r2(g.amount);
    return { product_id: g.product_id, description: `${g.card_label} (${g.card_number}) — ${g.product_name} — ${g.count} prise(s)`, quantity: liters > 0 ? liters : 1, unit_price: liters > 0 ? r2(amount / liters) : amount, amount };
  });
  const total = r2(lines.reduce((a, l) => a + l.amount, 0));
  return { lines, total };
}

function addDays(isoDate, n) { const d = new Date(isoDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/** Dernier jour du mois AAAA-MM. */
function monthEnd(month) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }

/** Un mois ne se facture qu'une fois terminé (sauf force). */
function canInvoiceMonth(month, todayIso, force) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, reason: 'Mois invalide (AAAA-MM)' };
  if (!force && todayIso <= monthEnd(month)) return { ok: false, reason: 'Le mois n’est pas terminé : facturation possible à partir du 1er du mois suivant (ou forcer).' };
  return { ok: true };
}

module.exports = { buildFleetInvoiceLines, addDays, monthEnd, canInvoiceMonth };
