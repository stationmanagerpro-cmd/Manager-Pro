/* ext-platform-insights.js — Superadmin : santé des clients (0–100), comparaison des stations, journal des erreurs, relances de licence.
   Capture aussi les erreurs d'écran (JS) de tous les utilisateurs connectés vers /errors/client. API : src/platform_insights.js. */
(function () {
  'use strict';
  if (typeof G === 'undefined') return;

  /* ---- Capture des erreurs d'écran (une seule fois, limitée côté serveur) ---- */
  var sent = 0;
  function report(message, stack) {
    try {
      if (typeof ME === 'undefined' || !ME || ME.is_global || sent >= 5) return; sent++;
      var view = (typeof window.__view === 'string' ? window.__view : (location.hash || '').replace('#', '')).slice(0, 60);
      Po('/errors/client', { message: String(message || 'Erreur').slice(0, 500), stack: stack ? String(stack).slice(0, 4000) : null, view: view || null, path: location.pathname }).catch(function () { });
    } catch (_) { /* jamais d'erreur dans le rapporteur */ }
  }
  window.addEventListener('error', function (e) { report(e.message, e.error && e.error.stack); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; report(r && r.message ? r.message : String(r), r && r.stack); });

  var dt = function (d) { return d ? new Date(d).toLocaleString('fr-FR') : '—'; };
  var lvl = { bon: ['Bon', '#16a34a'], a_surveiller: ['À surveiller', '#f59e0b'], a_risque: ['À risque', '#ef4444'] };
  var bar = function (days, tab) { return '<div class="bar"><label style="flex-direction:row;align-items:center;gap:6px">Période <select onchange="window.__piDays=+this.value;goAdminTab(\'' + tab + '\')">' +
    [7, 30, 90, 180].map(function (d) { return '<option value="' + d + '"' + (d === days ? ' selected' : '') + '>' + d + ' jours</option>'; }).join('') + '</select></label></div>'; };

  async function health() {
    var days = window.__piDays || 30, d = await G('/admin/platform/health?days=' + days);
    var rem = await G('/admin/platform/license-reminders').catch(function () { return []; });
    return '<h2 style="margin-top:0">Santé des clients</h2><p class="muted">Score de 0 à 100 : activité (30), quarts clôturés (30), écarts de caisse (20), licence (20). Une composante sans donnée vaut la moitié des points et est signalée « incomplet ».</p>' + bar(days, 'health') +
      '<div class="cards"><div class="card"><small>À risque</small><b>' + d.at_risk + '</b></div><div class="card"><small>À surveiller</small><b>' + d.watch + '</b></div><div class="card"><small>Clients</small><b>' + d.clients.length + '</b></div></div>' +
      T(['Client', 'Score', 'Niveau', 'Activité', 'Quarts', 'Écarts', 'Licence', 'Points d\'attention'], d.clients.map(function (c) {
        var l = lvl[c.level] || [c.level, '#64748b'];
        return [esc(c.name), '<b style="color:' + l[1] + '">' + c.score + '</b>', '<span class="tag" style="background:' + l[1] + '22;color:' + l[1] + '">' + l[0] + (c.incomplete ? ' (incomplet)' : '') + '</span>', (c.active_days || 0) + ' j sur ' + days + ' · ' + c.parts.activite + '/30 pts', (c.shifts_opened ? (c.shifts_closed || 0) + ' clôturé(s) sur ' + c.shifts_opened : 'aucun quart') + ' · ' + c.parts.quarts + '/30 pts', (c.parts.ecarts) + '/20 pts', c.parts.licence + '/20 pts', esc(c.reasons.join(' · ') || '—')];
      })) +
      '<h3>Relances de licence envoyées (30, 15 et 7 jours)</h3><div class="bar"><button class="b2" onclick="piRunReminders()">Lancer la vérification maintenant</button></div>' +
      T(['Client', 'Échéance', 'Palier', 'Envoyée le', 'Stations notifiées'], rem.map(function (x) { return [esc(x.name), String(x.expires_on).slice(0, 10), x.band + ' j', dt(x.sent_at), x.stations]; }));
  }
  window.piRunReminders = async function () { try { var r = await Po('/admin/platform/license-reminders/run', {}); toast(r.sent + ' relance(s) envoyée(s)', 'success'); goAdminTab('health'); } catch (e) { toast(e.message, 'error'); } };

  async function compare() {
    var days = window.__piDays || 30, named = !!window.__piNamed, d = await G('/admin/platform/compare?days=' + days + (named ? '&names=1' : ''));
    var m = function (v) { return typeof fmtN === 'function' ? fmtN(v) : String(Math.round(v)); };
    return '<h2 style="margin-top:0">Comparaison des stations</h2><p class="muted">Classement par ventes sur la période. Marge : ' + esc(d.margin_scope) + '. Écart de caisse : somme des écarts des quarts clôturés (négatif = manque).</p>' + bar(days, 'compare') +
      '<div class="bar"><label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" ' + (named ? 'checked' : '') + ' onchange="window.__piNamed=this.checked;goAdminTab(\'compare\')"> Afficher les noms (sinon anonymisé)</label></div>' +
      T(['Rang', 'Station', 'Ventes', 'Marge boutique', 'Écart de caisse', 'Quarts clôturés'], d.stations.map(function (s) { return [s.rank, esc(s.label), m(s.sales), m(s.shop_margin), '<span style="color:' + (s.cash_gap < 0 ? '#dc2626' : 'inherit') + '">' + m(s.cash_gap) + '</span>', s.shifts_closed]; }));
  }

  async function errors() {
    var hours = window.__piHours || 72, d = await G('/admin/platform/errors?hours=' + hours);
    return '<h2 style="margin-top:0">Journal des erreurs</h2><p class="muted">Erreurs du serveur (500, base de données) et erreurs d\'écran des utilisateurs, regroupées. Conservées 30 jours.</p>' +
      '<div class="bar"><label style="flex-direction:row;align-items:center;gap:6px">Fenêtre <select onchange="window.__piHours=+this.value;goAdminTab(\'errors\')">' + [24, 72, 168, 720].map(function (h) { return '<option value="' + h + '"' + (h === hours ? ' selected' : '') + '>' + (h < 48 ? h + ' h' : h / 24 + ' jours') + '</option>'; }).join('') + '</select></label><b>' + d.total + ' occurrence(s)</b></div>' +
      (d.errors.length ? T(['Dernière', 'Origine', 'Où', 'Message', 'Fois', 'Clients'], d.errors.map(function (e) {
        return [dt(e.last_at), e.source === 'server' ? 'Serveur' : 'Écran', esc((e.method ? e.method + ' ' : '') + (e.path || e.view || '—') + (e.status ? ' · ' + e.status : '')), '<details><summary>' + esc(e.message) + '</summary><pre style="white-space:pre-wrap;font-size:11px;max-width:560px;overflow:auto">' + esc(e.stack || '') + '</pre></details>', e.occurrences, e.clients];
      })) : '<p>Aucune erreur sur la période. ✅</p>');
  }

  window.renderPlatformInsights = async function (tab) { return tab === 'health' ? health() : tab === 'compare' ? compare() : errors(); };
})();
