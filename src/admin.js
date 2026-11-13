// Paramètres (identité, apparence, pied de page, règles), images, stations, sauvegardes, informations techniques.
const express = require('express');
const { swallow } = require('./safe');
const os = require('os');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');
const files = require('./files');
const RS = require('./roles_scope');
const backup = require('./backup');
const r = express.Router();

const AD = 'Salon Informatique Log — 70 76 84 94';
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur au format #RRGGBB');
const { navColorsSchema } = require('./nav_colors');
// Clés de paramètres connues : schéma de validation, valeur par défaut, permission requise
const KEYS = {
  theme: { perm: 'appearance.manage', def: { mode: 'light', primary: '#0a6b5c', secondary: '#647184' }, schema: z.object({ mode: z.enum(['light', 'dark']), primary: color, secondary: color }) },
  nav_colors: { perm: 'appearance.manage', def: { sidebar: null, header: null }, schema: navColorsSchema },   // couleurs du menu de gauche et de l'en-tête (toute la station)
  footer: { perm: 'appearance.manage', def: { text: '', copyright: '', show_copyright: true, show_ad: false, ad_text: AD }, schema: z.object({ text: z.string().max(200), copyright: z.string().max(200), show_copyright: z.boolean(), show_ad: z.boolean(), ad_text: z.string().max(120) }) },
  payroll_rules: {
    perm: 'hr.manage',
    def: {
      allow_debt_deduction: true,
      max_debt_deduction_pct: 100,
      security_mode: 'strict',
      allow_negative_net: false,
      engine_version: '2.0.0',
      feature_flags: {
        payroll_amo_enabled: false,
        payroll_inps_enabled: false,
        payroll_its_enabled: false,
        payroll_employer_charges_enabled: false,
        payroll_overtime_enabled: false,
        payroll_benefits_enabled: false,
        payroll_automatic_deductions_enabled: true,
        payroll_financial_posting_enabled: true
      }
    },
    schema: z.object({
      allow_debt_deduction: z.boolean(),
      max_debt_deduction_pct: z.number().min(0).max(100),
      security_mode: z.enum(['strict', 'avertissement', 'simulation']).optional(),
      allow_negative_net: z.boolean().optional(),
      engine_version: z.string().max(20).optional(),
      feature_flags: z.object({
        payroll_amo_enabled: z.boolean().optional(),
        payroll_inps_enabled: z.boolean().optional(),
        payroll_its_enabled: z.boolean().optional(),
        payroll_employer_charges_enabled: z.boolean().optional(),
        payroll_overtime_enabled: z.boolean().optional(),
        payroll_benefits_enabled: z.boolean().optional(),
        payroll_automatic_deductions_enabled: z.boolean().optional(),
        payroll_financial_posting_enabled: z.boolean().optional()
      }).optional()
    })
  },

  tolerance_fuel_liters: { perm: 'settings.edit', def: 5, schema: z.number().min(0) },
  fuel_amount_entry_allowed: { perm: 'settings.edit', def: true, schema: z.boolean() },
  backup_emails: { perm: 'settings.edit', def: { primary: null, secondary: [], max_secondary: 2 }, schema: z.object({ primary: z.string().email().nullable().optional(), secondary: z.array(z.string().email()).max(2).optional(), max_secondary: z.number().int().max(2).optional() }).passthrough() },
  accounting_complete: { perm: 'settings.edit', def: false, schema: z.boolean() },
  expense_categories: { perm: 'settings.edit', def: ['Salaires', 'Primes et indemnités', 'Électricité', 'Eau', 'Télécommunications et Internet', 'Entretien et réparation', 'Transport', 'Carburant consommé par l\'entreprise', 'Fournitures', 'Frais bancaires', 'Frais administratifs', 'Impôts et taxes', 'Loyers', 'Prestations et services', 'Autres charges'], schema: z.array(z.string().min(1).max(60)).min(1).max(40) },
  // Personnalisation du bulletin (Phase 9) — présentation uniquement, zéro impact financier
  payslip_layout: {
    perm: 'hr.manage',
    def: {
      title: 'BULLETIN DE PAIE',
      show_bases: true,
      show_rates: true,
      show_employer_charges: true,
      show_employer_cost: true,
      show_appreciation: true,
      show_payment_method: true,
      footer_mentions: '',
      signature_labels: ['Employé (lu et approuvé)', 'Validation gérant', 'Paiement']
    },
    schema: z.object({
      title: z.string().max(80).optional(),
      show_bases: z.boolean().optional(),
      show_rates: z.boolean().optional(),
      show_employer_charges: z.boolean().optional(),
      show_employer_cost: z.boolean().optional(),
      show_appreciation: z.boolean().optional(),
      show_payment_method: z.boolean().optional(),
      footer_mentions: z.string().max(500).optional(),
      signature_labels: z.array(z.string().max(60)).max(5).optional()
    })
  },
  // P11 — Configuration du dashboard par rôle (Administrateur Principal / settings.edit)
  dashboard_config: {
    perm: 'settings.edit',
    def: {
      cards: {
        revenue: true,
        fuel: true,
        products: true,
        expenses: true,
        cash: true,
        receivables: true,
        payables: true,
        low_stock: true,
        open_shift: true,
        alerts: true,
        net: true,
        margin: true,
        margin_pct: true,
        profit: true
      },
      charts: {
        daily_revenue: true,
        payments_by_method: true
      },
      sections: {
        profile: true,
        recent_activity: true,
        shifts: true,
        low_stock_list: true,
        fuel_by_product: true,
        shortcuts: true
      },
      shortcuts: ['jour', 'caisse', 'quart', 'ventes', 'cli', 'alert', 'exports'],
      // Visibilité par rôle (codes rôles). null = hérite de la config globale ci-dessus.
      by_role: {
        ADMIN: null,
        GERANT: null,
        EMPLOYE: {
          cards: { revenue: true, fuel: true, products: false, expenses: false, cash: false, receivables: false, payables: false, low_stock: true, open_shift: true, alerts: true, net: false, margin: false, margin_pct: false, profit: false },
          charts: { daily_revenue: true, payments_by_method: false },
          sections: { profile: true, recent_activity: true, shifts: true, low_stock_list: true, fuel_by_product: true, shortcuts: true },
          shortcuts: ['jour', 'quart', 'ventes', 'alert']
        }
      }
    },
    schema: z.object({
      cards: z.record(z.boolean()).optional(),
      charts: z.record(z.boolean()).optional(),
      sections: z.record(z.boolean()).optional(),
      shortcuts: z.array(z.string().max(40)).max(20).optional(),
      by_role: z.record(z.object({
        cards: z.record(z.boolean()).optional(),
        charts: z.record(z.boolean()).optional(),
        sections: z.record(z.boolean()).optional(),
        shortcuts: z.array(z.string().max(40)).max(20).optional()
      }).nullable()).optional()
    })
  }
};
async function getSetting(station, key) {
  const { rows: [x] } = await pool.query('SELECT value FROM settings WHERE station_id = $1 AND key = $2', [station, key]);
  const d = KEYS[key].def;
  return x ? (d && typeof d === 'object' && !Array.isArray(d) ? { ...d, ...x.value } : x.value) : d;
}

