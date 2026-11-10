'use strict';
// Rattachement par employé lorsqu'un quart est partagé par 2 ou 3 personnes.
// Règle métier : chaque employé n'est responsable que de SES pompes (attribuées à l'ouverture du quart),
// de SES ventes saisies, de SES anomalies déclarées et de SES écarts. Module pur : aucune base, aucune dépendance.

const fl = x => Math.round((+x || 0) * 100) / 100;
const f3 = x => Math.round((+x || 0) * 1000) / 1000;
const EPS = 0.004;

class AttributionError extends Error {
  constructor(message) { super(message); this.status = 400; this.name = 'AttributionError'; }
}

/** rows : [{ employee_id, pump_id }] (shift_employees.pump_id + shift_employee_pumps). Une pompe = un seul employé. */
function buildPumpOwners(rows) {
  const owners = new Map();
  for (const r of rows || []) {
    if (r.pump_id == null || r.employee_id == null) continue;
    const pid = Number(r.pump_id), eid = Number(r.employee_id);
    if (owners.has(pid) && owners.get(pid) !== eid) throw new AttributionError('La pompe ' + pid + ' est affectée à deux employés sur ce quart.');
    owners.set(pid, eid);
  }
  return owners;
}

/** Répartition exacte (somme conservée) d'un total selon des poids positifs. weights : [{ key, w }] → [{ key, amount }] ou null. */
function splitByWeights(total, weights, decimals = 3) {
  const factor = 10 ** decimals;
  const pos = (weights || []).filter(x => x.w > 0);
  const sumW = pos.reduce((a, x) => a + x.w, 0);
  if (!(sumW > 0)) return null;
  const sign = total < 0 ? -1 : 1, units = Math.round(Math.abs(total) * factor);
  const parts = pos.map(x => { const exact = units * x.w / sumW; return { key: x.key, base: Math.floor(exact + 1e-9), frac: exact - Math.floor(exact + 1e-9) }; });
  let left = units - parts.reduce((a, p) => a + p.base, 0);
  [...parts].sort((a, b) => b.frac - a.frac).forEach(p => { if (left > 0) { p.base += 1; left -= 1; } });
  return parts.map(p => ({ key: p.key, amount: sign * p.base / factor }));
}

/**
 * Carburant par employé à partir des compteurs de SES pompes.
 * counters : [{ pump_id, product_id, liters, amount }]. Une pompe sans responsable est regroupée sous la clé null,
 * sauf quand une seule personne est sur le quart (elle est alors responsable de tout).
 */
function fuelByEmployee(counters, owners, soleEmployeeId = null) {
  const out = new Map();
  for (const c of counters || []) {
    // Employé seul et aucune pompe attribuée (usage historique) : tout est à lui. Sinon une pompe sans employé reste sans employé.
    const owner = owners.has(Number(c.pump_id)) ? owners.get(Number(c.pump_id)) : (owners.size === 0 ? soleEmployeeId : null);
    const key = owner == null ? null : owner;
    const o = out.get(key) || { employee_id: key, liters: 0, amount: 0, byProduct: new Map() };
    o.liters = f3(o.liters + c.liters); o.amount = fl(o.amount + c.amount);
    o.byProduct.set(Number(c.product_id), f3((o.byProduct.get(Number(c.product_id)) || 0) + c.liters));
    out.set(key, o);
  }
  return out;
}

/**
 * Situation de caisse de chaque employé (quart partagé).
 * - attendu = espèces de SES ventes saisies + SON carburant non déclaré (compteurs de ses pompes − ses ventes déclarées) − SES paiements non espèces
 * - écart  = espèces qu'il a remises − attendu
 * team : [{ id, name }] ; inputs : [{ employee_id, counted_cash, mobile_money, card, credit }]
 */
