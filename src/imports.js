// Imports Excel / CSV par lot — produits, clients, fournisseurs, employés.
// Accepte un fichier base64 (.xlsx) ou un tableau de lignes déjà parsées.
const express = require('express');
const ExcelJS = require('exceljs');
const { z } = require('zod');
const { pool, tx, fl, HttpError, wrap, body, need, audit, stockMove, cashMove, accountMove, assertLinkedMethod, ledger, defaultReg, payMethod } = require('./core');
const docs = require('./docs');
const r = express.Router();

const KINDS = {
  products: {
    label: 'Produits',
    perm: 'price.edit',
    columns: [
      { key: 'category', label: 'Catégorie', required: true },
      { key: 'name', label: 'Nom', required: true },
      { key: 'unit', label: 'Unité', required: false },
      { key: 'buy_price', label: 'Prix achat', required: false },
      { key: 'sell_price', label: 'Prix vente', required: true },
      { key: 'min_stock', label: 'Seuil min', required: false },
      { key: 'initial_stock', label: 'Stock initial', required: false }
    ],
    sample: [
      ['CARBURANT', 'Essence Super', 'L', 650, 750, 500, 0],
      ['LUBRIFIANT', 'Huile 15W40', 'L', 3000, 4500, 10, 20],
      ['BOUTIQUE', 'Eau 1.5L', 'U', 200, 350, 24, 48]
    ]
  },
  customers: {
    label: 'Clients',
    perm: 'customer.edit',
    columns: [
      { key: 'kind', label: 'Type', required: true },
      { key: 'name', label: 'Nom', required: true },
      { key: 'phone', label: 'Téléphone', required: false },
      { key: 'email', label: 'Email', required: false },
      { key: 'company', label: 'Entreprise', required: false },
      { key: 'credit_limit', label: 'Plafond crédit', required: false },
      { key: 'notes', label: 'Notes', required: false }
    ],
    sample: [
      ['particulier', 'Amadou Diallo', '770000001', '', '', 0, ''],
      ['entreprise', 'Transport SA', '338001122', 'contact@transport.sn', 'Transport SA', 500000, 'Client flotte']
    ]
  },
  suppliers: {
    label: 'Fournisseurs',
    perm: 'supplier.edit',
    columns: [
      { key: 'name', label: 'Nom', required: true },
      { key: 'company', label: 'Entreprise', required: false },
      { key: 'phone', label: 'Téléphone', required: false },
      { key: 'email', label: 'Email', required: false },
      { key: 'address', label: 'Adresse', required: false },
      { key: 'contact', label: 'Contact', required: false }
    ],
    sample: [
      ['Petro Service', 'Petro Service SARL', '338009900', 'cmd@petro.sn', 'Dakar', 'M. Fall'],
      ['Grossiste Boutique', '', '771112233', '', 'Thiès', '']
    ]
  },
  employees: {
    label: 'Employés',
    perm: 'settings.edit',
    columns: [
      { key: 'matricule', label: 'Matricule', required: true },
      { key: 'last_name', label: 'Nom', required: true },
      { key: 'first_name', label: 'Prénom', required: true },
      { key: 'phone', label: 'Téléphone', required: false },
      { key: 'position', label: 'Fonction', required: false },
      { key: 'hired_on', label: 'Date embauche', required: false }
    ],
    sample: [
      ['EMP001', 'Ndiaye', 'Fatou', '770001111', 'Pompiste', '2024-01-15'],
      ['EMP002', 'Sarr', 'Ibrahima', '770002222', 'Caissier', '2023-06-01']
    ]
  },
  sales: {
    label: 'Ventes produits',
    perm: 'sale.create',
    columns: [
      { key: 'product_name', label: 'Produit', required: true },
      { key: 'quantity', label: 'Quantité', required: true },
      { key: 'payment_method', label: 'Paiement', required: false },
      { key: 'customer_name', label: 'Client', required: false },
      { key: 'employee_matricule', label: 'Matricule employé', required: false }
    ],
    sample: [
      ['Huile 15W40', 2, 'especes', '', 'EMP001'],
      ['Eau 1.5L', 6, 'mobile_money', 'Amadou Diallo', ''],
      ['Eau 1.5L', 1, 'credit', 'Transport SA', 'EMP002']
    ]
  }
};