// Lecture publique (tout utilisateur connecté) : apparence, pied de page et identité, pour appliquer le thème et afficher le pied de page
r.get('/appearance', wrap(async (req, res) => {
  const { rows: [st] } = await pool.query('SELECT s.id, s.name, s.tagline, s.address, s.phone, s.email, s.currency, s.tax_id, s.latitude::float AS latitude, s.longitude::float AS longitude, s.photo_path IS NOT NULL AS has_logo, s.banner_path IS NOT NULL AS has_banner, s.banner_title, s.banner_style, s.banner_legibility, s.client_id, c.name AS client_name FROM stations s LEFT JOIN clients c ON c.id = s.client_id WHERE s.id = $1', [req.sid]);
  const { rows: pm } = await pool.query('SELECT pm.code, pm.label, pm.kind, pm.account_id, ma.name AS account_name, COALESCE(ma.active, FALSE) AS account_active FROM payment_methods pm LEFT JOIN money_accounts ma ON ma.id = pm.account_id WHERE pm.station_id = $1 AND pm.active ORDER BY pm.kind, pm.label', [req.sid]);
  const footer = { ...(await getSetting(req.sid, 'footer')) };
  try { const { rows: [ct] } = await pool.query('SELECT c.forced_signature FROM client_contracts c JOIN stations s ON s.client_id = c.client_id WHERE s.id = $1', [req.sid]); if (ct?.forced_signature && String(ct.forced_signature).trim()) footer.forced_signature = String(ct.forced_signature).trim(); } catch (_) { /* contrat absent */ }
  res.json({ theme: await getSetting(req.sid, 'theme'), nav_colors: await getSetting(req.sid, 'nav_colors'), footer, station: { ...st, currency: st.currency.trim() }, expense_categories: await getSetting(req.sid, 'expense_categories'), payment_methods: pm, fuel_amount_entry_allowed: await getSetting(req.sid, 'fuel_amount_entry_allowed') });
}));
r.get('/settings', need('settings.edit', 'hr.manage', 'appearance.manage'), wrap(async (req, res) => {
  const out = {}; for (const k of Object.keys(KEYS)) out[k] = await getSetting(req.sid, k);
  const { rows: pm } = await pool.query('SELECT code, label, kind, account_id, active FROM payment_methods WHERE station_id = $1 ORDER BY code', [req.sid]);
  res.json({ ...out, payment_methods: pm });
}));
r.put('/settings/:key', wrap(async (req, res) => {
  const k = KEYS[req.params.key];
  if (!k) throw new HttpError(404, 'Paramètre inconnu');
  if (!req.user.perms.has(k.perm)) throw new HttpError(403, 'Permission refusée : ' + k.perm);
  if (req.params.key === 'dashboard_config' && !req.user.is_global) throw new HttpError(403, 'La configuration Dashboard se gère désormais dans la fiche de chaque client.');
  // Contrat : signature / personnalisation / paramètres avancés
  if (!req.user.is_global) {
    const { loadContractForUser, featureOn } = require('./contracts');
    const contract = await loadContractForUser(req.user.id, false);
    if (contract.suspended) throw new HttpError(403, 'Contrat suspendu ou expiré.');
    if (req.params.key === 'footer' || req.params.key === 'theme' || req.params.key === 'nav_colors') {
      if (!featureOn(contract, 'can_customize_signature') && !featureOn(contract, 'can_access_personalization')) {
        throw new HttpError(403, 'Personnalisation / signature non autorisée par votre contrat.');
      }
    }
    if (['payroll_rules', 'accounting_complete'].includes(req.params.key) && !featureOn(contract, 'can_access_advanced_settings')) {
      throw new HttpError(403, 'Paramètres avancés non autorisés par votre contrat.');
    }
  }
  const p = k.schema.safeParse(req.body.value);
  if (!p.success) throw new HttpError(400, 'Valeur invalide', p.error.issues.map(i => i.path.join('.') + ' : ' + i.message));
  const old = await getSetting(req.sid, req.params.key);
  await pool.query('INSERT INTO settings(station_id, key, value) VALUES ($1,$2,$3) ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value', [req.sid, req.params.key, JSON.stringify(p.data)]);
  await audit(pool, req, 'paramètres', 'Modification de ' + req.params.key, 'settings', null, old, p.data);
  res.json({ ok: true });
}));
r.post('/settings/reset/:key', wrap(async (req, res) => {       // réinitialisation aux valeurs par défaut
  const k = KEYS[req.params.key];
  if (!k) throw new HttpError(404, 'Paramètre inconnu');
  if (!req.user.perms.has(k.perm)) throw new HttpError(403, 'Permission refusée : ' + k.perm);
  await pool.query('DELETE FROM settings WHERE station_id = $1 AND key = $2', [req.sid, req.params.key]);
  await audit(pool, req, 'paramètres', 'Réinitialisation de ' + req.params.key, 'settings');
  res.json({ ok: true });
}));

// Identité de la station (lecture)
r.get('/stations/current', need('settings.edit', 'report.view', 'finance.view', 'user.manage'), wrap(async (req, res) => {
  const { rows: [s] } = await pool.query(
    'SELECT id, name, address, phone, email, currency, tax_id, latitude::float AS latitude, longitude::float AS longitude, client_id, active FROM stations WHERE id = $1',
    [req.sid]
  );
  if (!s) throw new HttpError(404, 'Station introuvable');
  res.json(s);
}));

