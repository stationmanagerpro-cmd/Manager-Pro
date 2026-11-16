'use strict';
/** Superadmin : utilisation d'un compte client — modules et écrans, heures de connexion, rythme hebdomadaire,
 *  comptes et score d'accrochage. Lecture seule, agrégats uniquement (aucune vente, aucun contenu métier).
 *  Les mesures commencent avec la migration 116 : l'historique n'existe qu'à partir de sa mise en service. */
const express = require('express');
const { pool, wrap, HttpError } = require('./core');
const { needPrincipal } = require('./contracts');

const r = express.Router();
const TZ = 'Africa/Bamako';
const BREADTH_TARGET = 15;   // écrans distincts jugés « profond » pour un client
const ACCOUNT_BREADTH = 8;   // écrans distincts jugés « profond » pour un compte
const INTENSITY_TARGET = 60; // minutes par compte et par jour actif jugées « intenses »
const clamp01 = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const round = (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n;
const LEVELS = [[75, 'Fort'], [50, 'Moyen'], [25, 'Faible'], [0, 'Dormant']];
const levelOf = v => (LEVELS.find(([min]) => v >= min) || LEVELS[LEVELS.length - 1])[1];

/** Score d'accrochage d'un client (0–100) : quatre composantes pondérées, chacune ramenée entre 0 et 1. */
function clientEngagement({ days, activeDays, totalUsers, activeUsers, distinctViews, totalSeconds, activeAccountDays }) {
  if (!totalUsers || !activeAccountDays) return { value: null, level: 'Aucune donnée', components: [] };
  const minutesPerAccountDay = totalSeconds / 60 / activeAccountDays;
  const parts = [
    { key: 'regularite', label: 'Régularité', weight: 30, ratio: clamp01(activeDays / days), detail: `${activeDays} jour(s) actif(s) sur ${days}` },
    { key: 'adoption', label: 'Adoption des comptes', weight: 25, ratio: clamp01(activeUsers / totalUsers), detail: `${activeUsers} compte(s) actif(s) sur ${totalUsers}` },
    { key: 'profondeur', label: 'Profondeur (écrans)', weight: 20, ratio: clamp01(distinctViews / BREADTH_TARGET), detail: `${distinctViews} écran(s) utilisé(s)` },
    { key: 'intensite', label: 'Intensité', weight: 25, ratio: clamp01(minutesPerAccountDay / INTENSITY_TARGET), detail: `${round(minutesPerAccountDay)} min par compte et jour actif` },
  ];
  const value = round(parts.reduce((s, p) => s + p.weight * p.ratio, 0));
  return { value, level: levelOf(value), components: parts.map(p => ({ key: p.key, label: p.label, weight: p.weight, score: round(p.ratio * 100), detail: p.detail })) };
}

/** Score d'un compte (0–100) : régularité 40 %, intensité 35 %, profondeur 25 %. */
function accountScore({ days, activeDays, seconds, distinctViews }) {
  if (!activeDays) return 0;
  const minutesPerDay = seconds / 60 / activeDays;
  return round(100 * (0.4 * clamp01(activeDays / days) + 0.35 * clamp01(minutesPerDay / INTENSITY_TARGET) + 0.25 * clamp01(distinctViews / ACCOUNT_BREADTH)));
}

const dayKeys = days => {
  const out = [], today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) out.push(new Date(today.getTime() - i * 864e5).toISOString().slice(0, 10));
  return out;
};

/** Agrégats d'un client sur `days` jours : comptes, stations (sous-stations incluses), écrans, heures, couverture des données.
 *  Retourne null si le client n'existe pas. Toutes les valeurs proviennent des tables d'usage (aucune valeur saisie à la main). */