function num(v, def = 0) {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}
function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Parse un buffer xlsx → tableau d'objets selon les colonnes du kind. */
async function parseXlsx(buf, kind) {
  const meta = KINDS[kind];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(400, 'Fichier Excel vide');

  // Trouver la ligne d'en-tête (modèles avec titre/branding : en-tête souvent ligne 6)
  const labels = meta.columns.map(c => c.label.toLowerCase());
  const keys = meta.columns.map(c => c.key.toLowerCase());
  let headerRow = 1;
  let bestScore = 0;
  const maxScan = Math.min(ws.rowCount || 30, 30);
  for (let r = 1; r <= maxScan; r++) {
    const cells = [];
    ws.getRow(r).eachCell((cell, col) => {
      cells[col] = str(cell.value).toLowerCase();
    });
    let score = 0;
    for (let i = 1; i < cells.length; i++) {
      const h = cells[i] || '';
      if (labels.includes(h) || keys.includes(h) || keys.includes(h.replace(/\s/g, '_'))) score++;
    }
    if (score > bestScore) { bestScore = score; headerRow = r; }
    if (score >= Math.min(2, meta.columns.length)) break;
  }

  const headers = [];
  ws.getRow(headerRow).eachCell((cell, col) => {
    headers[col] = str(cell.value).toLowerCase();
  });
  const map = {};
  for (const c of meta.columns) {
    const label = c.label.toLowerCase();
    const key = c.key.toLowerCase();
    for (let i = 1; i < headers.length; i++) {
      const h = headers[i] || '';
      if (h === label || h === key || h.replace(/\s/g, '_') === key) {
        map[c.key] = i;
        break;
      }
    }
  }
  if (Object.keys(map).length < 2) {
    meta.columns.forEach((c, i) => { map[c.key] = i + 1; });
  }

  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const obj = { __line: rowNumber };
    let empty = true;
    for (const c of meta.columns) {
      const col = map[c.key];
      const val = col ? row.getCell(col).value : null;
      const raw = val && typeof val === 'object' && val.text != null ? val.text
        : val && typeof val === 'object' && val.result != null ? val.result
        : val;
      obj[c.key] = raw;
      if (str(raw)) empty = false;
    }
    if (!empty) rows.push(obj);
  });
  return rows;
}

