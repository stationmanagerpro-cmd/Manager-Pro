/* Confort visible (cahier des charges d'amélioration — lot A) : A5, A6, A9.
 * Affichage uniquement : aucun calcul, aucune valeur stockée en base n'est modifié.
 * Chargé en dernier : il s'appuie sur les vues déjà définies par app.js et les ext-*.js. */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  /* ===================== A5 — filet de sécurité d'affichage (toutes les pages) =====================
   * Les fonctions communes f() (montants), fq() (quantités), dt() (dates), stFr() (statuts) sont dans app.js.
   * Ce filet corrige, à l'écran, ce qui n'est pas encore passé par elles : statuts bruts, litres avec point décimal,
   * dates avec secondes (sauf journal d'audit). Il ne touche ni aux champs de saisie ni aux données. */
  const STATUS = { cloture: 'Clôturé', ouvert: 'Ouvert', annule: 'Annulé', facture: 'Facturé', recu: 'Reçu', commande: 'Commandé' };
  const SKIP = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE', 'CODE', 'PRE']);
  const RE_L = /(-?\d+)\.(\d+)(\s*L\b)/g;
  const RE_SEC = /\b(\d{2}\/\d{2}\/\d{4})[ ,]+(\d{2}:\d{2}):\d{2}\b/g;

  function fixText(node, keepSeconds) {
    const raw = node.nodeValue; if (!raw || !raw.trim()) return;
    const key = raw.trim().toLowerCase();
    let out = raw;
    if (STATUS[key]) out = raw.replace(raw.trim(), STATUS[key]);
    else {
      out = out.replace(RE_L, (m, a, b, u) => nfr(parseFloat(a + '.' + b), 3) + u);
      if (!keepSeconds) out = out.replace(RE_SEC, '$1 $2');
    }
    if (out !== raw) node.nodeValue = out;
  }
  function fixTree(root) {
    const keepSeconds = typeof cur !== 'undefined' && (cur === 'audit' || cur === 'auditx');
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement && !SKIP.has(n.parentElement.tagName) && !n.parentElement.closest('textarea,select')) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(n => fixText(n, keepSeconds));
  }
  let queued = false;
  function schedule() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; const pg = document.getElementById('pg'); if (pg) { try { fixTree(pg); } catch (_) { /* affichage seulement : jamais bloquant */ } } });
  }
  function startObserver() {
    const pg = document.getElementById('pg'); if (!pg) return setTimeout(startObserver, 300);
    new MutationObserver(schedule).observe(pg, { childList: true, subtree: true });   // pas characterData : nos corrections ne se relancent pas
    schedule();
  }
  startObserver();

  /* ===================== A6 — Pompes : un seul tableau, une ligne par compteur ===================== */
  VM.pompes = async function () {
    const [ps, st, hist] = await Promise.all([G('/pumps'), G('/pumps/status').catch(() => null), G('/pumps/history').catch(() => [])]);
    window.PU = ps;                                      // utilisé par « Corriger index » et « Produit »
    const canEdit = can('settings.edit');
    const closed = {};
    for (const p of (st && st.pumps) || []) for (const c of p.counters || []) closed[p.id + ':' + c.counter_number] = c;
    const rows = [];
    for (const p of ps) {
      const actionsPump = canEdit ? `<button class="b2" onclick="editPump(${Number(p.id)})">Modifier</button>` : '';
      if (!(p.counters || []).length) { rows.push([esc(p.name), esc(p.location || '—'), stFr(p.status), '—', '—', '—', '—', '—', actionsPump]); continue; }
      for (const c of p.counters) {
        const k = closed[p.id + ':' + c.counter_number] || {};
        const corr = canEdit ? `<button class="b2" onclick="correctCounterIndex(${Number(p.id)},${Number(c.counter_number)},${Number(c.current_index)})">Corriger index</button> ` : '';
        rows.push([
          esc(p.name), esc(p.location || '—'), stFr(p.status), esc(String(c.counter_number)), esc(c.product || '—'),
          fq(c.current_index),
          k.last_closed_index != null ? fq(k.last_closed_index) : '—',
          k.last_closed_at ? dt(k.last_closed_at) : '—',
          corr + actionsPump
        ]);
      }
    }
    return `<h2 style="margin-top:0">Pompes &amp; compteurs</h2>
      <p style="font-size:12px;color:var(--m)">${esc((st && st.note) || 'État des compteurs au dernier quart clôturé.')}</p>
      ${T(['Pompe', 'Emplacement', 'Statut', 'Compteur', 'Produit', 'Index courant', 'Dernier clôturé', 'Clôture', 'Actions'], rows)}
      <div class="bar">${canEdit ? '<button onclick="addPump()">+ Ajouter une pompe</button>' : ''}<button class="b2" onclick="go('stock')">Stock</button><button class="b2" onclick="go('quart')">Quarts</button></div>
      <p style="color:var(--m);font-size:12px">« Corriger index » rectifie une erreur de saisie : un motif de 3 caractères minimum est obligatoire et l'ancienne et la nouvelle valeur sont inscrites dans le journal d'audit.</p>
      ${pumpHistoryHtml(hist)}`;
  };
  /* Historique des pompes : création, modifications, changements de produit, corrections d'index */
  const PH_LAB = { number: 'Numéro', name: 'Nom', location: 'Emplacement', status: 'Statut', current_index: 'Index', product_id: 'Produit', compteur_1: 'Compteur 1', compteur_2: 'Compteur 2' };
  const PH_ST = { active: 'Actif', inactive: 'Inactif', maintenance: 'En maintenance' };
  function pumpHistoryHtml(hist) {
    const val = (k, x) => x == null || x === '' ? '—' : esc(k === 'status' ? (PH_ST[x] || x) : String(x));
    const rows = (hist || []).map(h => {
      const o = h.old_value || {}, n = h.new_value || {};
      const keys = Object.keys(n).filter(k => !['reason', 'counters', 'open_shift'].includes(k) && (h.old_value || k in o));
      let det = keys.length
        ? keys.map(k => `<b>${esc(PH_LAB[k] || k)}</b> : ${val(k, o[k])} → ${val(k, n[k])}`).join('<br>')
        : (h.old_value ? '' : 'Création de la pompe');
      if (n.reason) det += (det ? '<br>' : '') + '<i>Motif : ' + esc(n.reason) + '</i>';
      return [dt(h.created_at), esc(h.login || '—'), esc(h.action), det || '—'];
    });
    return `<h3>Historique des modifications</h3>
      <p style="font-size:12px;color:var(--m)">Chaque création, modification, changement de produit ou correction d'index est daté et attribué à son auteur.</p>
      ${T(['Date', 'Utilisateur', 'Opération', 'Détail (avant → après)'], rows)}`;
  }

  /* ===================== A9 — Un seul point d'entrée « Alertes » avec onglets ===================== */
  const MAP = { alert: 'todo', alertcfg: 'config', notifrules: 'rules', alerthist: 'hist' };
  const KEY = { todo: 'alert', config: 'alertcfg', rules: 'notifrules', hist: 'alerthist' };
  const LABEL = { todo: 'À traiter', config: 'Configuration', rules: 'Règles de notification', hist: 'Historique' };
  const orig = { todo: VM.alert, config: VM.alertcfg, rules: VM.notifrules };
  let TAB = 'todo';

  async function histTab() {
    const get = s => G('/messaging/system-alerts?status=' + s + '&limit=100').then(r => r.alerts || []);
    let rows;
    try { rows = (await Promise.all([get('resolved'), get('acknowledged')])).flat(); }
    catch (e) { return `<p class="warn">Historique indisponible : ${esc(errMsg(e))}</p>`; }
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const lab = { acknowledged: 'Pris en charge', resolved: 'Résolue' };
    return `<h2 style="margin-top:0">Historique des alertes</h2>
      <p style="font-size:12px;color:var(--m)">Alertes déjà prises en charge ou résolues.</p>` +
      T(['Date', 'Alerte', 'Statut', 'Pris en charge par', 'Résolue le', 'Note'], rows.map(a => [
        dt(a.created_at), esc(a.kind || '—') + '<br><small style="color:var(--m)">' + esc(String(a.body || '').slice(0, 110)) + '</small>',
        `<span class="tag ${a.alert_status === 'resolved' ? '' : 'x'}">${esc(lab[a.alert_status] || a.alert_status)}</span>`,
        esc(a.acknowledged_by_name || '—'), a.resolved_at ? dt(a.resolved_at) : '—', esc(a.resolution_note || '')
      ]));
  }

  async function emailNotice() {
    try {
      const r = await G('/messaging/email-status');
      if (r && r.configured === false) {
        return `<div class="warn" style="margin-bottom:12px"><b>L'envoi d'e-mails n'est pas configuré sur le serveur.</b><br>Les alertes restent visibles dans le site (cloche), mais aucun e-mail ne partira. Demandez à la personne qui gère l'hébergement de renseigner SMTP_HOST (et SMTP_USER / SMTP_PASS).</div>`;
      }
    } catch (_) { /* information facultative */ }
    return '';
  }

  async function alertsPage() {
    const tabs = Object.keys(KEY).filter(t => t === 'todo' || t === 'hist' || (typeof canView === 'function' && canView(KEY[t]) && typeof orig[t] === 'function'));
    if (!tabs.includes(TAB)) TAB = 'todo';
    const head = `<div class="tabs" role="tablist" aria-label="Alertes">${tabs.map(t => `<a role="tab" class="${t === TAB ? 'on' : ''}" aria-selected="${t === TAB}" onclick="go('${KEY[t]}')">${LABEL[t]}</a>`).join('')}</div>`;
    let body = '';
    try {
      if (TAB === 'hist') body = await histTab();
      else if (TAB === 'config') body = (await emailNotice()) + await orig.config();
      else if (typeof orig[TAB] === 'function') body = await orig[TAB]();
      else body = '<p class="warn">Cette section n\'est pas disponible.</p>';
    } catch (e) { body = `<p class="warn">${esc(errMsg(e))}</p>`; }
    return head + body;
  }
  VM.alert = alertsPage;
  // Les anciens liens (go('alertcfg'), go('notifrules')…) ouvrent le bon onglet de la page « Alertes ».
  if (typeof window.go === 'function') {
    const prevGo = window.go;
    window.go = function (k, a) {
      if (MAP[k]) { TAB = MAP[k]; k = 'alert'; }
      return prevGo.call(this, k, a);
    };
  }
})();
