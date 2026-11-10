// Recherche globale multi-entités (station active).
'use strict';
const express = require('express');
const { pool, HttpError, wrap } = require('./core');
const { swallow } = require('./safe');
const r = express.Router();

function has(req, ...codes) {
  return codes.some(c => req.user?.perms?.has(c));
}

/**
 * GET /api/search?q=...
 * Retourne { q, results: [{ type, id, label, sub, go, arg? }] }
 */
r.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ q, results: [] });
  if (q.length > 80) throw new HttpError(400, 'Requête trop longue');

  // Superadmin : recherche clients plateforme
  if (req.user?.is_global) {
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const { rows } = await pool.query(
      `SELECT id, name, code, contact_email, contact_phone, status
         FROM clients
        WHERE deleted_at IS NULL
          AND (name ILIKE $1 OR COALESCE(code,'') ILIKE $1
               OR COALESCE(contact_email,'') ILIKE $1
               OR COALESCE(contact_phone,'') ILIKE $1)
        ORDER BY name LIMIT 20`,
      [like]
    ).catch(swallow('search:33', { rows: [] }));
    return res.json({
      q,
      results: rows.map(c => ({
        type: 'Client plateforme',
        id: c.id,
        label: c.name,
        sub: [c.code, c.contact_phone, c.status].filter(Boolean).join(' · '),
        go: 'clientdetail',
        arg: c.id
      }))
    });
  }

  if (!req.sid) throw new HttpError(400, 'Station non sélectionnée');
  const like = '%' + q.replace(/[%_]/g, '') + '%';
  const sid = req.sid;
  const results = [];
  const tasks = [];

  // Produits
  if (has(req, 'sale.create', 'report.view', 'stock.adjust', 'price.edit')) {
    tasks.push(pool.query(
      `SELECT p.id, p.name, p.barcode, p.sku, COALESCE(st.quantity, 0) AS stock, p.unit
         FROM products p
         LEFT JOIN stock st ON st.product_id = p.id
        WHERE p.station_id = $1 AND p.deleted_at IS NULL
          AND (p.name ILIKE $2 OR COALESCE(p.barcode,'') ILIKE $2 OR COALESCE(p.sku,'') ILIKE $2)
        ORDER BY p.name LIMIT 8`,
      [sid, like]
    ).then(({ rows }) => {
      rows.forEach(p => results.push({
        type: 'Produit',
        id: p.id,
        label: p.name,
        sub: [p.barcode || p.sku, `stock ${p.stock} ${p.unit || ''}`].filter(Boolean).join(' · '),
        go: 'prodf',
        arg: p.id
      }));
    }).catch(swallow('search:produit', undefined)));
  }

  // Clients station
  if (has(req, 'customer.view', 'sale.create', 'customer.edit')) {
    tasks.push(pool.query(
      `SELECT id, name, phone, kind, balance
         FROM customers
        WHERE station_id = $1 AND deleted_at IS NULL
          AND (name ILIKE $2 OR COALESCE(phone,'') ILIKE $2)
        ORDER BY name LIMIT 8`,
      [sid, like]
    ).then(({ rows }) => {
      rows.forEach(c => results.push({
        type: 'Client',
        id: c.id,
        label: c.name,
        sub: [c.kind, c.phone].filter(Boolean).join(' · '),
        go: 'clidet',
        arg: c.id
      }));
    }).catch(swallow('search:client', undefined)));
  }

  // Fournisseurs
  if (has(req, 'supplier.view', 'purchase.manage', 'purchase.pay', 'stock.adjust')) {
    tasks.push(pool.query(
      `SELECT id, name, phone, company, balance_due
         FROM suppliers
        WHERE station_id = $1 AND deleted_at IS NULL
          AND (name ILIKE $2 OR COALESCE(phone,'') ILIKE $2 OR COALESCE(company,'') ILIKE $2)
        ORDER BY name LIMIT 6`,
      [sid, like]
    ).then(({ rows }) => {
      rows.forEach(s => results.push({
        type: 'Fournisseur',
        id: s.id,
        label: s.name,
        sub: [s.company, s.phone].filter(Boolean).join(' · '),
        go: 'supdet',
        arg: s.id
      }));
    }).catch(swallow('search:fournisseur', undefined)));
  }

  // Employés
  if (has(req, 'settings.edit', 'shift.open', 'report.view', 'hr.manage', 'user.manage')) {
    tasks.push(pool.query(
      `SELECT id, matricule, first_name, last_name, position, status, phone
         FROM employees
        WHERE station_id = $1 AND deleted_at IS NULL
          AND (first_name ILIKE $2 OR last_name ILIKE $2 OR COALESCE(matricule,'') ILIKE $2
               OR COALESCE(phone,'') ILIKE $2
               OR (first_name || ' ' || last_name) ILIKE $2)
        ORDER BY last_name, first_name LIMIT 8`,
      [sid, like]
    ).then(({ rows }) => {
      rows.forEach(e => results.push({
        type: 'Employé',
        id: e.id,
        label: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
        sub: [e.matricule, e.position, e.status].filter(Boolean).join(' · '),
        go: 'emp',
        arg: e.id,
        action: 'showEmp'
      }));
    }).catch(swallow('search:employé', undefined)));
  }

  // Factures
  if (has(req, 'sale.create', 'finance.view', 'report.view', 'customer.view')) {
    tasks.push(pool.query(
      `SELECT i.id, i.invoice_no, i.status, i.total_ttc, c.name AS customer
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.station_id = $1
          AND (i.invoice_no ILIKE $2 OR COALESCE(c.name,'') ILIKE $2)
        ORDER BY i.id DESC LIMIT 6`,
      [sid, like]
    ).then(({ rows }) => {
      rows.forEach(i => results.push({
        type: 'Facture',
        id: i.id,
        label: i.invoice_no,
        sub: [i.customer, i.status, i.total_ttc != null ? String(i.total_ttc) : ''].filter(Boolean).join(' · '),
        go: 'factures',
        arg: i.id,
        action: 'billShow'
      }));
    }).catch(swallow('search:facture', undefined)));
  }

  // Quarts
  if (has(req, 'shift.open', 'shift.close', 'report.view', 'shift.report.own')) {
    const num = parseInt(q, 10);
    tasks.push(pool.query(
      `SELECT id, number, kind, status, opened_at, closed_at, cash_gap
         FROM shifts
        WHERE station_id = $1
          AND (
            ($3::int IS NOT NULL AND number = $3)
            OR kind ILIKE $2
            OR status ILIKE $2
            OR CAST(number AS text) ILIKE $2
          )
        ORDER BY id DESC LIMIT 6`,
      [sid, like, Number.isFinite(num) ? num : null]
    ).then(({ rows }) => {
      rows.forEach(s => results.push({
        type: 'Quart',
        id: s.id,
        label: `Quart N° ${s.number}`,
        sub: [s.kind, s.status].filter(Boolean).join(' · '),
        go: 'quart',
        arg: s.id,
        action: 'showShiftFull'
      }));
    }).catch(swallow('search:quart', undefined)));
  }

  await Promise.all(tasks);

  // Ordre stable par type
  const order = { Produit: 1, Client: 2, Fournisseur: 3, Employé: 4, Facture: 5, Quart: 6 };
  results.sort((a, b) => (order[a.type] || 9) - (order[b.type] || 9));

  res.json({ q, results: results.slice(0, 30) });
}));

module.exports = r;