async function importProducts(c, sid, userId, row, i) {
  const category = str(row.category).toUpperCase() || 'AUTRES';
  const name = str(row.name);
  if (!name) throw new Error(`Ligne ${i}: nom obligatoire`);
  const { rows: [cat] } = await c.query('SELECT id FROM categories WHERE code = $1', [category]);
  if (!cat) throw new Error(`Ligne ${i}: catégorie inconnue « ${category} »`);
  const { rows: [exist] } = await c.query(
    'SELECT id FROM products WHERE station_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL',
    [sid, name]
  );
  if (exist) return { status: 'skip', reason: 'déjà existant', id: exist.id, name };
  const unit = str(row.unit) || 'U';
  const buy = num(row.buy_price, 0);
  const sell = num(row.sell_price, 0);
  const minS = num(row.min_stock, 0);
  const initS = num(row.initial_stock, 0);
  const { rows: [p] } = await c.query(
    `INSERT INTO products(station_id, category_id, name, unit, buy_price, sell_price, tax_rate, min_stock)
     VALUES ($1,$2,$3,$4,$5,$6,0,$7) RETURNING id, name`,
    [sid, cat.id, name, unit, buy, sell, minS]
  );
  await c.query('INSERT INTO stock(product_id, station_id, quantity) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [p.id, sid]);
  if (initS > 0) {
    await stockMove(c, { station: sid, product: p.id, kind: 'entree', qty: initS, comment: 'Import Excel', by: userId });
  }
  return { status: 'ok', id: p.id, name: p.name };
}

async function importCustomers(c, sid, _userId, row, i) {
  const name = str(row.name);
  if (!name) throw new Error(`Ligne ${i}: nom obligatoire`);
  let kind = str(row.kind).toLowerCase() || 'particulier';
  if (!['particulier', 'entreprise', 'professionnel', 'credit'].includes(kind)) kind = 'particulier';
  const { rows: [exist] } = await c.query(
    'SELECT id FROM customers WHERE station_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL',
    [sid, name]
  );
  if (exist) return { status: 'skip', reason: 'déjà existant', id: exist.id, name };
  const { rows: [cu] } = await c.query(
    `INSERT INTO customers(station_id, kind, name, phone, email, address, company, tax_id, credit_limit, notes, loyalty_tier)
     VALUES ($1,$2,$3,$4,$5,null,$6,null,$7,$8,'standard') RETURNING id, name`,
    [sid, kind, name, str(row.phone) || null, str(row.email) || null, str(row.company) || null,
     num(row.credit_limit, 0), str(row.notes) || null]
  );
  return { status: 'ok', id: cu.id, name: cu.name };
}

async function importSuppliers(c, sid, _userId, row, i) {
  const name = str(row.name);
  if (!name) throw new Error(`Ligne ${i}: nom obligatoire`);
  const { rows: [exist] } = await c.query(
    'SELECT id FROM suppliers WHERE station_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL',
    [sid, name]
  );
  if (exist) return { status: 'skip', reason: 'déjà existant', id: exist.id, name };
  const { rows: [s] } = await c.query(
    `INSERT INTO suppliers(station_id, name, company, phone, email, address, contact)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name`,
    [sid, name, str(row.company) || null, str(row.phone) || null, str(row.email) || null,
     str(row.address) || null, str(row.contact) || null]
  );
  return { status: 'ok', id: s.id, name: s.name };
}

async function importEmployees(c, sid, _userId, row, i) {
  const last = str(row.last_name);
  const first = str(row.first_name);
  const mat = str(row.matricule);
  if (!last || !first) throw new Error(`Ligne ${i}: nom et prénom obligatoires`);
  if (!mat) throw new Error(`Ligne ${i}: matricule obligatoire`);
  const { rows: [exist] } = await c.query(
    'SELECT id FROM employees WHERE station_id = $1 AND (matricule = $2 OR (lower(last_name)=lower($3) AND lower(first_name)=lower($4))) AND deleted_at IS NULL',
    [sid, mat, last, first]
  );
  if (exist) return { status: 'skip', reason: 'déjà existant', id: exist.id, name: `${first} ${last}` };
  let hired = str(row.hired_on) || null;
  if (hired && !/^\d{4}-\d{2}-\d{2}$/.test(hired)) {
    // Excel date serial or other formats: try Date
    const d = new Date(hired);
    hired = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  }
  const { rows: [e] } = await c.query(
    `INSERT INTO employees(station_id, matricule, last_name, first_name, phone, position, hired_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, first_name, last_name`,
    [sid, mat, last, first, str(row.phone) || null, str(row.position) || null, hired]
  );
  return { status: 'ok', id: e.id, name: `${e.first_name} ${e.last_name}` };
}


/** Une ligne Excel = une vente produit (hors carburant). Exige un quart ouvert. */
async function importSales(c, sid, userId, row, i) {
  const productName = str(row.product_name);
  const qty = num(row.quantity, 0);
  if (!productName) throw new Error(`Ligne ${i}: produit obligatoire`);
  if (!(qty > 0)) throw new Error(`Ligne ${i}: quantité invalide`);

  const { rows: [sh] } = await c.query(
    "SELECT * FROM shifts WHERE station_id = $1 AND status = 'ouvert' FOR SHARE", [sid]
  );
  if (!sh) throw new Error(`Ligne ${i}: aucun quart ouvert — ouvrez un quart avant d'importer des ventes`);

  const { rows: [prod] } = await c.query(
    `SELECT p.*, cat.code AS cat FROM products p
     JOIN categories cat ON cat.id = p.category_id
     WHERE p.station_id = $1 AND lower(p.name) = lower($2) AND p.active AND p.deleted_at IS NULL`,
    [sid, productName]
  );
  if (!prod) throw new Error(`Ligne ${i}: produit introuvable « ${productName} »`);
  if (prod.cat === 'CARBURANT') {
    throw new Error(`Ligne ${i}: le carburant ne s'importe pas ici (saisie par compteur / + Vente carburant)`);
  }

  const { rows: [st] } = await c.query(
    'SELECT quantity FROM stock WHERE product_id = $1 FOR UPDATE', [prod.id]
  );
  if (!st || Number(st.quantity) < qty) {
    throw new Error(`Ligne ${i}: stock insuffisant pour « ${productName} » (dispo ${st ? st.quantity : 0})`);
  }

  // Employé
  let empId = null;
  const mat = str(row.employee_matricule);
  if (mat) {
    const { rows: [e] } = await c.query(
      'SELECT id FROM employees WHERE station_id = $1 AND matricule = $2 AND deleted_at IS NULL',
      [sid, mat]
    );
    if (!e) throw new Error(`Ligne ${i}: matricule employé inconnu « ${mat} »`);
    empId = e.id;
  } else {
    const { rows: [e] } = await c.query(
      'SELECT id FROM employees WHERE user_id = $1 AND station_id = $2 AND deleted_at IS NULL',
      [userId, sid]
    );
    empId = e?.id || null;
  }
  if (!empId) throw new Error(`Ligne ${i}: employé requis (matricule ou compte lié)`);

  // Client
  let customerId = null;
  const cname = str(row.customer_name);
  if (cname) {
    const { rows: [cu] } = await c.query(
      'SELECT id, credit_limit, balance FROM customers WHERE station_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL',
      [sid, cname]
    );
    if (!cu) throw new Error(`Ligne ${i}: client introuvable « ${cname} »`);
    customerId = cu.id;
  }

  let method = str(row.payment_method).toLowerCase() || 'especes';
  if (!method) method = 'especes';

  // Montant = prix serveur (jamais saisi dans le fichier)
  const amount = fl(qty * Number(prod.sell_price));

  const { rows: [sale] } = await c.query(
    `INSERT INTO sales(station_id, shift_id, employee_id, pump_id, customer_id, total, kind)
     VALUES ($1,$2,$3,null,$4,$5,'produits') RETURNING id`,
    [sid, sh.id, empId, customerId, amount]
  );
  await c.query(
    `INSERT INTO sale_details(sale_id, product_id, quantity, unit_price, unit_cost, tax_rate, amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [sale.id, prod.id, qty, prod.sell_price, prod.buy_price, prod.tax_rate || 0, amount]
  );
  await stockMove(c, {
    station: sid, product: prod.id, kind: 'vente', qty: -qty,
    shift: sh.id, ref: ['sales', sale.id], by: userId
  });

  const pm = await payMethod(c, sid, method);
  if (pm.kind === 'credit') {
    if (!customerId) throw new Error(`Ligne ${i}: client obligatoire pour un paiement à crédit`);
    const { rows: [cu] } = await c.query(
      'SELECT * FROM customers WHERE id = $1 AND station_id = $2 FOR UPDATE', [customerId, sid]
    );
    if (cu.credit_limit > 0 && Number(cu.balance) + amount > Number(cu.credit_limit)) {
      throw new Error(`Ligne ${i}: limite de crédit dépassée pour ${cu.name}`);
    }
    await c.query('UPDATE customers SET balance = balance + $2 WHERE id = $1 AND station_id = $3', [customerId, amount, sid]);
    await ledger(c, { customer: customerId, station: sid, kind: 'credit', amount, ref: ['sales', sale.id], by: userId });
  } else if (pm.kind === 'especes') {
    await cashMove(c, {
      reg: await defaultReg(c, sid), shift: sh.id, kind: 'encaissement',
      amount, label: 'Vente import N° ' + sale.id, ref: ['sales', sale.id], by: userId
    });
  } else {
    await assertLinkedMethod(c, sid, method);
    const accId = await accountMove(c, {
      station: sid, method, amount, label: 'Vente import N° ' + sale.id,
      ref: ['sales', sale.id], shift: sh.id, by: userId
    });
    if (accId == null) throw new Error(`Ligne ${i}: aucun compte rattaché au moyen de paiement « ${method} »`);
  }
  await c.query(
    'INSERT INTO payments(station_id, sale_id, shift_id, method, amount, reference, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [sid, sale.id, sh.id, method, amount, 'import', userId]
  );
  const inv = `${sid}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${sale.id}`;
  await c.query('UPDATE sales SET invoice_no = $2 WHERE id = $1 AND station_id = $3', [sale.id, inv, sid]);

  return { status: 'ok', id: sale.id, name: `${productName} × ${qty} = ${amount}` };
}

const IMPORTERS = {
  products: importProducts,
  customers: importCustomers,
  suppliers: importSuppliers,
  employees: importEmployees,
  sales: importSales
};

// Catalogue des types d'import
r.get('/imports/kinds', need('price.edit', 'customer.edit', 'supplier.edit', 'settings.edit', 'sale.create'), wrap(async (req, res) => {
  const list = Object.entries(KINDS).map(([k, v]) => ({
    key: k,
    label: v.label,
    columns: v.columns,
    allowed: req.user.perms.has(v.perm) || req.user.is_global
  }));
  res.json(list);
}));

// Télécharger un modèle Excel
r.get('/imports/template/:kind', need('price.edit', 'customer.edit', 'supplier.edit', 'settings.edit', 'sale.create'), wrap(async (req, res) => {
  const kind = req.params.kind;
  const meta = KINDS[kind];
  if (!meta) throw new HttpError(404, 'Type d\'import inconnu');
  if (!req.user.perms.has(meta.perm) && !req.user.is_global) throw new HttpError(403, 'Permission insuffisante');
  // Modèle minimal : ligne 1 = en-têtes, lignes suivantes = exemples (pas de titre branding)
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(String(meta.label).slice(0, 31));
  const head = meta.columns.map(c => c.label);
  ws.addRow(head);
  ws.getRow(1).font = { bold: true };
  (meta.sample || []).forEach(r => ws.addRow(r));
  meta.columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(12, c.label.length + 2); });
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="modele-import-${kind}.xlsx"`);
  return res.send(buf);
}));

