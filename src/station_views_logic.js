// Logique pure des vues « Vue consolidée » et « Vue par station » (aucun accès base : test/station-views-unit.js).
// Toute valeur affichée provient d'une requête SQL de src/multistation_views.js ; ce module ne fait que
// dériver (périodes, variations, niveaux de jauge, feux de santé) à partir de ces données réelles.

const THRESHOLDS = Object.freeze({
  // Stock : niveau de cuve carburant rapporté à sa capacité (si la capacité est renseignée)
  fuel_level_crit_pct: 15,
  fuel_level_warn_pct: 30,
  low_stock_warn: 1,          // produits (hors carburant) sous leur seuil mini : ≥ 1 → vigilance
  low_stock_crit: 5,          // ≥ 5 → critique
  // Finance : écarts de caisse des 7 derniers jours rapportés au CA TTC des 7 jours
  cash_gap_warn_pct: 0.2,
  cash_gap_crit_pct: 1,
  // Opérations
  open_shift_crit_hours: 36,  // quart resté ouvert plus de 36 h
  anomalies_warn: 1,          // anomalies de quart (écart caisse/stock/compteur) sur 7 jours
  anomalies_crit: 5
});

const MAX_RANGE_DAYS = 3660;   // ~10 ans : borne de sécurité des requêtes
const pad = n => String(n).padStart(2, '0');
const isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const toUtc = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromUtc = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s, n) => { const d = toUtc(s); d.setUTCDate(d.getUTCDate() + n); return fromUtc(d); };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m : 1..12

/** Lundi de la semaine ISO contenant la date. */
function mondayOf(s) { const d = toUtc(s); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return fromUtc(d); }

/** Numéro de semaine ISO 8601. */
function isoWeek(s) {
  const wd = (toUtc(s).getUTCDay() + 6) % 7;
  const thursday = toUtc(s); thursday.setUTCDate(thursday.getUTCDate() - wd + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
}

/**
 * Fenêtres de comparaison à périodes équivalentes (cumul « depuis le début » jusqu'à la date de référence) :
 *  jour vs J-1 ; semaine (lundi → jour) vs même nombre de jours de S-1 ; mois (1er → jour) vs même jour de M-1 ; année cumulée.
 */
function windowsFor(ref, range) {
  if (!isYmd(ref)) throw new Error('Date de référence invalide');
  const [y, m, d] = ref.split('-').map(Number);
  const monday = mondayOf(ref);
  const elapsed = Math.round((toUtc(ref) - toUtc(monday)) / 86400000);   // jours écoulés dans la semaine
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const pmDay = Math.min(d, daysInMonth(py, pm));
  const w = {
    ref,
    day: [ref, ref],
    dayPrev: [addDays(ref, -1), addDays(ref, -1)],
    week: [monday, ref],
    weekPrev: [addDays(monday, -7), addDays(monday, -7 + elapsed)],
    month: [`${y}-${pad(m)}-01`, ref],
    monthPrev: [`${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(pmDay)}`],
    year: [`${y}-01-01`, ref],
    isoWeek: isoWeek(ref), year_n: y, month_n: m
  };
  // Période libre « du … au … » (optionnelle) : comparée à la période de même durée qui la précède immédiatement.
  w.range = null; w.rangePrev = null; w.htRange = w.month;
  if (range) {
    const { from, to } = range;
    if (!isYmd(from) || !isYmd(to)) throw new Error('Période invalide');
    if (from > to) throw new Error('La date de début doit précéder la date de fin.');
    const days = Math.round((toUtc(to) - toUtc(from)) / 86400000) + 1;
    if (days > MAX_RANGE_DAYS) throw new Error(`La période ne peut pas dépasser ${MAX_RANGE_DAYS} jours.`);
    w.range = [from, to]; w.rangePrev = [addDays(from, -days), addDays(from, -1)]; w.rangeDays = days; w.htRange = w.range;
  }
  const starts = [w.day, w.dayPrev, w.week, w.weekPrev, w.month, w.monthPrev, w.year].concat(w.range ? [w.range, w.rangePrev] : []);
  w.minStart = starts.map(x => x[0]).sort()[0];
  return w;
}

/** Variation en % ; null si la période de comparaison est nulle (pas de division par zéro, pas de faux 0 %). */
function variation(cur, prev) {
  const c = Number(cur), p = Number(prev);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return Math.round(((c - p) / Math.abs(p)) * 10000) / 100;
}

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** Répartition en % (1 décimale) ; total nul → tout à null. */
function shares(items) {
  const total = items.reduce((a, x) => a + (Number(x.value) || 0), 0);
  return items.map(x => ({ ...x, pct: total > 0 ? Math.round((Number(x.value) / total) * 1000) / 10 : null }));
}

/** Niveau de jauge en % (0-100) ; null si la capacité de cuve n'est pas renseignée (on n'invente pas de niveau). */
function gaugePct(quantity, capacity) {
  const cap = Number(capacity), q = Number(quantity);
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(q)) return null;
  return Math.max(0, Math.min(100, Math.round((q / cap) * 1000) / 10));
}