// Identité de la station
const geoNum = (min, max, label) => z.union([z.number(), z.string().trim()]).nullable().transform((v, ctx) => {
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} invalide (entre ${min} et ${max})` });
    return z.NEVER;
  }
  return Math.round(n * 1e6) / 1e6;
});
const GEO_SCHEMA = { latitude: geoNum(-90, 90, 'Latitude'), longitude: geoNum(-180, 180, 'Longitude') };

// Identité de la station
r.patch('/stations/current', need('settings.edit'), body(z.object({ name: z.string().min(1), tagline: z.string().max(120).nullable(), address: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(), currency: z.string().min(1).max(4), tax_id: z.string().nullable(), ...GEO_SCHEMA }).partial().strict()), wrap(async (req, res) => {
  const keys = Object.keys(req.body); if (!keys.length) throw new HttpError(400, 'Aucun champ');
  // Latitude et longitude vont toujours ensemble (les deux renseignées ou les deux vides)
  if (keys.includes('latitude') !== keys.includes('longitude')) throw new HttpError(400, 'Renseignez la latitude ET la longitude (ou videz les deux).');
  if (keys.includes('latitude') && (req.body.latitude === null) !== (req.body.longitude === null)) throw new HttpError(400, 'Renseignez la latitude ET la longitude (ou videz les deux).');
  const { rows: [old] } = await pool.query('SELECT name, tagline, address, phone, email, currency, tax_id, latitude::float AS latitude, longitude::float AS longitude FROM stations WHERE id = $1', [req.sid]);
  await pool.query(`UPDATE stations SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [req.sid, ...keys.map(k => req.body[k])]);
  await audit(pool, req, 'station', 'Modification des informations de la station', 'stations', req.sid, Object.fromEntries(keys.map(k => [k, old[k]])), req.body);
  res.json({ ok: true });
}));


// Grand bandeau d'accueil : titre, slogan, style du texte et résultat du contrôle de lisibilité (calculé sur l'appareil du client).
const bannerStyleSchema = z.object({
  title: z.string().trim().max(60).nullable().optional(),
  tagline: z.string().trim().max(120).nullable().optional(),
  align: z.enum(['left', 'center', 'right']),
  color: z.enum(['auto', 'light', 'dark']),
  overlay: z.number().int().min(0).max(80),
  legibility: z.enum(['ok', 'warn']).nullable().optional(),
  ratio: z.number().min(0).max(25).nullable().optional(),
}).strict();
r.put('/station-banner', body(bannerStyleSchema), wrap(async (req, res) => {
  if (!req.user.perms.has('appearance.manage')) throw new HttpError(403, 'Permission refusée : le bandeau se modifie dans Paramètres → Apparence (droit appearance.manage)');
  const b = req.body;
  if (b.legibility === 'warn') throw new HttpError(422, 'Le nom de la station est illisible sur cette photo : corrigez le réglage du texte ou choisissez une photo plus uniforme.');
  const { rows: [old] } = await pool.query('SELECT banner_title, tagline, banner_style, banner_legibility FROM stations WHERE id = $1', [req.sid]);
  const style = { align: b.align, color: b.color, overlay: b.overlay, ratio: b.ratio ?? null };
  await pool.query(
    `UPDATE stations SET banner_title = $2, banner_style = $3, banner_legibility = $4, banner_checked_at = CASE WHEN $4::text IS NULL THEN NULL ELSE now() END,
            tagline = CASE WHEN $5::boolean THEN $6 ELSE tagline END WHERE id = $1`,
    [req.sid, b.title || null, JSON.stringify(style), b.legibility || null, b.tagline !== undefined, b.tagline || null]);
  await audit(pool, req, 'station', 'Personnalisation du bandeau d’accueil' + (b.legibility === 'warn' ? ' (lisibilité du nom signalée insuffisante)' : ''), 'stations', req.sid,
    { title: old.banner_title, tagline: old.tagline, style: old.banner_style, legibility: old.banner_legibility }, { title: b.title || null, tagline: b.tagline, style, legibility: b.legibility || null });
  res.json({ ok: true });
}));

