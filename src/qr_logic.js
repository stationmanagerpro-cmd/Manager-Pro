'use strict';
// Scan QR des pompes : logique métier PURE (aucun accès base) pour être testable sans PostgreSQL.
// Règle d'or : le QR identifie le compteur (point de distribution) ; le compte connecté identifie l'employé ;
// affectations et quart décident ; le serveur autorise. Les routes (qr_codes.js, fuelsales.js) chargent les données
// en base puis appellent evaluateCheckpoint / evaluateScanUse.
const crypto = require('crypto');

const PREFIX = 'SMP1:';
const SCAN_TTL_MS = 15 * 60 * 1000;   // un scan prépare UNE vente et expire au bout de 15 min

/** Codes d'erreur stables → message utilisateur + statut HTTP. */
const ERRORS = {
  QR_INVALID: { status: 404, message: 'QR Code non reconnu.' },
  QR_REVOKED: { status: 409, message: 'Ce QR Code a été désactivé.' },
  PUMP_DISABLED: { status: 409, message: 'Cette pompe est désactivée.' },
  EMPLOYEE_NOT_FOUND: { status: 403, message: 'Votre compte n’est pas rattaché à un employé de cette station.' },
  DELEGATE_OWNER_UNCLEAR: { status: 409, message: 'Cette pompe a plusieurs responsables sur ce quart : la vente par scan au nom d’un employé n’est pas possible.' },
  DELEGATE_NO_ACCOUNT: { status: 409, message: 'L’employé responsable de cette pompe n’a pas de compte utilisateur : il ne peut pas être alerté, vente refusée.' },
  DELEGATE_NOT_ALLOWED: { status: 403, message: 'Vous n’avez pas la permission d’enregistrer une vente au nom d’un employé.' },
  EMPLOYEE_NOT_ON_SHIFT: { status: 403, message: 'Vous ne faites pas partie de l’équipe du quart ouvert.' },
  EMPLOYEE_NOT_ASSIGNED: { status: 403, message: 'Vous n’êtes pas affecté à cette pompe.' },
  SHIFT_NOT_OPEN: { status: 409, message: 'Aucun quart ouvert ne permet cette opération.' },
  SHIFT_CLOSED: { status: 409, message: 'Ce quart est déjà clôturé.' },
  COUNTER_NOT_READ: { status: 409, message: 'Ce compteur n’a pas de relevé d’ouverture sur le quart en cours.' },
  PRODUCT_NOT_FOUND: { status: 409, message: 'Produit associé introuvable.' },
  STATION_MISMATCH: { status: 403, message: 'Cet équipement n’appartient pas à votre station.' },
  SCAN_INVALID: { status: 409, message: 'Scan introuvable ou non valable. Scannez de nouveau la pompe.' },
  SCAN_EXPIRED: { status: 409, message: 'Le scan a expiré. Scannez de nouveau la pompe.' },
  SCAN_USED: { status: 409, message: 'Ce scan a déjà servi pour une vente. Scannez de nouveau la pompe.' },
  SCAN_MISMATCH: { status: 409, message: 'Les données de la vente ne correspondent pas au scan.' },
  CLIENT_REF_REQUIRED: { status: 400, message: 'Clé d’idempotence (client_ref) obligatoire pour une vente par scan.' },
  CAMERA_DENIED: { status: 0, message: 'L’autorisation d’accès à la caméra a été refusée.' },   // côté client uniquement
  NETWORK_ERROR: { status: 0, message: 'Vérification impossible auprès du serveur. Réessayez lorsque la connexion est rétablie.' },
};
const refuse = code => ({ ok: false, code, status: ERRORS[code].status, message: ERRORS[code].message });

/** Jeton opaque : 24 octets aléatoires (192 bits) en base64url = 32 caractères. */
const generateToken = () => crypto.randomBytes(24).toString('base64url');
const payloadOf = token => PREFIX + token;
/** Extrait le jeton d'un texte scanné ; null si le format n'est pas celui de l'application. */
function parsePayload(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t.startsWith(PREFIX)) return null;
  const tok = t.slice(PREFIX.length);
  return /^[A-Za-z0-9_-]{32}$/.test(tok) ? tok : null;
}
/** Référence courte lisible (« 7F3K-9A2C ») : empreinte du jeton, sans secret, utilisable dans les journaux et sur l'étiquette. */
function shortRef(token) { const h = crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 8).toUpperCase(); return h.slice(0, 4) + '-' + h.slice(4); }
/** Saisie manuelle de secours : l'utilisateur tape la référence courte de l'étiquette. */
const normalizeShortRef = s => { const h = String(s || '').toUpperCase().replace(/[^0-9A-F]/g, ''); return h.length === 8 ? h.slice(0, 4) + '-' + h.slice(4) : null; };

/**
 * Contrôles communs au scan ET à la validation de la vente. Données chargées en base par l'appelant :
 *   stationId  : station de la requête (en-tête vérifié par le middleware)
 *   qr         : ligne qr_codes ou null          counter / pump / product : lignes ou null
 *   shift      : quart OUVERT de la station ou null
 *   employee   : employé lié au compte connecté (employees.user_id) ou null
 *   team       : lignes shift_employees du quart [{employee_id, pump_id}]
 *   pumpAssign : lignes shift_employee_pumps [{employee_id, pump_id}]
 *   counterRead: true si le compteur a un relevé d'ouverture sur ce quart
 * Les règles d'affectation reprennent EXACTEMENT celles de la route /sales/fuel existante (shift_sales_check.js).
 */