/** Abréviation d'un carburant pour l'étiquette de la jauge (GAS, SSP, GAS PREM…). */
function fuelShort(name) {
  const raw = String(name || '').trim();
  if (!raw) return '—';
  const words = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/\s+/);
  const joined = words.join(' ');
  let base;
  if (/SANS\s*PLOMB|\bSSP\b/.test(joined)) base = 'SSP';
  else if (/GASOIL|GAZOLE|DIESEL|\bGO\b/.test(joined)) base = 'GAS';
  else base = words[0].slice(0, 3);
  const rest = words.filter(w => !/^(SANS|PLOMB|SSP|GASOIL|GAZOLE|DIESEL|GO|SUPER|CARBURANT|DE|DU|LE|LA)$/.test(w) && w !== words[0]);
  return rest.length ? `${base} ${rest[0].slice(0, 4)}` : base;
}

const PALETTE = ['#d49a1a', '#16a34a', '#7f1d1d', '#2563eb', '#9333ea', '#0891b2'];
/** Couleur de liquide par famille de carburant ; repli déterministe pour les noms inconnus. */
function fuelColor(name) {
  const n = String(name || '').toLowerCase();
  if (/premium|\bvp\b|v-power|excellium|exl|\bplus\b/.test(n)) return '#7f1d1d';
  if (/sans\s*plomb|\bssp\b|super|essence/.test(n)) return '#16a34a';
  if (/gasoil|gazole|diesel/.test(n)) return '#d49a1a';
  let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const LEVELS = { ok: 0, warn: 1, crit: 2 };
const worst = (a, b) => (LEVELS[b] > LEVELS[a] ? b : a);

/** Feu « Stock » : cuves carburant (niveau et seuil mini) + produits hors carburant sous leur seuil. */
function healthStock({ fuel = [], lowOther = 0 }, T = THRESHOLDS) {
  let level = 'ok'; const reasons = [];
  for (const f of fuel) {
    const q = Number(f.quantity) || 0, min = Number(f.min_stock) || 0;
    const pct = gaugePct(q, f.capacity);
    if (q <= 0) { level = worst(level, 'crit'); reasons.push(`${f.name} : cuve vide ou stock nul`); }
    else if (min > 0 && q <= min) { level = worst(level, 'crit'); reasons.push(`${f.name} : sous le seuil mini (${Math.round(q)} ≤ ${Math.round(min)})`); }
    else if (pct != null && pct <= T.fuel_level_crit_pct) { level = worst(level, 'crit'); reasons.push(`${f.name} : niveau ${pct} %`); }
    else if (pct != null && pct <= T.fuel_level_warn_pct) { level = worst(level, 'warn'); reasons.push(`${f.name} : niveau ${pct} %`); }
  }
  if (lowOther >= T.low_stock_crit) { level = worst(level, 'crit'); reasons.push(`${lowOther} produits sous leur seuil mini`); }
  else if (lowOther >= T.low_stock_warn) { level = worst(level, 'warn'); reasons.push(`${lowOther} produit(s) sous leur seuil mini`); }
  return { level, reasons };
}

/** Feu « Finance » : écarts de caisse (7 j) rapportés au CA TTC (7 j) + clients au-delà de leur plafond de crédit. */
function healthFinance({ cashGapAbs7d = 0, sales7d = 0, overLimitCustomers = 0 }, T = THRESHOLDS) {
  let level = 'ok'; const reasons = [];
  const gap = Math.abs(Number(cashGapAbs7d) || 0), ca = Number(sales7d) || 0;
  if (gap > 0) {
    if (ca > 0) {
      const pct = (gap / ca) * 100;
      const txt = `écarts de caisse 7 j : ${Math.round(gap).toLocaleString('fr-FR')} (${pct.toFixed(2)} % du CA)`;
      if (pct > T.cash_gap_crit_pct) { level = worst(level, 'crit'); reasons.push(txt); }
      else if (pct > T.cash_gap_warn_pct) { level = worst(level, 'warn'); reasons.push(txt); }
    } else { level = worst(level, 'warn'); reasons.push('écarts de caisse sans CA sur 7 jours'); }
  }
  if (overLimitCustomers > 0) { level = worst(level, 'warn'); reasons.push(`${overLimitCustomers} client(s) au-delà de leur plafond de crédit`); }
  return { level, reasons };
}

/** Feu « Opérations » : quart ouvert trop longtemps, anomalies de quart, absence de saisie la veille. */
function healthOps({ oldestOpenHours = null, anomalies7d = 0, shiftsYesterday = 0, shiftsPrev7d = 0 }, T = THRESHOLDS) {
  let level = 'ok'; const reasons = [];
  if (oldestOpenHours != null && oldestOpenHours > T.open_shift_crit_hours) { level = worst(level, 'crit'); reasons.push(`quart ouvert depuis ${Math.round(oldestOpenHours)} h`); }
  if (anomalies7d >= T.anomalies_crit) { level = worst(level, 'crit'); reasons.push(`${anomalies7d} anomalies de quart sur 7 jours`); }
  else if (anomalies7d >= T.anomalies_warn) { level = worst(level, 'warn'); reasons.push(`${anomalies7d} anomalie(s) de quart sur 7 jours`); }
  if (shiftsYesterday === 0 && shiftsPrev7d > 0) { level = worst(level, 'warn'); reasons.push('aucun quart saisi hier'); }
  return { level, reasons };
}

module.exports = { THRESHOLDS, MAX_RANGE_DAYS, isYmd, addDays, mondayOf, isoWeek, windowsFor, variation, round2, shares, gaugePct, fuelShort, fuelColor, healthStock, healthFinance, healthOps };