async function buildClientUsage(db, clientId, days) {
  const { rows: [client] } = await db.query('SELECT id, name FROM clients WHERE id = $1', [clientId]);
  if (!client) return null;
  const q = (sql, p) => db.query(sql, p).then(x => x.rows);
  const [users, stations, members, usage, prev, logins, loginHours, daily, rhythm, views, userViews, stationAgg, stationUser, usageRows, since] = await Promise.all([
    q(`SELECT u.id, u.login, COALESCE(NULLIF(trim(u.full_name), ''), u.login) AS display_name, u.job_title, u.active,
              u.last_login_at, r.code AS role_code, r.label AS role_label
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.client_id = $1 AND u.deleted_at IS NULL AND u.is_global = FALSE ORDER BY u.login`, [clientId]),
    q(`SELECT id, name, active FROM stations WHERE client_id = $1 ORDER BY name`, [clientId]),
    q(`SELECT us.station_id, us.user_id FROM user_stations us JOIN users u ON u.id = us.user_id
        WHERE u.client_id = $1 AND u.deleted_at IS NULL AND u.is_global = FALSE`, [clientId]),
    q(`SELECT uu.user_id, COUNT(*) FILTER (WHERE uu.seconds > 0)::int AS active_days, COALESCE(SUM(uu.seconds), 0)::bigint AS seconds,
              MAX(uu.last_ping_at) AS last_activity
         FROM user_usage uu JOIN users u ON u.id = uu.user_id
        WHERE u.client_id = $1 AND uu.day > CURRENT_DATE - $2::int GROUP BY uu.user_id`, [clientId, days]),
    q(`SELECT COALESCE(SUM(uu.seconds), 0)::bigint AS seconds FROM user_usage uu JOIN users u ON u.id = uu.user_id
        WHERE u.client_id = $1 AND uu.day > CURRENT_DATE - $2::int * 2 AND uu.day <= CURRENT_DATE - $2::int`, [clientId, days]),
    q(`SELECT s.user_id, COUNT(*)::int AS logins FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE u.client_id = $1 AND s.created_at >= now() - make_interval(days => $2::int) GROUP BY s.user_id`, [clientId, days]),
    q(`SELECT EXTRACT(HOUR FROM s.created_at AT TIME ZONE $3)::int AS hour, COUNT(*)::int AS n
         FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE u.client_id = $1 AND s.created_at >= now() - make_interval(days => $2::int) GROUP BY 1`, [clientId, days, TZ]),
    q(`SELECT to_char(uu.day, 'YYYY-MM-DD') AS d, COALESCE(SUM(uu.seconds), 0)::bigint AS seconds, COUNT(*) FILTER (WHERE uu.seconds > 0)::int AS accounts
         FROM user_usage uu JOIN users u ON u.id = uu.user_id
        WHERE u.client_id = $1 AND uu.day > CURRENT_DATE - $2::int GROUP BY uu.day ORDER BY uu.day`, [clientId, days]),
    q(`SELECT EXTRACT(DOW FROM ud.day)::int AS dow, ud.hour::int AS hour, SUM(ud.minutes)::int AS minutes
         FROM usage_detail ud WHERE ud.client_id = $1 AND ud.day > CURRENT_DATE - $2::int GROUP BY 1, 2`, [clientId, days]),
    q(`SELECT ud.view, SUM(ud.minutes)::int AS minutes, COUNT(DISTINCT ud.user_id)::int AS accounts
         FROM usage_detail ud WHERE ud.client_id = $1 AND ud.day > CURRENT_DATE - $2::int AND ud.view <> '' GROUP BY ud.view ORDER BY minutes DESC LIMIT 40`, [clientId, days]),
    q(`SELECT ud.user_id, ud.view, SUM(ud.minutes)::int AS minutes
         FROM usage_detail ud WHERE ud.client_id = $1 AND ud.day > CURRENT_DATE - $2::int GROUP BY 1, 2`, [clientId, days]),
    q(`SELECT ud.station_id, COUNT(DISTINCT ud.day)::int AS days, COUNT(DISTINCT ud.view) FILTER (WHERE ud.view <> '')::int AS views,
              SUM(ud.minutes)::int AS minutes
         FROM usage_detail ud WHERE ud.client_id = $1 AND ud.day > CURRENT_DATE - $2::int GROUP BY ud.station_id`, [clientId, days]),
    q(`SELECT ud.station_id, ud.user_id, COUNT(DISTINCT ud.day)::int AS days, COUNT(DISTINCT ud.view) FILTER (WHERE ud.view <> '')::int AS views,
              SUM(ud.minutes)::int AS minutes
         FROM usage_detail ud WHERE ud.client_id = $1 AND ud.day > CURRENT_DATE - $2::int GROUP BY 1, 2`, [clientId, days]),
    q(`SELECT COUNT(*)::int AS n FROM usage_detail ud WHERE ud.client_id = $1 AND ud.day > CURRENT_DATE - $2::int`, [clientId, days]),
    q(`SELECT to_char(MIN(uu.day), 'YYYY-MM-DD') AS since FROM user_usage uu JOIN users u ON u.id = uu.user_id WHERE u.client_id = $1`, [clientId]),
  ]);

  const dayList = dayKeys(days);
  const usageBy = Object.fromEntries(usage.map(x => [x.user_id, x]));
  const loginsBy = Object.fromEntries(logins.map(x => [x.user_id, x.logins]));
  const dailyMap = Object.fromEntries(daily.map(x => [x.d, x]));
  const dailyRows = dayList.map(d => ({ day: d, seconds: Number((dailyMap[d] || {}).seconds || 0), accounts: (dailyMap[d] || {}).accounts || 0 }));
  const hours = Array(24).fill(0), heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of rhythm) { hours[c.hour] += c.minutes; heat[c.dow][c.hour] += c.minutes; }
  const loginHourCounts = Array(24).fill(0);
  for (const x of loginHours) loginHourCounts[x.hour] += x.n;

  const viewsBy = {};
  for (const x of userViews) (viewsBy[x.user_id] = viewsBy[x.user_id] || []).push(x);
  const realViews = views.filter(v => v.view);
  const totalSeconds = dailyRows.reduce((s, d) => s + d.seconds, 0);
  const prevSeconds = Number(prev[0] ? prev[0].seconds : 0);
  const totalLogins = logins.reduce((s, x) => s + x.logins, 0);
  const activeUserIds = users.filter(u => (usageBy[u.id] && usageBy[u.id].seconds > 0) || loginsBy[u.id]);
  const activeAccountDays = dailyRows.reduce((s, d) => s + d.accounts, 0);
  const activeDays = dailyRows.filter(d => d.seconds > 0).length;
  const totalViewMinutes = views.reduce((s, v) => s + v.minutes, 0) || 1;

  // Rattachements : quelles stations pour quel compte.
  const memberOf = {}, membersBy = {};
  for (const m of members) {
    (memberOf[m.user_id] = memberOf[m.user_id] || []).push(m.station_id);
    (membersBy[m.station_id] = membersBy[m.station_id] || new Set()).add(m.user_id);
  }
  const aggBy = Object.fromEntries(stationAgg.map(x => [x.station_id, x]));
  const suBy = {};
  for (const x of stationUser) (suBy[x.station_id] = suBy[x.station_id] || {})[x.user_id] = x;
  const stationName = Object.fromEntries(stations.map(s => [s.id, s.name]));

  const stationScore = (id, attached) => {
    const agg = aggBy[id] || {}, rows = Object.values(suBy[id] || {});
    return clientEngagement({
      days, activeDays: agg.days || 0, totalUsers: attached, activeUsers: rows.filter(x => x.minutes > 0).length,
      distinctViews: agg.views || 0, totalSeconds: (agg.minutes || 0) * 60, activeAccountDays: rows.reduce((a, x) => a + x.days, 0),
    });
  };
  const stationList = stations.map(s => {
    const attached = membersBy[s.id] ? membersBy[s.id].size : 0, agg = aggBy[s.id] || {};
    return { id: s.id, name: s.name, active: s.active, seconds: (agg.minutes || 0) * 60, users_attached: attached,
      active_users: Object.values(suBy[s.id] || {}).filter(x => x.minutes > 0).length, active_days: agg.days || 0,
      distinct_views: agg.views || 0, score: stationScore(s.id, attached) };
  });
  if (aggBy[0]) {
    const agg = aggBy[0];
    stationList.push({ id: 0, name: 'Activité sans station identifiée', active: null, seconds: (agg.minutes || 0) * 60, users_attached: 0,
      active_users: Object.values(suBy[0] || {}).filter(x => x.minutes > 0).length, active_days: agg.days || 0, distinct_views: agg.views || 0, score: { value: null, level: 'Aucune donnée', components: [] } });
  }

  const accounts = users.map(u => {
    const usg = usageBy[u.id] || {};
    const uv = (viewsBy[u.id] || []).filter(v => v.view).sort((a, b) => b.minutes - a.minutes);
    const seconds = Number(usg.seconds || 0), activeD = usg.active_days || 0;
    const byStation = {};
    for (const x of stationUser) if (x.user_id === u.id) byStation[x.station_id] = { seconds: x.minutes * 60, days: x.days, views: x.views };
    return {
      id: u.id, login: u.login, display_name: u.display_name, job_title: u.job_title, role_code: u.role_code, role_label: u.role_label,
      active: u.active, last_login_at: u.last_login_at, last_activity: usg.last_activity || u.last_login_at || null,
      seconds, logins: loginsBy[u.id] || 0, active_days: activeD,
      distinct_views: uv.length, top_views: uv.slice(0, 3).map(v => ({ view: v.view, minutes: v.minutes })),
      score: accountScore({ days, activeDays: activeD, seconds, distinctViews: uv.length }),
      stations_attached: (memberOf[u.id] || []).map(id => ({ id, name: stationName[id] || 'Station' })),
      by_station: byStation,
    };
  }).sort((a, b) => b.seconds - a.seconds || b.logins - a.logins || a.login.localeCompare(b.login));

  const score = clientEngagement({
    days, activeDays, totalUsers: users.length, activeUsers: activeUserIds.length,
    distinctViews: realViews.length, totalSeconds, activeAccountDays,
  });

  return {
    days, client: { id: client.id, name: client.name }, since: since[0] ? since[0].since : null, generated_at: new Date().toISOString(),
    totals: { seconds: totalSeconds, logins: totalLogins, active_users: activeUserIds.length, total_users: users.length, active_days: activeDays, distinct_views: realViews.length },
    coverage: { usage_rows: usageRows[0] ? usageRows[0].n : 0, sessions: totalLogins, days_with_data: activeDays, stations: stations.length, users: users.length },
    trend_pct: prevSeconds > 0 ? round((totalSeconds - prevSeconds) / prevSeconds * 100) : null,
    score,
    stations: stationList,
    daily: dailyRows,
    hours_minutes: hours,
    login_hours: loginHourCounts,
    heatmap: heat,
    views: realViews.map(v => ({ view: v.view, minutes: v.minutes, accounts: v.accounts, share: round(v.minutes / totalViewMinutes * 100, 1) })),
    users: accounts,
  };
}

r.get('/admin/clients/:id/usage', needPrincipal, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant client invalide');
  const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 30));
  const out = await buildClientUsage(pool, id, days);
  if (!out) throw new HttpError(404, 'Client introuvable');
  res.json(out);
}));

module.exports = { r, buildClientUsage, clientEngagement, accountScore };