// Import par lot
r.post('/imports/:kind', need('price.edit', 'customer.edit', 'supplier.edit', 'settings.edit', 'sale.create'), body(z.object({
  file_base64: z.string().optional(),
  rows: z.array(z.record(z.any())).optional(),
  dry_run: z.boolean().optional()
})), wrap(async (req, res) => {
  const kind = req.params.kind;
  const meta = KINDS[kind];
  if (!meta) throw new HttpError(404, 'Type d\'import inconnu');
  if (!req.user.perms.has(meta.perm) && !req.user.is_global) throw new HttpError(403, 'Permission insuffisante pour ' + meta.label);

  let rows = req.body.rows;
  if (!rows && req.body.file_base64) {
    const b64 = req.body.file_base64.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 5 * 1024 * 1024) throw new HttpError(400, 'Fichier trop volumineux (max 5 Mo)');
    rows = await parseXlsx(buf, kind);
  }
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'Aucune ligne à importer');
  if (rows.length > 2000) throw new HttpError(400, 'Maximum 2000 lignes par import');

  const importer = IMPORTERS[kind];
  const results = { ok: 0, skip: 0, error: 0, details: [] };
  const dry = !!req.body.dry_run;

  if (dry) {
    // Validation seule — numéros de ligne = ligne Excel réelle si disponible
    rows.forEach((row, idx) => {
      const i = row.__line || (idx + 2);
      try {
        for (const col of meta.columns.filter(c => c.required)) {
          if (!str(row[col.key])) throw new Error(`Ligne ${i}: ${col.label} obligatoire`);
        }
        results.ok++;
        results.details.push({ line: i, status: 'ok', name: str(row.name || row.last_name || row.matricule) });
      } catch (e) {
        results.error++;
        results.details.push({ line: i, status: 'error', message: e.message });
      }
    });
    return res.json({ dry_run: true, kind, ...results, total: rows.length });
  }

  await tx(async c => {
    for (let idx = 0; idx < rows.length; idx++) {
      const i = rows[idx].__line || (idx + 2);
      const sp = 'imp_' + idx;
      try {
        await c.query('SAVEPOINT ' + sp);
        const r = await importer(c, req.sid, req.user.id, rows[idx], i);
        await c.query('RELEASE SAVEPOINT ' + sp);
        if (r.status === 'ok') results.ok++;
        else results.skip++;
        results.details.push({ line: i, ...r });
      } catch (e) {
        try { await c.query('ROLLBACK TO SAVEPOINT ' + sp); } catch (_) {}
        try { await c.query('RELEASE SAVEPOINT ' + sp); } catch (_) {}
        results.error++;
        results.details.push({ line: i, status: 'error', message: e.message });
      }
    }
    await audit(c, req, 'imports', `Import ${kind}: ${results.ok} ok, ${results.skip} ignorés, ${results.error} erreurs`, 'imports', null, null, {
      kind, ok: results.ok, skip: results.skip, error: results.error
    });
  });

  res.status(201).json({ dry_run: false, kind, ...results, total: rows.length });
}));