/** Vue consolidée multi-stations pour le compte client (stations accessibles uniquement). */
r.get('/stations/overview', need('user.manage', 'settings.edit', 'report.view', 'finance.view'), wrap(async (req, res) => {
  if (req.user.is_global) {
    return res.json({ stations: [], totals: null, note: 'Réservé aux comptes clients multi-stations.' });
  }
  const { rows: stations } = await pool.query(
    `SELECT s.id, s.name, s.currency, s.active, s.address, s.phone, s.latitude::float AS latitude, s.longitude::float AS longitude
       FROM stations s
       JOIN user_stations us ON us.station_id = s.id
      WHERE us.user_id = $1 AND s.active = true
      ORDER BY s.name, s.id`,
    [req.user.id]
  );
  const details = [];
  let totalOpenShifts = 0, totalLowStock = 0, totalEmployees = 0;
  for (const s of stations) {
    const [openSh, low, emp, salesToday] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM shifts WHERE station_id=$1 AND status='ouvert'`, [s.id]).catch(swallow('admin:252', { rows: [{ n: 0 }] })),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM products p JOIN stock st ON st.product_id=p.id
          WHERE p.station_id=$1 AND p.deleted_at IS NULL AND p.min_stock > 0 AND st.quantity <= p.min_stock`, [s.id]
      ).catch(swallow('admin:256', { rows: [{ n: 0 }] })),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM employees WHERE station_id=$1 AND deleted_at IS NULL AND status='actif'`, [s.id]
      ).catch(swallow('admin:259', { rows: [{ n: 0 }] })),
      pool.query(
        `SELECT COALESCE(SUM(total),0)::float AS total FROM sales
          WHERE station_id=$1 AND status='valide' AND sold_at::date = CURRENT_DATE`, [s.id]
      ).catch(swallow('admin:263', { rows: [{ total: 0 }] }))
    ]);
    const open_shifts = openSh.rows[0]?.n || 0;
    const low_stock = low.rows[0]?.n || 0;
    const employees = emp.rows[0]?.n || 0;
    const sales_today = Number(salesToday.rows[0]?.total || 0);
    totalOpenShifts += open_shifts;
    totalLowStock += low_stock;
    totalEmployees += employees;
    details.push({
      id: s.id,
      name: s.name,
      currency: s.currency,
      address: s.address,
      phone: s.phone,
      latitude: s.latitude,
      longitude: s.longitude,
      open_shifts,
      low_stock,
      employees,
      sales_today,
      is_current: req.sid != null && Number(req.sid) === Number(s.id)
    });
  }
  const { loadContractForUser, countClientStations } = require('./contracts');
  const contract = await loadContractForUser(req.user.id, false).catch(swallow('admin:288', null));
  res.json({
    stations: details,
    totals: {
      stations: details.length,
      open_shifts: totalOpenShifts,
      low_stock: totalLowStock,
      employees: totalEmployees,
      sales_today: details.reduce((a, x) => a + (x.sales_today || 0), 0)
    },
    quota: contract ? {
      max_stations: contract.max_stations,
      can_create_station: !!contract.can_create_station && !contract.suspended,
      stations_used: await countClientStations(contract.client_id).catch(() => details.length),
      suspended: !!contract.suspended
    } : null
  });
}));

// Nouvelle station : Admin Principal libre ; Gérant uniquement si contrat l'autorise

// Comparaison multi-sites sur une période (CA, achats, stock) — n'altère pas /stations/overview
r.get('/stations/performance', need('user.manage', 'settings.edit', 'report.view', 'finance.view'), wrap(async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const { rows: stations } = await pool.query(
    `SELECT s.id, s.name, s.currency
       FROM stations s
       JOIN user_stations us ON us.station_id = s.id
      WHERE us.user_id = $1 AND s.active = true
      ORDER BY s.name, s.id`,
    [req.user.id]
  );
  const details = [];
  for (const s of stations) {
    const paramsSales = [s.id];
    let salesFilter = `station_id = $1 AND status = 'valide'`;
    if (from) { paramsSales.push(from); salesFilter += ` AND sold_at::date >= $${paramsSales.length}`; }
    if (to) { paramsSales.push(to); salesFilter += ` AND sold_at::date <= $${paramsSales.length}`; }

    const paramsPurch = [s.id];
    let purchFilter = `station_id = $1 AND status <> 'annule'`;
    if (from) { paramsPurch.push(from); purchFilter += ` AND ordered_at::date >= $${paramsPurch.length}`; }
    if (to) { paramsPurch.push(to); purchFilter += ` AND ordered_at::date <= $${paramsPurch.length}`; }

    const [sales, purch, stock, prods] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::float AS ca_ttc
           FROM sales WHERE ${salesFilter}`, paramsSales
      ).catch(swallow('admin:337', { rows: [{ n: 0, ca_ttc: 0 }] })),
      pool.query(
        `SELECT COALESCE(SUM(total),0)::float AS achats FROM purchases WHERE ${purchFilter}`, paramsPurch
      ).catch(swallow('admin:340', { rows: [{ achats: 0 }] })),
      pool.query(
        `SELECT COALESCE(SUM(st.quantity * COALESCE(p.buy_price, 0)), 0)::float AS stock_value
           FROM products p JOIN stock st ON st.product_id = p.id
          WHERE p.station_id = $1 AND p.deleted_at IS NULL`, [s.id]
      ).catch(swallow('admin:345', { rows: [{ stock_value: 0 }] })),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM products WHERE station_id = $1 AND deleted_at IS NULL AND COALESCE(active, TRUE)`, [s.id]
      ).catch(swallow('admin:348', { rows: [{ n: 0 }] }))
    ]);
    const ca_ttc = Number(sales.rows[0]?.ca_ttc || 0);
    // Marge approximative : non disponible sans jointure coûts détaillés — exposer 0 si inconnu
    details.push({
      id: s.id,
      name: s.name,
      currency: s.currency || 'FCFA',
      is_current: req.sid != null && Number(req.sid) === Number(s.id),
      ventes: sales.rows[0]?.n || 0,
      ca_ttc,
      marge_brute: 0,
      taux_marge: 0,
      achats: Number(purch.rows[0]?.achats || 0),
      stock_valorise: Number(stock.rows[0]?.stock_value || 0),
      articles: prods.rows[0]?.n || 0
    });
  }
  res.json({
    from,
    to,
    stations: details,
    totals: {
      ca_ttc: details.reduce((a, x) => a + x.ca_ttc, 0),
      achats: details.reduce((a, x) => a + x.achats, 0),
      stock_valorise: details.reduce((a, x) => a + x.stock_valorise, 0),
      ventes: details.reduce((a, x) => a + x.ventes, 0)
    }
  });
}));

r.post('/stations', need('user.manage'), body(z.object({ name: z.string().min(1), address: z.string().optional(), phone: z.string().optional(), currency: z.string().max(4).default('FCFA'), latitude: GEO_SCHEMA.latitude.optional(), longitude: GEO_SCHEMA.longitude.optional() }).refine(d => (d.latitude == null) === (d.longitude == null), { message: 'Renseignez la latitude ET la longitude (ou aucune des deux).' })), wrap(async (req, res) => {
  const { loadContractForUser, countClientStations } = require('./contracts');
  let clientId = null;
  if (!req.user.is_global) {
    const contract = await loadContractForUser(req.user.id, false);
    if (contract.suspended) throw new HttpError(403, 'Contrat suspendu ou expiré.');
    if (!contract.can_create_station) throw new HttpError(403, 'Création de station non autorisée par votre contrat.');
    if (!contract.client_id) throw new HttpError(403, 'Aucun client lié — contactez l\'Administrateur Principal.');
    const n = await countClientStations(contract.client_id);
    if (contract.max_stations != null && n >= contract.max_stations) {
      throw new HttpError(403, `Limite de stations prévue par votre contrat atteinte (${n}/${contract.max_stations}).`);
    }
    clientId = contract.client_id;
  }
  const st = await tx(async c => {
    const { rows: [s] } = await c.query(
      'INSERT INTO stations(name, address, phone, currency, client_id, latitude, longitude) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, client_id',
      [req.body.name, req.body.address || null, req.body.phone || null, req.body.currency, clientId, req.body.latitude ?? null, req.body.longitude ?? null]
    );
    await c.query("INSERT INTO cash_registers(station_id, name) VALUES ($1, 'Caisse principale')", [s.id]);
    await c.query(`INSERT INTO payment_methods(station_id, code, label, kind) VALUES ($1,'especes','Espèces','especes'),($1,'mobile_money','Mobile Money','mobile_money'),($1,'orange_money','Orange Money','mobile_money'),($1,'wave','Wave','mobile_money'),($1,'carte','Carte bancaire','carte'),($1,'banque','Virement / banque','banque'),($1,'credit','Crédit client','credit'),($1,'autre','Autre','autre')`, [s.id]);
    await c.query('INSERT INTO user_stations(user_id, station_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, s.id]);
    await audit(c, { ...req, sid: s.id }, 'station', 'Création de la station ' + s.name, 'stations', s.id);
    return s;
  });
  res.status(201).json(st);
}));

/** Carte des stations : jeton public Mapbox (pk.*) fourni par l'environnement, jamais une clé secrète (sk.*). */
r.get('/config/map', wrap(async (req, res) => {
  // Jeton PUBLIC (pk.*) : par défaut celui du projet, surchargeable via MAPBOX_TOKEN. Restreignez-le par URL dans le compte Mapbox.
  const token = process.env.MAPBOX_TOKEN || 'pk.eyJ1IjoiYmtvbnRhbyIsImEiOiJjbXZqaTc3bjgwY3plMnhzYzYya21ucGUwIn0.FuEubGHFEOaBoe9WU8R1Yg';
  if (token.startsWith('sk.')) throw new HttpError(500, 'MAPBOX_TOKEN doit être un jeton PUBLIC (pk.…), jamais un jeton secret.');
  res.set('Cache-Control', 'no-store').json({ token: token || null, style: process.env.MAPBOX_STYLE || 'mapbox://styles/mapbox/streets-v12' });
}));

/** Stations positionnables sur la carte : stations accessibles (compte client) ou toutes (Super Admin). */
r.get('/stations/map', need('user.manage', 'settings.edit', 'report.view', 'finance.view'), wrap(async (req, res) => {
  const cols = `s.id, s.name, s.address, s.phone, s.latitude::float AS latitude, s.longitude::float AS longitude, s.client_id, c.name AS client_name`;
  const { rows } = req.user.is_global
    ? await pool.query(`SELECT ${cols} FROM stations s LEFT JOIN clients c ON c.id = s.client_id WHERE s.active = true ORDER BY c.name NULLS LAST, s.name, s.id`)
    : await pool.query(`SELECT ${cols} FROM stations s JOIN user_stations us ON us.station_id = s.id LEFT JOIN clients c ON c.id = s.client_id WHERE us.user_id = $1 AND s.active = true ORDER BY s.name, s.id`, [req.user.id]);
  res.json({
    stations: rows.map(x => ({ ...x, is_current: req.sid != null && Number(req.sid) === Number(x.id), located: x.latitude != null && x.longitude != null })),
    scope: req.user.is_global ? 'all' : 'mine'
  });
}));

// Plafond de permissions par station : administrable uniquement par l'Administrateur Principal.
r.get('/admin/stations/:id/permission-caps', (req,res,next) => req.user?.is_global ? next() : next(new HttpError(403, 'Configuration de plateforme réservée au Super Admin.')), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé à l’Administrateur Principal.');
  const { rows } = await pool.query(
    `SELECT p.code AS permission_code, p.label, COALESCE(c.allowed, true) AS allowed
       FROM permissions p
       LEFT JOIN station_permission_caps c ON c.permission_code=p.code AND c.station_id=$1
      ORDER BY p.code`, [req.params.id]);
  res.json(rows);
}));
r.put('/admin/stations/:id/permission-caps', (req,res,next) => req.user?.is_global ? next() : next(new HttpError(403, 'Configuration de plateforme réservée au Super Admin.')), body(z.object({
  caps: z.array(z.object({ permission_code: z.string().min(1), allowed: z.boolean() }))
})), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé à l’Administrateur Principal.');
  await tx(async c => {
    const { rowCount } = await c.query('SELECT 1 FROM stations WHERE id=$1', [req.params.id]);
    if (!rowCount) throw new HttpError(404, 'Station introuvable');
    for (const cap of req.body.caps) {
      await c.query(
        `INSERT INTO station_permission_caps(station_id, permission_code, allowed, updated_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT(station_id,permission_code)
         DO UPDATE SET allowed=EXCLUDED.allowed, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [req.params.id, cap.permission_code, cap.allowed, req.user.id]);
    }
    await audit(c, req, 'permissions', 'Plafond de permissions station modifié', 'station_permission_caps', +req.params.id, null, req.body.caps);
  });
  res.json({ ok: true });
}));