function evaluateCheckpoint(ctx) {
  const { stationId, qr, counter, pump, product, shift, employee, team = [], pumpAssign = [] } = ctx;
  if (!qr) return refuse('QR_INVALID');
  if (Number(qr.station_id) !== Number(stationId) || (pump && Number(pump.station_id) !== Number(stationId))) return refuse('STATION_MISMATCH');
  if (qr.status !== 'active') return refuse('QR_REVOKED');
  if (!pump || pump.deleted_at || pump.status !== 'active') return refuse('PUMP_DISABLED');
  if (!counter || Number(counter.pump_id) !== Number(pump.id) || Number(qr.counter_id) !== Number(counter.id)) return refuse('PRODUCT_NOT_FOUND');
  if (!product || product.deleted_at || product.active === false || Number(product.id) !== Number(counter.product_id)) return refuse('PRODUCT_NOT_FOUND');
  if (!shift) return refuse('SHIFT_NOT_OPEN');
  if (shift.status !== 'ouvert') return refuse('SHIFT_CLOSED');
  if (!employee) return refuse('EMPLOYEE_NOT_FOUND');
  if (!team.some(t => Number(t.employee_id) === Number(employee.id))) return refuse('EMPLOYEE_NOT_ON_SHIFT');
  if (!ctx.counterRead) return refuse('COUNTER_NOT_READ');
  const pid = Number(pump.id), eid = Number(employee.id);
  const owners = new Set([...team.filter(t => t.pump_id != null && Number(t.pump_id) === pid).map(t => Number(t.employee_id)),
                          ...pumpAssign.filter(a => Number(a.pump_id) === pid).map(a => Number(a.employee_id))]);
  if (owners.size > 0 && !owners.has(eid)) return refuse('EMPLOYEE_NOT_ASSIGNED');   // pompe affectée à un autre employé
  const hasAnyPumpAssignment = team.some(t => t.pump_id != null) || pumpAssign.length > 0;
  const mine = team.some(t => Number(t.employee_id) === eid && (t.pump_id == null || Number(t.pump_id) === pid)) || pumpAssign.some(a => Number(a.employee_id) === eid && Number(a.pump_id) === pid);
  if (!mine && hasAnyPumpAssignment) return refuse('EMPLOYEE_NOT_ASSIGNED');
  return { ok: true };
}

/**
 * Vente au nom d'un employé (permission sale.record_for_employee). Ne s'applique que si l'utilisateur n'est pas lui-même
 * responsable de la pompe sur ce quart. Retourne null (pas de délégation), { ok: true, employee_id } ou un refus.
 */
function delegateTarget(ctx, canDelegate) {
  if (!canDelegate || !ctx.pump || !ctx.shift) return null;
  const pid = Number(ctx.pump.id);
  const owners = [...new Set([...(ctx.team || []).filter(t => t.pump_id != null && Number(t.pump_id) === pid).map(t => Number(t.employee_id)),
                              ...(ctx.pumpAssign || []).filter(a => Number(a.pump_id) === pid).map(a => Number(a.employee_id))])];
  if (ctx.employee && owners.includes(Number(ctx.employee.id))) return null;   // le connecté est le responsable : vente normale
  if (owners.length === 0) return null;                                       // pompe sans responsable : comportement historique
  if (owners.length > 1) return refuse('DELEGATE_OWNER_UNCLEAR');
  return { ok: true, employee_id: owners[0] };
}

/**
 * Contrôles à la validation de la vente avec un scan. `scan` = ligne qr_scans (verrouillée par l'appelant) ou null ;
 * `body` = corps de requête reçu ; userId = compte authentifié. Le scan doit appartenir au compte, être récent, non consommé,
 * et correspondre exactement au compteur / quart / employé enregistrés au moment du scan : rien n'est repris du navigateur.
 */
function evaluateScanUse(ctx, scan, body, userId, now = new Date()) {
  if (!scan || Number(scan.user_id) !== Number(userId) || Number(scan.station_id) !== Number(ctx.stationId)) return refuse('SCAN_INVALID');
  if (scan.consumed_sale_id != null) return refuse('SCAN_USED');
  if (new Date(scan.expires_at).getTime() <= now.getTime()) return refuse('SCAN_EXPIRED');
  if (!ctx.shift || ctx.shift.status !== 'ouvert' || Number(ctx.shift.id) !== Number(scan.shift_id)) return refuse(ctx.shift && ctx.shift.status === 'ouvert' ? 'SCAN_INVALID' : 'SHIFT_CLOSED');
  if (body && ((body.counter_id != null && Number(body.counter_id) !== Number(scan.counter_id))
            || (body.pump_id != null && Number(body.pump_id) !== Number(scan.pump_id))
            || (body.product_id != null && Number(body.product_id) !== Number(scan.product_id))
            || (body.employee_id != null && Number(body.employee_id) !== Number(scan.employee_id)))) return refuse('SCAN_MISMATCH');
  if (scan.delegated_by_user_id != null && !ctx.canDelegate) return refuse('DELEGATE_NOT_ALLOWED');
  if (!ctx.employee || Number(ctx.employee.id) !== Number(scan.employee_id)) return refuse('EMPLOYEE_NOT_FOUND');
  if (!ctx.qr || Number(ctx.qr.id) !== Number(scan.qr_code_id)) return refuse('SCAN_INVALID');
  return evaluateCheckpoint(ctx);   // QR toujours actif, pompe, produit, affectation, quart : tout est re-contrôlé
}

module.exports = { PREFIX, SCAN_TTL_MS, ERRORS, refuse, generateToken, payloadOf, parsePayload, shortRef, normalizeShortRef, evaluateCheckpoint, evaluateScanUse, delegateTarget };
