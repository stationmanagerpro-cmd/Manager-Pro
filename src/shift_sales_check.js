'use strict';
// Rattachement vente carburant → employé sur un quart partagé. Module pur (aucune base).
// Règle : la POMPE affectée à l'ouverture du quart détermine l'employé. Une vente ne peut pas être imputée à un autre employé que le responsable de la pompe.

class SaleAttributionError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; this.name = 'SaleAttributionError'; }
}

/** owners : ids employés responsables de la pompe (shift_employees.pump_id ∪ shift_employee_pumps), doublons ignorés.
 *  bodyEmpId : employé demandé par l'écran/l'API ; userEmpId : employé lié à l'utilisateur connecté (repli uniquement si la pompe n'a pas de responsable).
 *  names : Map id → nom (messages d'erreur). Retourne l'id employé à enregistrer (ou null si rien ne permet de le déterminer). */
function resolveFuelSaleEmployee({ owners, bodyEmpId, userEmpId, pumpName, names }) {
  const list = [...new Set((owners || []).map(Number))];
  const nm = id => (names && names.get && names.get(Number(id))) || ('employé ' + id);
  const body = bodyEmpId == null || bodyEmpId === '' ? null : Number(bodyEmpId);
  if (list.length === 1) {
    if (body != null && body !== list[0])
      throw new SaleAttributionError(`${pumpName || 'Cette pompe'} est affectée à ${nm(list[0])} sur ce quart : la vente ne peut pas être enregistrée au nom de ${nm(body)}.`);
    return list[0];
  }
  if (list.length > 1) {   // pompe partagée par plusieurs employés : le choix doit être explicite et valide
    if (body == null) throw new SaleAttributionError(`${pumpName || 'Cette pompe'} est partagée par plusieurs employés : indiquez l'employé concerné.`, 400);
    if (!list.includes(body)) throw new SaleAttributionError(`${nm(body)} n'est pas responsable de ${pumpName || 'cette pompe'} sur ce quart.`);
    return body;
  }
  return body != null ? body : (userEmpId != null ? Number(userEmpId) : null);   // pompe sans responsable : comportement historique
}

/** Contrôle à la fermeture : ventes carburant dont l'employé n'est pas le responsable de la pompe.
 *  sales : [{ id, pump_id, employee_id, total }] ; ownersByPump : Map pump_id → Set/array d'employés.
 *  Retourne { checked, fixes: [{ sale_id, pump_id, from, to, total }], ambiguous: [...] } — `to` = unique responsable de la pompe. */
function checkFuelSalesAttribution(sales, ownersByPump) {
  const fixes = [], ambiguous = []; let checked = 0;
  for (const s of sales || []) {
    if (s.pump_id == null) continue;
    const own = [...new Set([...(ownersByPump.get(Number(s.pump_id)) || [])].map(Number))];
    if (!own.length) continue;          // pompe sans responsable : rien à vérifier
    checked++;
    const emp = s.employee_id == null ? null : Number(s.employee_id);
    if (emp != null && own.includes(emp)) continue;
    if (own.length === 1) fixes.push({ sale_id: s.id, pump_id: Number(s.pump_id), from: emp, to: own[0], total: Number(s.total) || 0 });
    else ambiguous.push({ sale_id: s.id, pump_id: Number(s.pump_id), from: emp, candidates: own, total: Number(s.total) || 0 });
  }
  return { checked, fixes, ambiguous };
}

module.exports = { SaleAttributionError, resolveFuelSaleEmployee, checkFuelSalesAttribution };