// Révocation / réactivation d'accès client : conservation intégrale des données.
r.post('/admin/clients/:id/access', need('user.manage'), body(z.object({
  revoked: z.boolean(),
  note: z.string().max(500).optional()
})), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé à l’Administrateur Principal.');
  const out = await tx(async c => {
    const { rows: [ct] } = await c.query(
      'SELECT id, client_id, access_revoked FROM client_contracts WHERE client_id = $1 FOR UPDATE', [req.params.id]);
    if (!ct) throw new HttpError(404, 'Contrat client introuvable');
    await c.query('UPDATE client_contracts SET access_revoked = $2 WHERE id = $1', [ct.id, req.body.revoked]);
    await c.query('UPDATE user_sessions SET revoked_at = now() WHERE user_id IN (SELECT id FROM users WHERE client_id = $1) AND revoked_at IS NULL', [req.params.id]);
    await audit(c, req, 'contrats', req.body.revoked ? 'Accès client révoqué' : 'Accès client réactivé',
      'client_contracts', ct.id, { access_revoked: ct.access_revoked }, { access_revoked: req.body.revoked, note: req.body.note || null });
    return { client_id: +req.params.id, access_revoked: req.body.revoked };
  });
  res.json(out);
}));

// ---------- Images (station, client, fournisseur, employé) : lecture pour tous, modification réservée à image.manage ----------
const ENT = { stations: 'stations', customers: 'customers', suppliers: 'suppliers', employees: 'employees', products: 'products' };
async function entity(req) {
  const banner = req.params.entity === 'banner';   // photo de bandeau de la station courante (colonne banner_path)
  const t = banner ? 'stations' : ENT[req.params.entity];
  if (!t) throw new HttpError(404, 'Type inconnu');
  const col = banner ? 'banner_path' : 'photo_path';
  const { rows: [x] } = t === 'stations'
    ? await pool.query(`SELECT id, ${col} AS photo_path FROM stations WHERE id = $1`, [req.sid])
    : await pool.query(`SELECT id, photo_path FROM ${t} WHERE id = $1 AND station_id = $2`, [req.params.id, req.sid]);
  if (!x) throw new HttpError(404, 'Élément introuvable');
  return { t, x, col };
}
r.get('/images/:entity/:id', wrap(async (req, res) => {
  const { x } = await entity(req), buf = await files.read(x.photo_path);
  if (!buf) throw new HttpError(404, 'Aucune image');
  res.set('Content-Type', await files.typeOf(x.photo_path)).set('Cache-Control', 'private, max-age=60').send(buf);
}));
const canManageImage = (req, res, next) => {
  // Photo du bandeau : réservée à Paramètres → Apparence (appearance.manage), quel que soit le droit image.manage
  if (req.params.entity === 'banner') return req.user.perms.has('appearance.manage') ? next() : next(new HttpError(403, 'Permission refusée : le bandeau se modifie dans Paramètres → Apparence (droit appearance.manage).'));
  const stationIdentity = req.params.entity === 'stations' &&
    (req.user.perms.has('settings.edit') || req.user.perms.has('appearance.manage'));
  // Photo d'un produit : aussi permise à qui gère les prix ou le stock (ces profils n'ont souvent pas image.manage)
  const productPhoto = req.params.entity === 'products' && (req.user.perms.has('price.edit') || req.user.perms.has('stock.adjust'));
  if (req.user.perms.has('image.manage') || stationIdentity || productPhoto) return next();
  return next(new HttpError(403, 'Permission refusée : image.manage ou autorisation de modifier l’identité de la station.'));
};
r.put('/images/:entity/:id', canManageImage, body(z.object({ data_url: z.string().min(20) })), wrap(async (req, res) => {
  const { t, x, col } = await entity(req);
  const rel = await files.save(col === 'banner_path' ? 'banners' : t, req.body.data_url, false);
  await pool.query(`UPDATE ${t} SET ${col} = $1 WHERE id = $2`, [rel, x.id]);
  await files.remove(x.photo_path);
  await audit(pool, req, 'images', `Image ${x.photo_path ? 'remplacée' : 'ajoutée'} : ${t} ${x.id}`, t, x.id);
  res.json({ ok: true });
}));
r.delete('/images/:entity/:id', canManageImage, wrap(async (req, res) => {
  const { t, x, col } = await entity(req);
  await pool.query(`UPDATE ${t} SET ${col} = NULL WHERE id = $1`, [x.id]);
  if (col === 'banner_path') await pool.query('UPDATE stations SET banner_legibility = NULL, banner_checked_at = NULL WHERE id = $1', [x.id]);
  await files.remove(x.photo_path);
  await audit(pool, req, 'images', `Image supprimée : ${t} ${x.id}`, t, x.id);
  res.json({ ok: true });
}));