// Prévisualisation + validation ligne par ligne (aucune écriture)
r.post('/imports/:kind/preview', need('price.edit', 'customer.edit', 'supplier.edit', 'settings.edit', 'sale.create'), body(z.object({
  file_base64: z.string().optional(),
  rows: z.array(z.record(z.any())).optional()
})), wrap(async (req, res) => {
  const kind = req.params.kind;
  const meta = KINDS[kind];
  if (!meta) throw new HttpError(404, 'Type d\'import inconnu');
  if (!req.user.perms.has(meta.perm) && !req.user.is_global) throw new HttpError(403, 'Permission insuffisante');

  let rows = req.body.rows;
  if (!rows && req.body.file_base64) {
    const b64 = req.body.file_base64.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 5 * 1024 * 1024) throw new HttpError(400, 'Fichier trop volumineux (max 5 Mo)');
    rows = await parseXlsx(buf, kind);
  }
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'Aucune ligne détectée');
  if (rows.length > 2000) throw new HttpError(400, 'Maximum 2000 lignes');

  const details = [];
  let ok = 0, error = 0;
  rows.forEach((row, idx) => {
    const line = row.__line || (idx + 2);
    const fieldErrors = [];
    for (const col of meta.columns) {
      const v = str(row[col.key]);
      if (col.required && !v) fieldErrors.push(`${col.label} obligatoire`);
    }
    // Contrôles légers spécifiques
    if (kind === 'products') {
      const cat = str(row.category).toUpperCase();
      if (cat && !['CARBURANT','LUBRIFIANT','HUILE','ACCESSOIRES','BOUTIQUE','AUTRES'].includes(cat)) {
        fieldErrors.push(`Catégorie inconnue « ${cat} »`);
      }
      if (row.sell_price != null && row.sell_price !== '' && isNaN(Number(row.sell_price))) {
        fieldErrors.push('Prix vente non numérique');
      }
    }
    if (kind === 'customers') {
      const k = str(row.kind).toLowerCase();
      if (k && !['particulier','entreprise','flotte','autre'].includes(k) && k.length > 0) {
        // soft warning only if empty type already caught
      }
    }
    if (fieldErrors.length) {
      error++;
      details.push({
        line, status: 'error', message: fieldErrors.join(' ; '),
        fields: fieldErrors, preview: meta.columns.slice(0, 4).map(c => str(row[c.key])).filter(Boolean).join(' · ')
      });
    } else {
      ok++;
      details.push({
        line, status: 'ok',
        preview: meta.columns.slice(0, 4).map(c => str(row[c.key])).filter(Boolean).join(' · ')
      });
    }
  });

  res.json({
    kind,
    label: meta.label,
    columns: meta.columns.map(c => ({ key: c.key, label: c.label, required: !!c.required })),
    total: rows.length,
    ok, error, skip: 0,
    details,
    sample_rows: rows.slice(0, 15).map((row, idx) => {
      const o = { _line: idx + 2 };
      for (const c of meta.columns) o[c.key] = row[c.key] == null ? '' : row[c.key];
      return o;
    })
  });
}));


module.exports = r;
