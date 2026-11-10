// Traçabilité complète des actions d'écriture : qui (nom + matricule + rôle), quoi, où, quand, depuis quelle adresse.
//  - s'accroche à la fin de chaque requête POST / PUT / PATCH / DELETE réussie d'un utilisateur connecté ;
//  - n'enregistre JAMAIS le corps de la requête (mots de passe, montants saisis, pièces jointes : rien n'est copié) ;
//  - ne bloque jamais l'opération métier : une erreur d'écriture du journal est seulement signalée dans la console.
const { pool } = require('./core');
const { swallow } = require('./safe');

const VERB = { POST: 'Création', PUT: 'Modification', PATCH: 'Modification', DELETE: 'Suppression' };
// Dernier segment d'action reconnu : « /sales/12/cancel » → Annulation (plutôt que « Création »)
const ACTION = {
  cancel: 'Annulation', close: 'Clôture', open: 'Ouverture', reopen: 'Réouverture', pay: 'Paiement', payments: 'Paiement',
  reject: 'Rejet', review: 'Réponse à un rejet', approve: 'Approbation', validate: 'Validation', assign: 'Attribution',
  send: 'Envoi', share: 'Partage', import: 'Import', restore: 'Restauration', reset: 'Réinitialisation', archive: 'Archivage',
  unarchive: 'Désarchivage', refuse: 'Refus', accept: 'Acceptation', deliver: 'Livraison', receive: 'Réception', transfer: 'Transfert',
  generate: 'Génération', lock: 'Verrouillage', unlock: 'Déverrouillage', activate: 'Activation', deactivate: 'Désactivation', logout: 'Déconnexion'
};
const MODULE = {
  sales: 'Ventes', shifts: 'Quarts', pumps: 'Pompes', products: 'Produits', stock: 'Stock', customers: 'Clients', suppliers: 'Fournisseurs',
  purchases: 'Achats', expenses: 'Dépenses', cash: 'Caisse', money: 'Trésorerie', finance: 'Finance', invoices: 'Facturation',
  hr: 'Ressources humaines', employees: 'Employés', users: 'Utilisateurs', roles: 'Rôles', accounting: 'Comptabilité', fiscal: 'Fiscalité',
  reports: 'Rapports', exports: 'Exports', imports: 'Imports', messaging: 'Messagerie', settings: 'Paramètres', stations: 'Stations',
  commissions: 'Commissions', sellers: 'Vendeurs', treasury: 'Trésorerie', admin: 'Administration', me: 'Profil', contracts: 'Contrats',
  alerts: 'Alertes', notifications: 'Notifications', backup: 'Sauvegardes', audit: 'Audit', credits: 'Crédits', declarations: 'Déclarations'
};
// Routes qui ne sont pas des actions de l'utilisateur sur les données (bruit) : jamais journalisées.
const SKIP = [/^\/auth(\/|$)/, /^\/health/, /^\/messaging\/presence/, /^\/messaging\/(typing|heartbeat)/, /^\/me\/preferences\//, /^\/me\/profile(\/|$)/, /^\/push(\/|$)/];

const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/** Décrit une requête d'écriture : chemin normalisé, module, libellé lisible, identifiant visé. */
function describe(method, rawPath) {
  const path = String(rawPath || '').split('?')[0].replace(/^\/api(?=\/)/, '').replace(/\/+$/, '') || '/';
  const segs = path.split('/').filter(Boolean);
  const isId = s => /^\d+$/.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s);
  const ids = segs.filter(isId), numericIds = ids.filter(s => /^\d+$/.test(s));
  const route = '/' + segs.map(s => (isId(s) ? ':id' : s)).join('/');
  const words = segs.filter(s => !isId(s));
  const first = (words[0] || 'autre').toLowerCase();
  const module = MODULE[first] || cap(first.replace(/[-_]/g, ' '));
  const act = words.length > 1 ? ACTION[words[words.length - 1].toLowerCase()] : null;
  const label = `${act || VERB[method] || method} · ${module}` + (words.length > 1 && !act ? ` (${words.slice(1).join(' › ').replace(/[-_]/g, ' ')})` : '');
  return { route, module, label, recordId: numericIds.length ? Number(numericIds[numericIds.length - 1]) : null, skip: SKIP.some(r => r.test(path)) };
}

// Nom / matricule de l'utilisateur : mis en cache 60 s pour ne pas ajouter une requête à chaque écriture
const CACHE = new Map();
async function who(req) {
  const key = `${req.user.id}:${req.sid || 0}`, hit = CACHE.get(key);
  if (hit && hit.t > Date.now()) return hit.v;
  const { rows: [r] } = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(u.full_name), ''), u.login) AS name,
            (SELECT e.matricule FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL ORDER BY (e.station_id = $2) DESC, e.id LIMIT 1) AS matricule
       FROM users u WHERE u.id = $1`, [req.user.id, req.sid || null]);
  const v = { name: (r && r.name) || req.user.login, matricule: (r && r.matricule) || null };
  CACHE.set(key, { v, t: Date.now() + 60000 });
  if (CACHE.size > 500) CACHE.clear();
  return v;
}

async function record(req, res) {
  const method = req.method.toUpperCase();
  if (!VERB[method] || !req.user || !req.user.id || res.statusCode >= 400) return;
  const d = describe(method, (req.originalUrl || req.url || '').toString());
  if (d.skip) return;
  const w = await who(req).catch(swallow('activity_log:64', { name: req.user.login, matricule: null }));
  await pool.query(
    `INSERT INTO user_activity_log(station_id, user_id, user_login, user_name, matricule, role_code, method, route, module, label, record_id, status_code, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [req.sid || null, req.user.id, req.user.login || null, w.name, w.matricule, req.user.role || null, method, d.route, d.module, d.label, d.recordId, res.statusCode, req.ip || null]);
}

/** À monter après l'authentification et le contrôle de station. */
function middleware(req, res, next) {
  if (VERB[String(req.method).toUpperCase()]) {
    res.on('finish', () => { record(req, res).catch(e => console.warn('[journal d\'activité] non enregistré :', e && e.message)); });
  }
  next();
}

module.exports = { middleware, describe, VERB, MODULE, ACTION };