// Préférences de couleurs communes aux rapports exportés du client (autorisation contractuelle explicite).
const reportColorsSchema = z.object({ primary: color, secondary: color, text: color }).strict();
async function reportColorContext(req) {
  if (req.user.is_global) throw new HttpError(403, 'Les préférences de couleurs se configurent depuis un compte client autorisé.');
  const { rows: [st] } = await pool.query('SELECT client_id FROM stations WHERE id=$1 AND active=true', [req.sid]);
  if (!st?.client_id) throw new HttpError(403, 'Cette station n’est pas rattachée à un client.');
  const { rows: [ct] } = await pool.query('SELECT features, status FROM client_contracts WHERE client_id=$1', [st.client_id]);
  const features = ct?.features || {};
  if (ct?.status === 'suspendu' || !(features.can_customize_report_exports === true || features.modules?.report_colors === true)) {
    throw new HttpError(403, 'La personnalisation des couleurs des rapports n’est pas autorisée par le Super Admin dans votre contrat.');
  }
  return st.client_id;
}
r.get('/report-export-colors', need('appearance.manage', 'settings.edit'), wrap(async (req, res) => {
  const clientId = await reportColorContext(req);
  const { rows: [x] } = await pool.query('SELECT colors FROM client_report_preferences WHERE client_id=$1', [clientId]);
  res.json(x?.colors || { primary: '#0A6B5C', secondary: '#E8F3F0', text: '#111827' });
}));
r.put('/report-export-colors', need('appearance.manage', 'settings.edit'), wrap(async (req, res) => {
  const clientId = await reportColorContext(req);
  const parsed = reportColorsSchema.safeParse(req.body?.colors);
  if (!parsed.success) throw new HttpError(400, 'Couleurs invalides : utilisez le format hexadécimal #RRGGBB.');
  const { rows: [old] } = await pool.query('SELECT colors FROM client_report_preferences WHERE client_id=$1', [clientId]);
  await pool.query(`INSERT INTO client_report_preferences(client_id,colors,updated_by) VALUES ($1,$2::jsonb,$3)
    ON CONFLICT(client_id) DO UPDATE SET colors=EXCLUDED.colors,updated_by=EXCLUDED.updated_by,updated_at=now()`, [clientId, JSON.stringify(parsed.data), req.user.id]);
  await audit(pool, req, 'exports', 'Couleurs globales des rapports modifiées', 'client_report_preferences', clientId, old?.colors || null, parsed.data);
  res.json({ ok: true, colors: parsed.data });
}));

// ---------- Données et maintenance : sauvegardes globales réservées au Super Admin ----------
const needPrincipalMaintenance = (req, res, next) => req.user?.is_global ? next() : next(new HttpError(403, 'Cette fonction de maintenance est réservée au Super Admin.'));
r.get('/admin/backups', needPrincipalMaintenance, wrap(async (req, res) => res.json(backup.list())));
r.get('/admin/backups/logs', needPrincipalMaintenance, wrap(async (req, res) => {
  const logs = await backup.listLogs(+(req.query.limit || 30));
  res.json(logs);
}));
r.post('/admin/backups', needPrincipalMaintenance, wrap(async (req, res) => {
  let out;
  try { out = await backup.runBackup('manual'); }
  catch (e) { throw new HttpError(500, e.message); }
  await audit(pool, req, 'maintenance', 'Sauvegarde manuelle ' + out.name);
  res.status(201).json(out);
}));
r.get('/admin/backups/:name', needPrincipalMaintenance, wrap(async (req, res) => {
  if (!backup.NAME.test(req.params.name)) throw new HttpError(400, 'Nom invalide');
  res.download(require('path').join(backup.dir(), req.params.name));
}));
r.get('/admin/roles', need('user.manage'), wrap(async (req, res) => {
  const mine = req.user.is_global ? null : await RS.myClientId(req.user.id);
  const { rows } = await pool.query(
    `SELECT r.code AS role, r.label, r.client_id, (r.client_id IS NOT NULL) AS custom,
            COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions,
            (SELECT COUNT(*)::int FROM users u WHERE u.role_id = r.id AND u.deleted_at IS NULL) AS users_count
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE r.personal_user_id IS NULL AND ($1::boolean OR (r.code <> 'SUPERADMIN' AND (r.client_id IS NULL OR r.client_id = $2::bigint)))
      GROUP BY r.id ORDER BY r.client_id NULLS FIRST, r.id`, [!!req.user.is_global, mine]);
  // Compte client : le rôle ADMIN n'est visible que par un ADMIN ; jamais le rôle SUPERADMIN.
  const out = req.user.is_global ? rows : rows.filter(x => x.role !== 'ADMIN' || req.user.role === 'ADMIN');
  res.json(out);
}));

r.get('/admin/permissions', need('user.manage'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT code, label FROM permissions ORDER BY code');
  // Gérant : uniquement les permissions qu'il possède lui-même (ne peut pas en accorder plus)
  if (!req.user.is_global) {
    return res.json(rows.filter(p => req.user.perms.has(p.code)));
  }
  res.json(rows);
}));

