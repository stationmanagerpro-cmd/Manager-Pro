// Archivage mensuel — fonctions pures (test/monthly-archive-unit.js).
const crypto = require('crypto');
const csvCell = require('./csv_safe');

/** Dossiers de l'archive, dans l'ordre affiché au client (module d'archivage). */
const FOLDERS = Object.freeze({
  days: '01_Rapports_des_journees',
  purchases: '02_Factures_des_achats',
  customers: '03_Factures_clients',
  expenses: '04_Factures_des_depenses',
  thirds: '05_Rapports_transactions_tiers',
  misc: '06_Rapports_divers'
});

const FOLDER_LABELS = Object.freeze({
  days: 'Rapports des journées',
  purchases: 'Factures des achats',
  customers: 'Factures clients',
  expenses: 'Factures des dépenses',
  thirds: 'Rapports transactions tiers',
  misc: 'Rapports divers (CA, ventes, stock, etc.)'
});

const MAX_DOCS_PER_FOLDER = 300;   // PDF individuels par dossier ; au-delà, le tableau récapitulatif PDF reste complet

const isMonth = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** { from, to, label } pour « YYYY-MM » (bornes incluses, format YYYY-MM-DD). */
function monthRange(month) {
  if (!isMonth(month)) throw new Error('Mois invalide (format AAAA-MM attendu)');
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, year: y, month: m };
}

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthLabel = month => { const r = monthRange(month); return `${MONTHS_FR[r.month - 1]} ${r.year}`; };

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

/** Nom de fichier sûr (sans accents ni séparateurs). */
const slug = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'x';

/**
 * Index de l'archive : une ligne par fichier avec sa description, les tables sources, le nombre de lignes et l'empreinte SHA-256.
 * entries : [{ path, description, sources, rows, data:Buffer }]
 */
function manifestCsv(entries) {
  const head = ['Fichier', 'Description', 'Tables sources', 'Lignes', 'Taille (octets)', 'SHA-256'];
  const body = entries.map(e => [e.path, e.description, e.sources, e.rows == null ? '' : e.rows, e.data.length, sha256(e.data)]);
  return '\ufeff' + [head, ...body].map(l => l.map(x => csvCell(x)).join(';')).join('\r\n');
}

/** Texte LISEZ-MOI placé à la racine de l'archive. */
function readme({ station, currency, month, generatedAt, by, folders, truncated }) {
  const lines = [
    `ARCHIVE MENSUELLE — ${station}`,
    `Période : ${monthLabel(month)} (${month})`,
    `Généré le ${generatedAt} par ${by}`,
    `Montants en ${currency}.`,
    '',
    'Contenu :',
    ...folders.map(f => `  ${f.folder}/  —  ${f.label} (${f.files} fichier(s))${f.note ? ' — ' + f.note : ''}`),
    '',
    'Chaque fichier est listé dans INDEX_ARCHIVE.csv avec ses tables sources, son nombre de lignes et son empreinte SHA-256',
    '(à recalculer pour vérifier qu\'un fichier n\'a pas été modifié après archivage).',
    'Toutes les données proviennent de la base de la station au moment de la génération ; aucune valeur n\'est saisie à la main.'
  ];
  if (truncated.length) lines.push('', 'Limites :', ...truncated.map(t => '  - ' + t));
  return lines.join('\r\n');
}

module.exports = { FOLDERS, FOLDER_LABELS, MAX_DOCS_PER_FOLDER, isMonth, monthRange, monthLabel, sha256, slug, manifestCsv, readme };