function computeEmployeeClosings({ team, fuelByEmp, declaredFuelByEmp, cashDeclaredByEmp, inputs, requireInputs }) {
  const nameOf = new Map(team.map(t => [t.id, t.name]));
  const inByEmp = new Map((inputs || []).map(x => [Number(x.employee_id), x]));
  for (const k of inByEmp.keys()) if (!nameOf.has(k)) throw new AttributionError("L'employé " + k + " ne fait pas partie de ce quart.");
  const ids = [...new Set([...team.map(t => t.id), ...[...fuelByEmp.keys()].filter(k => k != null), ...declaredFuelByEmp.keys(), ...cashDeclaredByEmp.keys()].filter(k => k != null))];
  const rows = [];
  for (const id of ids) {
    const name = nameOf.get(id) || ('Employé ' + id);
    const fuel = fuelByEmp.get(id) || { liters: 0, amount: 0, byProduct: new Map() };
    const declared = fl(declaredFuelByEmp.get(id) || 0), cashDeclared = fl(cashDeclaredByEmp.get(id) || 0);
    const raw = fl(fuel.amount - declared), over = raw < -0.01 ? fl(-raw) : 0, undeclared = Math.max(raw, 0);
    const inp = inByEmp.get(id);
    if (requireInputs && nameOf.has(id) && !inp) throw new AttributionError('Saisissez les espèces remises par ' + name + ' : chaque employé du quart doit avoir sa propre situation.');
    const nonCash = inp ? { mobile_money: fl(inp.mobile_money), card: fl(inp.card), credit: fl(inp.credit) } : { mobile_money: 0, card: 0, credit: 0 };
    const nonCashTotal = fl(nonCash.mobile_money + nonCash.card + nonCash.credit);
    if (nonCashTotal > undeclared + 0.01) throw new AttributionError('Les paiements non espèces de ' + name + ' (' + nonCashTotal + ') dépassent son carburant non déclaré (' + undeclared + ').');
    const expected = fl(cashDeclared + undeclared - nonCashTotal);
    const counted = inp ? fl(inp.counted_cash) : null;
    rows.push({ employee_id: id, name, in_team: nameOf.has(id), fuel_liters: fuel.liters, fuel_amount: fuel.amount, declared_fuel: declared, undeclared, overdeclared: over,
      non_cash: nonCash, cash_declared: cashDeclared, expected_cash: expected, counted_cash: counted, cash_gap: counted == null ? null : fl(counted - expected) });
  }
  const unowned = fuelByEmp.get(null) || null;
  return { rows, unowned: unowned && { liters: unowned.liters, amount: unowned.amount },
    non_cash_total: { mobile_money: fl(rows.reduce((a, r) => a + r.non_cash.mobile_money, 0)), card: fl(rows.reduce((a, r) => a + r.non_cash.card, 0)), credit: fl(rows.reduce((a, r) => a + r.non_cash.credit, 0)) } };
}

/** Écart de caisse global − somme des écarts individuels = part non attribuable (dépenses, pompe sans responsable…). */
function residualGap(globalGap, rows) {
  return fl(globalGap - rows.reduce((a, r) => a + (r.cash_gap || 0), 0));
}

/**
 * Écart de stock d'un produit réparti entre les employés :
 * carburant → litres sortis des compteurs de leurs pompes ; autre produit → quantités vendues par chacun ; sinon non attribué (null).
 */
function attributeStockGap({ gap, productId, fuelByEmp, soldQtyByEmp, soleEmployeeId = null }) {
  if (soleEmployeeId != null) return [{ employee_id: soleEmployeeId, amount: gap }];
  const fuelW = [...fuelByEmp.values()].map(o => ({ key: o.employee_id, w: o.byProduct.get(Number(productId)) || 0 }));
  let parts = splitByWeights(gap, fuelW);
  if (!parts) {
    const soldW = [...(soldQtyByEmp.get(Number(productId)) || new Map()).entries()].map(([k, w]) => ({ key: k, w: Number(w) }));
    parts = splitByWeights(gap, soldW);
  }
  if (!parts) return [{ employee_id: null, amount: gap }];
  return parts.filter(p => Math.abs(p.amount) > 0.0005).map(p => ({ employee_id: p.key, amount: p.amount }));
}

module.exports = { AttributionError, buildPumpOwners, splitByWeights, fuelByEmployee, computeEmployeeClosings, residualGap, attributeStockGap, EPS, fl, f3 };