/** Rôles qu'un utilisateur a le droit d'attribuer */
r.get('/admin/roles/assignable', need('user.manage'), wrap(async (req, res) => {
  // Superadmin : uniquement « Administrateur local ». Les autres rôles relèvent de l'administrateur local du compte.
  if (req.user.is_global) return res.json((await pool.query("SELECT code, label, client_id FROM roles WHERE code = 'ADMIN' ORDER BY id")).rows);
  const mine = await RS.myClientId(req.user.id);
  const { rows } = await pool.query(
    `SELECT r.code, r.label, r.client_id,
            COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE r.personal_user_id IS NULL AND r.code <> 'SUPERADMIN' AND ($2::boolean OR r.code <> 'ADMIN') AND (r.client_id IS NULL OR r.client_id = $1::bigint)
      GROUP BY r.id ORDER BY r.client_id NULLS FIRST, r.id`, [mine, req.user.role === 'ADMIN']);
  // Anti-élévation : seuls les rôles dont toutes les permissions appartiennent à l'utilisateur sont proposés.
  res.json(rows.filter(r => r.permissions.every(c => req.user.perms.has(c))).map(({ permissions, ...x }) => x));
}));

r.post('/admin/roles', need('user.manage'), body(z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z][A-Z0-9_]*$/, 'CODE_MAJUSCULES').optional(),
  label: z.string().trim().min(2).max(80),
  permissions: z.array(z.string()).default([])
})), wrap(async (req, res) => {
  if (!req.user.is_global) {
    // Compte client : rôle personnalisé rattaché à SON organisation, limité à ses propres permissions.
    const { loadContractForUser } = require('./contracts');
    const contract = await loadContractForUser(req.user.id, false);
    if (contract.suspended) throw new HttpError(403, 'Contrat suspendu ou expiré.');
    if (!contract.can_manage_users) throw new HttpError(403, 'Gestion des utilisateurs et des rôles non autorisée par votre contrat.');
    const clientId = await RS.myClientId(req.user.id);
    if (!clientId) throw new HttpError(403, 'Aucun client lié à ce compte.');
    RS.assertDelegable(req, req.body.permissions);
    const { rows: [n] } = await pool.query('SELECT COUNT(*)::int AS n FROM roles WHERE client_id = $1::bigint AND personal_user_id IS NULL', [clientId]);
    if (n.n >= 30) throw new HttpError(409, 'Limite de 30 rôles personnalisés atteinte.');
    const { rows: [dup] } = await pool.query('SELECT 1 FROM roles WHERE client_id = $1::bigint AND lower(label) = lower($2)', [clientId, req.body.label]);
    if (dup) throw new HttpError(409, 'Un rôle portant ce nom existe déjà dans votre organisation.');
    const code = RS.customCode(clientId, req.body.label);
    const out = await tx(async c => {
      const { rows: [r] } = await c.query('INSERT INTO roles(code, label, client_id) VALUES ($1,$2,$3::bigint) RETURNING id, code, label', [code, req.body.label, clientId]);
      for (const pc of [...new Set(req.body.permissions)]) {
        const { rows: [p] } = await c.query('SELECT id FROM permissions WHERE code = $1', [pc]);
        if (p) await c.query('INSERT INTO role_permissions(role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.id, p.id]);
      }
      await audit(c, req, 'rôles', `Rôle personnalisé créé ${r.code}`, 'roles', r.id, null, { label: r.label, permissions: req.body.permissions });
      return r;
    });
    return res.status(201).json(out);
  }
  // Séparation des pouvoirs : les rôles des employés sont définis par l'administrateur local de chaque compte, jamais par le Super Admin.
  throw new HttpError(403, "Le Super Admin ne définit pas les rôles des employés : chaque administrateur local crée et attribue les rôles de son organisation.");
  if (!req.body.code) throw new HttpError(400, 'Le code du rôle est requis.');
  if (['ADMIN', 'SUPERADMIN'].includes(req.body.code)) throw new HttpError(400, 'Ce rôle est réservé.');
  const out = await tx(async c => {
    const { rows: [r] } = await c.query(
      'INSERT INTO roles(code, label) VALUES ($1,$2) RETURNING id, code, label',
      [req.body.code, req.body.label]
    );
    for (const code of req.body.permissions) {
      const { rows: [p] } = await c.query('SELECT id FROM permissions WHERE code = $1', [code]);
      if (p) await c.query('INSERT INTO role_permissions(role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.id, p.id]);
    }
    await audit(c, req, 'rôles', `Rôle créé ${r.code}`, 'roles', r.id, null, req.body);
    return r;
  });
  res.status(201).json(out);
}));

/** Attribution en groupe : un même rôle donné à plusieurs employés du compte (administrateur local uniquement). */
r.post('/admin/roles/:code/assign', need('role.assign', 'user.manage'), body(z.object({
  user_ids: z.array(z.coerce.number().int().positive()).min(1).max(100)
})), wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(403, "L'attribution des rôles aux employés relève de l'administrateur local de chaque compte.");
  const RSx = require('./roles_scope'), code = req.params.code;
  await RSx.assertAssignableRole(req, code);
  const mine = await RSx.myClientId(req.user.id);
  const { rows: [role] } = await pool.query('SELECT id FROM roles WHERE code = $1', [code]);
  const done = [], skipped = [];
  for (const uid of [...new Set(req.body.user_ids)]) {
    try {
      if (uid === req.user.id) throw new Error('votre propre compte');
      const { rows: [t] } = await pool.query('SELECT u.id, u.login, u.is_global, u.client_id, r.code AS role, r.personal_user_id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.deleted_at IS NULL', [uid]);
      if (!t) throw new Error('introuvable');
      if (t.is_global || String(t.client_id) !== String(mine)) throw new Error('hors de votre organisation');
      if (t.role === 'ADMIN' && req.user.role !== 'ADMIN') throw new Error('administrateur local');
      await pool.query('UPDATE users SET role_id = $2 WHERE id = $1', [uid, role.id]);
      await audit(pool, req, 'utilisateurs', `Rôle de ${t.login} : ${t.role} → ${code} (attribution en groupe)`, 'users', uid, { role: t.role }, { role: code });
      await require('./role_sync').syncFromUser(pool, req, uid, code).catch(() => {});
      done.push(uid);
    } catch (e) { skipped.push({ id: uid, reason: e.message }); }
  }
  res.json({ role: code, updated: done.length, skipped });
}));

