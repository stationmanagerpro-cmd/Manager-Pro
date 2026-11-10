// Moteur de documents : PDF professionnels (en-tête avec logo, pied de page configurable, tableaux, graphiques, signatures) et classeurs Excel.
const PDFDocument = require('pdfkit');
const { swallow } = require('./safe');
const ExcelJS = require('exceljs');
const { pool } = require('./core');
const files = require('./files');
const { getSetting } = require('./admin');
const appBranding = require('./branding');
const clientSignature = require('./signature');

const DEFAULT_GREEN = '#0a6b5c', GREY = '#5b6675', LINE = '#d5dbe2', DEFAULT_SOFT = '#e8f3f0';
// Les polices PDF standard ne connaissent pas certains caractères : on les remplace pour ne jamais afficher de symboles cassés
const latin = s => String(s ?? '').replace(/[\u202f\u00a0]/g, ' ').replace(/\u2212/g, '-').replace(/\u0153/g, 'oe').replace(/\u0152/g, 'OE').replace(/[\u{1F000}-\u{1FFFF}\u2190-\u21FF\u2300-\u23FF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]/gu, m => (m === '\u2192' ? '>' : '')).replace(/→/g, '>').replace(/[^\x00-\xff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]/g, '?');
const pad = n => String(n).padStart(2, '0');
function cellText(v) {
  if (v instanceof Date) return `${pad(v.getDate())}/${pad(v.getMonth() + 1)}/${v.getFullYear()} ${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('/');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return cellText(new Date(v));
  if (typeof v === 'number') return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(v);
  return v ?? '';
}
const txt = v => latin(cellText(v));
const fmtDate = d => cellText(d instanceof Date ? d : new Date(d));

async function branding(stationId) {
  const { rows: [st] } = await pool.query(
    'SELECT s.name, s.address, s.phone, s.email, s.currency, s.tax_id, s.photo_path, s.client_id FROM stations s WHERE s.id = $1',
    [stationId]
  );
  if (!st) throw new (require('./core').HttpError)(404, 'Station introuvable');
  const footer = { ...(await getSetting(stationId, 'footer').catch(swallow('docs:footer', {}))) };
  // Signature imposée par le contrat client (Super Admin) : toujours imprimée sur les documents du client,
  // que le client puisse ou non personnaliser son propre pied de page.
  if (st?.client_id) {
    try {
      const { rows: [ct] } = await pool.query('SELECT forced_signature FROM client_contracts WHERE client_id = $1', [st.client_id]);
      if (ct?.forced_signature && String(ct.forced_signature).trim()) footer.forced_signature = String(ct.forced_signature).trim();
    } catch (_) { /* ignore */ }
  }
  // Identité plateforme (Manager Pro) : nom/slogan pour métadonnées PDF uniquement.
  // Le logo de la station reste strictement celui de la station — jamais de repli sur le logo Manager Pro
  // (sinon changer le logo du site ferait apparaître la même image sur tous les PDF clients).
  const app = await appBranding.load().catch(swallow('docs:41', { name: appBranding.DEFAULTS.name, tagline: '', logo_path: null }));
  // Signature personnalisée du client (manuscrite / image), si autorisée par le contrat ET activée par le client
  let signature = null;
  if (st?.client_id) {
    try {
      const { rows: [ct] } = await pool.query('SELECT features, status FROM client_contracts WHERE client_id = $1', [st.client_id]);
      signature = await clientSignature.loadActive(st.client_id, require('./contracts').mergeFeatures(ct?.features), ct?.status === 'suspendu');
    } catch (_) { /* migration non appliquée : pas de signature personnalisée */ }
  }
  let report_colors = { primary: DEFAULT_GREEN, secondary: DEFAULT_SOFT, text: '#111827' };
  if (st?.client_id) {
    try {
      const { rows: [pref] } = await pool.query('SELECT colors FROM client_report_preferences WHERE client_id=$1', [st.client_id]);
      const { rows: [contract] } = await pool.query('SELECT features, status FROM client_contracts WHERE client_id=$1', [st.client_id]);
      const f = contract?.features || {};
      // Les couleurs personnalisées ne sont appliquées que si le contrat les autorise
      // et n'est pas suspendu. Une suspension rétablit immédiatement la palette standard.
      if (contract?.status !== 'suspendu' && pref?.colors && (f.can_customize_report_exports === true || f.modules?.report_colors === true)) {
        report_colors = { ...report_colors, ...pref.colors };
      }
    } catch (_) { /* migration non appliquée ou préférences absentes : couleurs standard */ }
  }
  // Logo illisible (fichier absent, stockage indisponible) : le PDF est généré sans logo plutôt que d'échouer.
  const stationLogo = st?.photo_path ? await files.read(st.photo_path).catch(swallow('docs:logo', null)) : null;
  return { ...st, currency: String((st && st.currency) || 'FCFA').trim(), logo: stationLogo || null, footer, signature, app_name: app.name, app_tagline: app.tagline, report_colors };
}

// sections : {type:'kpis'|'kv'|'table'|'bars'|'text', title, ...}   signatures : [{label, name, function, status, date}]
function buildPdf({ b, title, subtitle, ref, period, sections, signatures = [], landscape }) {
  const GREEN = /^#[0-9a-f]{6}$/i.test(b.report_colors?.primary || '') ? b.report_colors.primary : DEFAULT_GREEN;
  const SOFT = /^#[0-9a-f]{6}$/i.test(b.report_colors?.secondary || '') ? b.report_colors.secondary : DEFAULT_SOFT;
  const REPORT_TEXT = /^#[0-9a-f]{6}$/i.test(b.report_colors?.text || '') ? b.report_colors.text : '#111827';
  return new Promise((resolve, reject) => {
    const wide = landscape ?? sections.some(s => s.type === 'table' && s.head.length > 5);
    const doc = new PDFDocument({ size: 'A4', layout: wide ? 'landscape' : 'portrait', margin: 36, bufferPages: true, info: { Title: latin(title), Author: latin(b.name), Creator: latin(b.app_name || b.name) } });
    const bufs = []; doc.on('data', d => bufs.push(d)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject);
    const L = 36, W = doc.page.width - 72, bottom = () => doc.page.height - 56;
    const need = h => { if (doc.y + h > bottom()) doc.addPage(); };
    let first = true;
    doc.on('pageAdded', () => {   // en-tête réduit sur les pages suivantes
      if (first) return;
      doc.font('Helvetica').fontSize(8).fillColor(GREY).text(latin(b.name) + '  |  ' + latin(title), L, 20, { width: W, lineBreak: false });
      doc.moveTo(L, 32).lineTo(L + W, 32).strokeColor(LINE).lineWidth(.5).stroke(); doc.y = 42; doc.x = L;
    });

    // --- En-tête : logo, station, coordonnées | titre, période, référence, génération ---
    let x0 = L;
    if (b.logo) { try { doc.image(b.logo, L, 36, { fit: [56, 56] }); x0 = L + 66; } catch (e) { /* logo illisible : ignoré */ } }
    doc.font('Helvetica-Bold').fontSize(15).fillColor(GREEN).text(latin(b.name), x0, 36, { width: W * .55 - (x0 - L) });
    doc.font('Helvetica').fontSize(8.5).fillColor(GREY);
    const coords = [b.address, [b.phone, b.email].filter(Boolean).join('  -  '), b.tax_id ? 'N° fiscal : ' + b.tax_id : ''].filter(Boolean);
    coords.forEach(c => doc.text(latin(c), x0, doc.y, { width: W * .55 - (x0 - L) }));
    if (b.app_name) {   // nom de l'application et slogan configurés par l'administrateur
      doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#8a93a0')
        .text(latin(b.app_name + (b.app_tagline ? '  -  ' + b.app_tagline : '')), x0, doc.y + 1, { width: W * .55 - (x0 - L) });
    }
    const rx = L + W * .58, rw = W * .42;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(REPORT_TEXT).text(latin(title), rx, 36, { width: rw, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(GREY);
    if (subtitle) doc.text(latin(subtitle), rx, doc.y, { width: rw, align: 'right' });
    if (period) doc.font('Helvetica-Bold').fontSize(9).fillColor(REPORT_TEXT).text('Période : ' + latin(period), rx, doc.y, { width: rw, align: 'right' }).font('Helvetica').fillColor(GREY);
    if (ref) doc.text('Réf. ' + latin(ref), rx, doc.y, { width: rw, align: 'right' });
    doc.text('Généré le ' + fmtDate(new Date()), rx, doc.y, { width: rw, align: 'right' });
    doc.y = Math.max(doc.y, 100) + 6; doc.x = L;
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor(GREEN).lineWidth(1.5).stroke(); doc.y += 12; first = false;

    const heading = t => { need(40); doc.font('Helvetica-Bold').fontSize(11).fillColor(GREEN).text(latin(t), L, doc.y, { width: W }); doc.moveDown(.25); };

    for (const s of sections) {
      if (s.title && s.type !== 'text') heading(s.title);
      if (s.type === 'kpis') {
        const per = wide ? 4 : 3, bw = (W - (per - 1) * 8) / per;
        for (let i = 0; i < s.items.length; i += per) {
          need(52); const y = doc.y;
          s.items.slice(i, i + per).forEach((k, j) => {
            const x = L + j * (bw + 8);
            doc.roundedRect(x, y, bw, 46, 4).fillAndStroke(SOFT, LINE);
            doc.font('Helvetica').fontSize(7.5).fillColor(GREY).text(latin(k.label), x + 6, y + 5, { width: bw - 12, lineBreak: false });
            doc.font('Helvetica-Bold').fontSize(12).fillColor(REPORT_TEXT).text(txt(k.value), x + 6, y + 17, { width: bw - 12, lineBreak: false });
            if (k.note) doc.font('Helvetica').fontSize(6.5).fillColor(GREY).text(latin(k.note), x + 6, y + 34, { width: bw - 12, lineBreak: false });
          });
          doc.y = y + 54; doc.x = L;
        }
      } else if (s.type === 'kv') {
        for (const [k, v] of s.rows) {
          need(16); const y = doc.y;
          doc.font('Helvetica').fontSize(9).fillColor(GREY).text(latin(k), L, y, { width: W * .45 });
          doc.font('Helvetica-Bold').fontSize(9).fillColor(REPORT_TEXT).text(txt(v), L + W * .47, y, { width: W * .53 });
          doc.y = Math.max(doc.y, y + 13);
        }
        doc.moveDown(.5);
      } else if (s.type === 'bars') {
        const mx = Math.max(1, ...s.items.map(i => Math.abs(i[1])));
        for (const [lab, val] of s.items.slice(0, 12)) {
          need(16); const y = doc.y;
          doc.font('Helvetica').fontSize(8).fillColor(REPORT_TEXT).text(latin(lab), L, y, { width: W * .28, lineBreak: false });
          doc.rect(L + W * .3, y + 1, Math.max(1, Math.abs(val) / mx * W * .5), 8).fill(val < 0 ? '#b83227' : GREEN);
          doc.font('Helvetica').fontSize(8).fillColor(GREY).text(txt(val), L + W * .82, y, { width: W * .18, align: 'right', lineBreak: false });
          doc.y = y + 14;
        }
        doc.moveDown(.5);
      } else if (s.type === 'text') {
        if (s.title) heading(s.title);
        doc.font('Helvetica').fontSize(9).fillColor('#222').text(latin(s.text), L, doc.y, { width: W }); doc.moveDown(.6);
      } else if (s.type === 'options') {
        // Cases à cocher dessinées en vectoriel (police PDF standard sans symboles ☑/☐) : état de sélection lisible à l'écran comme à l'impression.
        const items = s.items || [], per = wide ? 4 : 3, colW = W / per;
        for (let i = 0; i < items.length; i += per) {
          need(18); const y = doc.y;
          items.slice(i, i + per).forEach((it, j) => {
            const x = L + j * colW;
            if (it.selected) {
              doc.rect(x, y + 1, 10, 10).fill(GREEN);
              doc.moveTo(x + 2.2, y + 6.2).lineTo(x + 4.4, y + 8.8).lineTo(x + 8.2, y + 3.4).lineWidth(1.5).strokeColor('#ffffff').stroke();
            } else {
              doc.rect(x + .5, y + 1.5, 9, 9).lineWidth(.8).strokeColor(GREY).stroke();
            }
            doc.font(it.selected ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(it.selected ? REPORT_TEXT : GREY)
              .text(latin(it.label), x + 15, y + 1, { width: colW - 19, lineBreak: false, ellipsis: true });
          });
          doc.y = y + 17; doc.x = L;
        }
        doc.moveDown(.4);
      } else if (s.type === 'image') {
        // Image intégrée (ex. capture de la carte) : mise à l'échelle dans la largeur utile, saut de page si nécessaire.
        try {
          const raw = Buffer.from(String(s.data || '').split(',')[1] || '', 'base64');
          const img = doc.openImage(raw), ratio = img.height / img.width;
          let w = W, h = w * ratio;
          if (doc.y + h > bottom() && doc.y > 120) doc.addPage();
          const avail = bottom() - doc.y;
          if (h > avail) { h = avail; w = h / ratio; }
          const x = L + (W - w) / 2, y = doc.y;
          doc.image(raw, x, y, { width: w, height: h });
          doc.rect(x, y, w, h).lineWidth(.6).strokeColor(LINE).stroke();
          doc.y = y + h + 6; doc.x = L;
        } catch (e) {
          doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(GREY).text('Image non disponible.', L, doc.y, { width: W }); doc.moveDown(.4);
        }
        if (s.caption) { doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GREY).text(latin(s.caption), L, doc.y, { width: W }); doc.moveDown(.6); }
      } else if (s.type === 'table') {
        // Totaux : s.totals explicite OU calcul auto depuis sumCols (exports PDF)
        let totalsRow = s.totals || null;
        if (!totalsRow && Array.isArray(s.sumCols) && s.sumCols.length && s.rows.length) {
          totalsRow = s.head.map((_, i) => {
            if (i === 0) return 'TOTAL';
            if (s.sumCols.includes(i)) {
              const sum = s.rows.reduce((a, r) => a + (typeof r[i] === 'number' ? r[i] : (+r[i] || 0)), 0);
              return Math.round(sum * 1000) / 1000;
            }
            return '';
          });
        }
        const all = [...s.rows, ...(totalsRow ? [totalsRow] : [])];
        // Largeurs déterministes calculées une fois par tableau : évite que le contenu d'une
        // ligne déplace visuellement les colonnes Total/Statut et conserve les nombres à droite.
        const numericHeader = /(^|\b)(montant|total|prix|co[uû]t|solde|d[eé]bit|cr[eé]dit|quantit[eé]|qte|taux|pourcentage|%|somme|encaiss[eé]|pay[eé]|reste|balance|nombre|n[uú]m[eé]ro|n[u°]°|id)(\b|$)/i;
        const numericCell = v => typeof v === 'number' || (typeof v === 'string' && /^\s*[-+]?(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.]\d+)?\s*(?:FCFA|XOF|%|€|\$)?\s*$/i.test(v));
        const rightCols = s.head.map((h, i) => numericHeader.test(String(h)) || (s.rows.length > 0 && s.rows.slice(0, 30).filter(r => numericCell(r[i])).length >= Math.max(1, Math.ceil(Math.min(30, s.rows.length) * .6))));
        const lens = s.head.map((h, i) => {
          const maxData = Math.max(0, ...all.slice(0, 200).map(r => String(txt(r[i])).length));
          const headerLen = String(h).length * (rightCols[i] ? 1.15 : 1.35);
          return Math.max(7, Math.min(40, Math.ceil(Math.max(headerLen, Math.min(maxData, rightCols[i] ? 16 : 30)) + 2)));
        });
        const minLens = lens.map((v, i) => Math.min(v, rightCols[i] ? 9 : 12));
        const base = lens.reduce((a, c) => a + c, 0) || 1;
        const minTotal = minLens.reduce((a, c) => a + c, 0);
        const cw = lens.map((l, i) => Math.max(minLens[i] / minTotal * W, l / base * W));
        const factor = W / cw.reduce((a, c) => a + c, 0);
        for (let i = 0; i < cw.length; i++) cw[i] *= factor;
        const row = (cells, kind) => {
          const fnt = kind === 'body' ? 'Helvetica' : 'Helvetica-Bold';
          doc.font(fnt).fontSize(8);
          const h = Math.max(12, ...cells.map((c, i) => doc.heightOfString(txt(c), { width: cw[i] - 6, fontSize: 8 }))) + 6;
          if (doc.y + h > bottom()) { doc.addPage(); if (kind === 'body') row(s.head, 'head'); }
          doc.font(fnt).fontSize(8);
          const y = doc.y;
          if (kind === 'head') doc.rect(L, y, W, h).fill(SOFT); if (kind === 'total') doc.rect(L, y, W, h).fill('#f3f5f7');
          doc.fillColor(REPORT_TEXT); let x = L;
          cells.forEach((c, i) => { doc.text(txt(c), x + 3, y + 3, { width: cw[i] - 6, align: rightCols[i] ? 'right' : 'left', lineBreak: true }); x += cw[i]; });
          doc.moveTo(L, y + h).lineTo(L + W, y + h).strokeColor(kind === 'total' ? '#888' : LINE).lineWidth(kind === 'total' ? .9 : .5).stroke();
          doc.y = y + h; doc.x = L;
        };
        row(s.head, 'head');
        s.rows.forEach(r => row(r, 'body'));
        if (!s.rows.length) { doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text('Aucune donnée sur la période.', L + 3, doc.y + 3); doc.moveDown(.6); }
        if (totalsRow) row(totalsRow, 'total');
        (s.notes || []).forEach(n => { doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GREY).text(latin(n), L, doc.y + 2, { width: W }); });
        doc.moveDown(.8);
      }
    }
    // --- Signatures : validées seulement si l'intervenant a réellement agi ---
    if (signatures.length) {
      need(96); heading('Validations et signatures');
      const n = Math.min(signatures.length, wide ? 5 : 4), bw = (W - (n - 1) * 8) / n, y = doc.y;
      signatures.slice(0, n).forEach((g, i) => {
        const x = L + i * (bw + 8);
        doc.rect(x, y, bw, 78).strokeColor(LINE).lineWidth(.7).stroke();
        doc.font('Helvetica-Bold').fontSize(8).fillColor(REPORT_TEXT).text(latin(g.label), x + 5, y + 5, { width: bw - 10, lineBreak: false });
        doc.font('Helvetica').fontSize(7.5).fillColor(GREY);
        // Signature personnalisée du client : posée sur les cases non encore validées par un intervenant,
        // sauf celles destinées à un tiers (employé, client de la station, fournisseur) ou marquées sign:false.
        const signed = !g.status && b.signature && g.sign !== false && (g.sign === true || !/employ|pompiste|salari|client|fournisseur/i.test(g.label || ''));
        if (g.status) doc.text(latin(`${g.status} par ${g.name || ''}${g.date ? ' le ' + fmtDate(g.date) : ''}`), x + 5, y + 18, { width: bw - 10 });
        else if (signed) { doc.text(latin('Nom : ' + (b.signature.name || g.name || '')), x + 5, y + 20, { width: bw - 10, lineBreak: false }); doc.text('Date : ' + fmtDate(new Date()).slice(0, 10), x + 5, y + 34, { width: bw - 10, lineBreak: false }); }
        else { doc.text('Nom : ____________________', x + 5, y + 20, { width: bw - 10, lineBreak: false }); doc.text('Date : ___ / ___ / ______', x + 5, y + 34, { width: bw - 10, lineBreak: false }); }
        doc.text('Signature :', x + 5, y + 58, { width: bw - 10, lineBreak: false });
        if (signed) { try { doc.image(b.signature.buf, x + 52, y + 44, { fit: [bw - 60, 30], align: 'left', valign: 'center' }); } catch (_) { /* image illisible : case laissée vierge */ } }
      });
      doc.y = y + 86;
    }
    // --- Pied de page sur toutes les pages : station, date, mentions configurées, numéro de page ---
    const range = doc.bufferedPageRange(), f = b.footer || {}, year = new Date().getFullYear();
    const mid = [f.text, f.show_copyright !== false ? (f.copyright || `© ${year} ${b.name}`) : ''].filter(Boolean).join('  -  ');
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i); doc.page.margins.bottom = 0;
      const y = doc.page.height - 38;
      doc.moveTo(L, y - 4).lineTo(L + W, y - 4).strokeColor(LINE).lineWidth(.5).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(GREY);
      const nm = latin(b.name).length > 30 ? latin(b.name).slice(0, 29) + '\u2026' : latin(b.name);
      doc.text(nm + '  -  ' + fmtDate(new Date()), L, y, { width: W * .44, lineBreak: false });
      doc.text(latin(mid).slice(0, 70), L + W * .44, y, { width: W * .32, align: 'center', lineBreak: false });
      doc.text(`Page ${i + 1} / ${range.count}`, L + W * .78, y, { width: W * .22, align: 'right', lineBreak: false });
      let ly = y + 12;
      if (f.forced_signature) { doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1f2937').text(latin(f.forced_signature), L, ly, { width: W, align: 'center', lineBreak: false }); ly += 12; }
      if (f.show_ad && f.ad_text) doc.font('Helvetica-Oblique').fontSize(7).fillColor('#8a93a0').text(latin(f.ad_text), L, ly, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

// sheets : [{name, head, rows, sumCols:[indices], notes:[...]}]
async function buildXlsx({ b, title, subtitle, ref, sheets }) {
  const primary = /^#[0-9a-f]{6}$/i.test(b.report_colors?.primary || '') ? b.report_colors.primary : DEFAULT_GREEN;
  const secondary = /^#[0-9a-f]{6}$/i.test(b.report_colors?.secondary || '') ? b.report_colors.secondary : DEFAULT_SOFT;
  const argb = hex => 'FF' + hex.replace('#', '').toUpperCase();
  const wb = new ExcelJS.Workbook(); wb.creator = b.name; wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(String(s.name).replace(/[\\/*?:[\]]/g, ' ').slice(0, 31));
    ws.addRow([b.name]).font = { bold: true, size: 14, color: { argb: argb(primary) } };
    if (b.app_name) ws.addRow([b.app_name + (b.app_tagline ? ' - ' + b.app_tagline : '')]).font = { italic: true, color: { argb: 'FF8A93A0' } };
    ws.addRow([title + (subtitle ? ' - ' + subtitle : '') + (ref ? '   Réf. ' + ref : '')]).font = { bold: true };
    ws.addRow(['Généré le ' + fmtDate(new Date()) + ' - montants en ' + b.currency]).font = { italic: true, color: { argb: 'FF5B6675' } };
    ws.addRow([]);
    const hr = ws.addRow(s.head); hr.font = { bold: true, color: { argb: argb(/^#[0-9a-f]{6}$/i.test(b.report_colors?.text || '') ? b.report_colors.text : '#111827') } }; hr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(secondary) } }; c.border = { bottom: { style: 'thin' } }; });
    const first = ws.rowCount + 1;
    s.rows.forEach(r => ws.addRow(r.map(v => v instanceof Date ? cellText(v) : v ?? '')));
    const last = ws.rowCount;
    s.head.forEach((h, i) => {
      const col = ws.getColumn(i + 1), vals = s.rows.map(r => r[i]), num = vals.some(v => typeof v === 'number');
      if (num) col.numFmt = vals.some(v => typeof v === 'number' && !Number.isInteger(v)) ? '#,##0.00' : '#,##0';
      col.width = Math.min(45, Math.max(11, String(h).length + 2, ...vals.slice(0, 200).map(v => String(cellText(v)).length + 2)));
      if (num) col.alignment = { horizontal: 'right' };
    });
    if (s.sumCols?.length && s.rows.length) {   // totaux par formule SUM : vérifiables dans Excel
      const tr = ws.addRow(s.head.map((_, i) => i === 0 ? 'TOTAL' : ''));
      for (const i of s.sumCols) { const L = ws.getColumn(i + 1).letter; tr.getCell(i + 1).value = { formula: `SUM(${L}${first}:${L}${last})`, result: s.rows.reduce((a, r) => a + (+r[i] || 0), 0) }; }
      tr.font = { bold: true }; tr.eachCell(c => { c.border = { top: { style: 'thin' } }; });
    }
    (s.notes || []).forEach(n => { const nr = ws.addRow([n]); nr.font = { italic: true, color: { argb: 'FF5B6675' } }; });
    if (b.footer?.forced_signature) { ws.addRow([]); ws.addRow([b.footer.forced_signature]).font = { bold: true, color: { argb: 'FF1F2937' } }; }
    ws.views = [{ state: 'frozen', ySplit: hr.number }];
    if (s.rows.length) ws.autoFilter = { from: { row: hr.number, column: 1 }, to: { row: hr.number, column: s.head.length } };
    ws.pageSetup = { orientation: s.head.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const csvCell = require('./csv_safe');
const csv = (head, rows) => '\ufeff' + [head, ...rows.map(r => r.map(cellText))].map(l => l.map(x => csvCell(x)).join(';')).join('\r\n');
const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8' };
function send(res, fmt, buf, name) {
  res.set('Content-Type', MIME[fmt]).set('Content-Disposition', `attachment; filename="${name.replace(/[^\w.-]/g, '_')}.${fmt}"`).send(typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf);
}
module.exports = { branding, buildPdf, buildXlsx, csv, send, cellText, fmtDate };