r.put('/admin/roles/:code/permissions', need('user.manage'), body(z.object({
  permissions: z.array(z.string())
})), wrap(async (req, res) => {
  const code = req.params.code;
  if (['ADMIN', 'SUPERADMIN'].includes(code) && !req.user.is_global) throw new HttpError(403, 'Impossible de modifier les permissions de ce rôle.');
  if (req.user.is_global && code !== 'ADMIN') throw new HttpError(403, "Le Super Admin ne définit que le rôle Administrateur local : les rôles des employés relèvent de l'administrateur local de chaque compte.");
  if (!req.user.is_global) {
    // Compte client : uniquement ses propres rôles personnalisés, et seulement avec ses propres permissions.
    const mine = await RS.myClientId(req.user.id);
    const { rows: [own] } = await pool.query('SELECT client_id FROM roles WHERE code = $1', [code]);
    if (!own || own.client_id == null || String(own.client_id) !== mine) throw new HttpError(403, 'Seuls vos rôles personnalisés peuvent être modifiés ; les rôles communs sont gérés par l\'Administrateur Principal.');
    RS.assertDelegable(req, req.body.permissions);
  }

  const out = await tx(async c => {
    const { rows: [role] } = await c.query('SELECT id, code FROM roles WHERE code = $1', [code]);
    if (!role) throw new HttpError(404, 'Rôle introuvable');
    const { rows: oldPerms } = await c.query(
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`, [role.id]
    );
    await c.query('DELETE FROM role_permissions WHERE role_id = $1', [role.id]);
    const applied = [];
    for (const pcode of req.body.permissions) {
      const { rows: [p] } = await c.query('SELECT id, code FROM permissions WHERE code = $1', [pcode]);
      if (!p) continue;
      await c.query('INSERT INTO role_permissions(role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [role.id, p.id]);
      applied.push(p.code);
    }
    // ADMIN doit toujours garder user.manage
    if (code === 'ADMIN') {
      const { rows: keepP } = await c.query(`SELECT id FROM permissions WHERE code IN ('user.manage','role.assign')`);
      for (const um of keepP) await c.query('INSERT INTO role_permissions(role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [role.id, um.id]);
    }
    await audit(c, req, 'rôles', `Permissions du rôle ${code} mises à jour`, 'roles', role.id,
      { permissions: oldPerms.map(x => x.code) }, { permissions: applied });
    return { role: code, permissions: applied };
  });
  res.json(out);
}));

r.patch('/admin/roles/:code', need('user.manage'), body(z.object({
  label: z.string().min(2).max(80)
})), wrap(async (req, res) => {
  if (req.user.is_global && req.params.code !== 'ADMIN') throw new HttpError(403, "Le Super Admin ne gère que le rôle Administrateur local.");
  if (!req.user.is_global) {
    const mine = await RS.myClientId(req.user.id);
    const { rows: [own] } = await pool.query('SELECT client_id FROM roles WHERE code = $1', [req.params.code]);
    if (!own || own.client_id == null || String(own.client_id) !== mine) throw new HttpError(403, 'Seuls vos rôles personnalisés peuvent être renommés.');
  }
  const { rows: [r] } = await pool.query(
    'UPDATE roles SET label = $2 WHERE code = $1 RETURNING code, label', [req.params.code, req.body.label]
  );
  if (!r) throw new HttpError(404, 'Rôle introuvable');
  await audit(pool, req, 'rôles', `Libellé rôle ${r.code}`, 'roles', null, null, r);
  res.json(r);
}));


r.delete('/admin/roles/:code', need('user.manage'), wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(403, "Les rôles des employés sont supprimés par l'administrateur local de leur organisation.");
  const { rows: [role] } = await pool.query('SELECT id, code, client_id FROM roles WHERE code = $1', [req.params.code]);
  if (!role) throw new HttpError(404, 'Rôle introuvable');
  if (role.client_id == null) throw new HttpError(403, 'Les rôles communs de la plateforme ne peuvent pas être supprimés.');
  if (!req.user.is_global && String(role.client_id) !== await RS.myClientId(req.user.id)) throw new HttpError(403, 'Ce rôle appartient à une autre organisation.');
  const { rows: [n] } = await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE role_id = $1 AND deleted_at IS NULL', [role.id]);
  if (n.n > 0) throw new HttpError(409, `Ce rôle est attribué à ${n.n} utilisateur(s) : réattribuez-leur un autre rôle avant de le supprimer.`);
  await tx(async c => {
    await c.query('DELETE FROM role_permissions WHERE role_id = $1', [role.id]);
    await c.query('DELETE FROM roles WHERE id = $1', [role.id]);
    await audit(c, req, 'rôles', `Rôle personnalisé supprimé ${role.code}`, 'roles', role.id, null, null);
  });
  res.json({ ok: true });
}));

// P12 — Vue d'ensemble centre admin (agrégats légers)
r.get('/admin/overview', need('user.manage', 'settings.edit'), wrap(async (req, res) => {
  const sid = req.sid;
  const [users, roles, backups, settingsKeys, station] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM login_throttle t WHERE t.login = lower(u.login) AND t.lockout_until > now()))::int AS locked
                FROM users u WHERE u.deleted_at IS NULL
                  AND ( $1::int IS NULL OR EXISTS (SELECT 1 FROM user_stations us WHERE us.user_id = u.id AND us.station_id = $1) )`,
               [req.user.is_global ? null : sid]),
    pool.query('SELECT COUNT(*)::int AS n FROM roles'),
    Promise.resolve(backup.list()),
    pool.query('SELECT key FROM settings WHERE station_id = $1 ORDER BY key', [sid]),
    pool.query('SELECT id, name, currency FROM stations WHERE id = $1', [sid])
  ]);
  res.json({
    users: users.rows[0].n,
    locked_users: users.rows[0].locked,
    roles: roles.rows[0].n,
    backups: (backups || []).length,
    settings_keys: settingsKeys.rows.map(r => r.key),
    station: station.rows[0] || null,
    is_global: !!req.user.is_global,
    role: req.user.role,
    app_version: (() => { try { return require('../package.json').version; } catch { return null; } })()   // ANO-14 : version unique (package.json)
  });
}));

r.get('/admin/info', (req,res,next) => req.user?.is_global ? next() : next(new HttpError(403, 'Informations de maintenance réservées au Super Admin.')), wrap(async (req, res) => {
  const [v, m] = await Promise.all([pool.query('SHOW server_version'), pool.query('SELECT name, applied_at FROM schema_migrations ORDER BY name').catch(swallow('admin:747', { rows: [] }))]);
  const logs = await backup.listLogs(5);
  const last = logs[0] || null;
  let dumpDiag = null;
  try { dumpDiag = backup.diagnose(); } catch (_) {}
  res.json({
    node: process.version,
    postgres: v.rows[0].server_version,
    uptime_s: Math.round(process.uptime()),
    host: os.hostname(),
    migrations: m.rows,
    backups: backup.list().length,
    backup_auto: process.env.BACKUP_AUTO === '1',
    backup_hour: +(process.env.BACKUP_HOUR || 2),
    last_backup: last,
    mail_configured: !!(process.env.SMTP_HOST || process.env.MAIL_MODE),
    pg_dump: dumpDiag
  });
}));

module.exports = r;
module.exports.getSetting = getSetting;
module.exports.KEYS = KEYS;
module.exports.AD = AD;
