/* Priorité 10 — Nouveau Dashboard enrichi (stats réelles après P3–P9) */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  const CARD_META = {
    revenue: { label: "Chiffre d'affaires", key: 'revenue', fmt: true, icon: '💰' },
    fuel: { label: 'Ventes carburant', key: 'fuel_revenue', fmt: true, icon: '⛽' },
    products: { label: 'Ventes produits', key: 'product_revenue', fmt: true, icon: '🛒' },
    expenses: { label: 'Dépenses', key: 'expenses', fmt: true, icon: '📤' },
    net: { label: 'Résultat (CA − dépenses)', key: 'net', fmt: true, icon: '📈' },
    margin: { label: 'Marge brute', key: 'gross_margin', fmt: true, icon: '📊' },           // CA − coût d'achat des ventes (quarts clôturés)
    margin_pct: { label: 'Taux de marge brute', key: 'margin_pct_label', fmt: false, icon: '％' },
    profit: { label: 'Résultat de gestion', key: 'operating_result', fmt: true, icon: '🏦' },  // marge − dépenses − charges patronales
    cash: { label: 'Liquidités caisse', key: 'cash_balance', fmt: true, icon: '💵' },
    receivables: { label: 'Créances clients', key: 'receivables', fmt: true, icon: '🧾' },
    payables: { label: 'Dettes fournisseurs', key: 'payables', fmt: true, icon: '📦' },
    low_stock: { label: 'Stock bas', key: 'low_stock', fmt: false, count: true, icon: '⚠️' },
    open_shift: { label: 'Quarts ouverts', key: 'open_shifts', fmt: false, count: true, icon: '🕐' },
    alerts: { label: 'Alertes non lues', key: 'unread_alerts', fmt: false },
    connected: { label: 'Utilisateurs connectés', key: 'connected_users', fmt: false }   // fourni seulement aux profils user.manage
  };

  function cardHtml(label, value, icon) {
    const ico = icon ? `<span class="card-ico" aria-hidden="true">${icon}</span>` : '';
    return `<div class="card kpi-card">${ico}<div class="card-body"><small>${esc(label)}</small><b>${value}</b></div></div>`;
  }

  async function vDashNew() {
    const [a, b] = range(P);
    const [d, dl, cfgWrap] = await Promise.all([
      G(`/dashboard?from=${a}&to=${b}`),
      G('/dashboard/daily?days=7'),
      G('/dashboard/config').catch(() => ({ config: null }))
    ]);
    const cfg = (cfgWrap && cfgWrap.config) || {
      cards: { revenue: true, fuel: true, products: true, expenses: true, cash: true, receivables: true, payables: true, low_stock: true, open_shift: true, alerts: true, net: true, margin: true, margin_pct: true, profit: true },
      charts: { daily_revenue: true, payments_by_method: true },
      sections: { profile: true, recent_activity: true, shifts: true, low_stock_list: true, fuel_by_product: true, shortcuts: true },
      shortcuts: ['jour', 'caisse', 'quart', 'ventes', 'cli', 'alert', 'exports']
    };

    const cardsOn = cfg.cards || {};
    const chartsOn = cfg.charts || {};
    const sec = cfg.sections || {};

    // Cartes KPI
    let cardsHtml = '';
    for (const [id, meta] of Object.entries(CARD_META)) {
      if (cardsOn[id] === false) continue;
      // Cartes de marge : visibles pour les profils finance même si l'ancienne configuration du client ne les connaît pas encore
      if ((id === 'margin' || id === 'margin_pct' || id === 'profit') && cardsOn[id] === undefined && !can('finance.view|finance.report')) continue;
      if (d[meta.key] === null || d[meta.key] === undefined) continue;   // montant masqué par permission (créances / dettes) : jamais affiché comme 0
      let val;
      if (meta.count) {
        const arr = d[meta.key];
        val = Array.isArray(arr) ? arr.length : (d[meta.key] || 0);
      } else if (meta.fmt) {
        val = f(d[meta.key] || 0);
      } else {
        val = d[meta.key] != null ? d[meta.key] : '—';
      }
      const partial = (id === 'margin' || id === 'profit') && d.margin_reliable === false;   // coûts d'achat manquants : valeur surestimée
      cardsHtml += cardHtml(meta.label + (partial ? ' (partielle)' : ''), val, meta.icon);
    }

    // Graphique CA journalier
    const chartId = 'dashChart' + Date.now();
    const pieId = 'dashPie' + Date.now();
    if (chartsOn.daily_revenue !== false) {
      setTimeout(() => {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById(chartId);
        if (!ctx) return;
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: (dl || []).map(x => x.day.slice(8) + '/' + x.day.slice(5, 7)),
            datasets: [{
              label: "Chiffre d'affaires",
              data: (dl || []).map(x => x.revenue),
              backgroundColor: 'rgba(13, 122, 107, 0.75)',
              borderRadius: 4,
              borderSkipped: false
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, ticks: { callback: v => new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v) } },
              x: { grid: { display: false } }
            }
          }
        });
      }, 50);
    }
    if (chartsOn.payments_by_method !== false && (d.payments_by_method || []).length) {
      setTimeout(() => {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById(pieId);
        if (!ctx) return;
        const methods = d.payments_by_method || [];
        new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: methods.map(x => x.method),
            datasets: [{
              data: methods.map(x => Number(x.amount)),
              backgroundColor: ['#0d7a6b', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b']
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }
          }
        });
      }, 60);
    }

    // Profil
    let profileHtml = '';
    if (sec.profile !== false && d.profile) {
      const now = d.server_time ? new Date(d.server_time) : new Date();
      const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      profileHtml = `<div class="card" style="grid-column:1/-1">
        <small>Connecté</small>
        <b style="font-size:1rem">${esc(d.profile.login)} · ${esc(d.profile.role)}${d.profile.is_global ? ' (Admin Principal)' : ''}</b>
        <p style="margin:6px 0 0;font-size:12px;color:var(--m)">${esc(dateStr)} · ${esc(timeStr)} · Période ${esc(d.period.from)} → ${esc(d.period.to)}</p>
      </div>`;
    }

    // Raccourcis
    let shortcutsHtml = '';
    if (sec.shortcuts !== false) {
      const sc = (cfg.shortcuts || []).filter(k => V[k] && can(V[k][1]));
      if (sc.length) {
        shortcutsHtml = `<div class="bar" style="flex-wrap:wrap;gap:6px;margin:12px 0">
          ${sc.map(k => `<button class="b2" onclick="go(${jsArg(k)})">${NAV_ICONS[k] || ''} ${esc(V[k][0])}</button>`).join('')}
        </div>`;
      }
    }

    // Activité récente
    let recentHtml = '';
    if (sec.recent_activity !== false && (d.recent_activity || []).length) {
      recentHtml = `<h3 style="margin-top:16px">Activité récente</h3>` +
        T(['Type', 'Libellé', 'Montant', 'Date'], (d.recent_activity || []).map(x => [
          `<span class="tag">${esc(x.type)}</span>`,
          esc(x.label),
          x.amount != null ? f(x.amount) : '—',
          dt(x.at)
        ]));
    }

    // Quarts ouverts
    let shiftsHtml = '';
    if (sec.shifts !== false && (d.open_shifts || []).length) {
      shiftsHtml = `<h3 style="margin-top:16px">Quarts ouverts</h3>` +
        T(['N°', 'Type', 'Ouvert le', ''], (d.open_shifts || []).map(s => [
          s.number, esc(s.kind), dt(s.opened_at),
          `<button class="b2" type="button" onclick="event.preventDefault();event.stopPropagation();window.showShiftFull(${Number(s.id)})">Voir</button>`
        ]));
    }

    // Stock bas
    let stockHtml = '';
    if (sec.low_stock_list !== false && (d.low_stock || []).length) {
      stockHtml = `<h3 style="margin-top:16px">Stock sous minimum</h3>` +
        T(['Produit', 'Qté', 'Min'], (d.low_stock || []).map(x => [
          esc(x.name), x.quantity, x.min_stock
        ]));
    }

    // Carburant par produit
    let fuelHtml = '';
    if (sec.fuel_by_product !== false && (d.fuel_by_product || []).length) {
      fuelHtml = hb('Carburant par produit', (d.fuel_by_product || []).map(x => [x.name, Number(x.amount), `${Number(x.liters).toFixed(1)} L · ${f(x.amount)}`]));
    }

    // Charts containers
    let chartsHtml = '';
    if (chartsOn.daily_revenue !== false) {
      chartsHtml += `<div class="card" style="height:220px;margin-top:12px"><canvas id="${chartId}"></canvas></div>`;
    }
    if (chartsOn.payments_by_method !== false && (d.payments_by_method || []).length) {
      chartsHtml += `<div class="card" style="height:220px;margin-top:12px"><small>Paiements par moyen</small><canvas id="${pieId}"></canvas></div>`;
    }

    // La configuration du dashboard se fait dans chaque compte client (le Superadmin n'y a plus accès).
    let adminLink = '';

    const adHtml = (typeof adPanelHtml === 'function') ? adPanelHtml() : '';

    return `${adHtml}<div class="bar"><select onchange="P=this.value;go('dash')">${[['today', "Aujourd'hui"], ['yday', 'Hier'], ['week', 'Semaine'], ['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année'], ['custom', 'Période personnalisée']].map(x => `<option value="${x[0]}" ${x[0] == P ? 'selected' : ''}>${x[1]}</option>`).join('')}</select>${P == 'custom' ? `<input type="date" value="${a}" onchange="CA=this.value;go('dash')"><input type="date" value="${b}" onchange="CB=this.value;go('dash')">` : ''}
      <button class="b2" onclick="go('jour')">Jour J</button>
      ${adminLink}
    </div>
    <div class="cards">${profileHtml}${cardsHtml}</div>
    ${shortcutsHtml}
    ${chartsHtml}
    ${fuelHtml}
    ${shiftsHtml}
    ${stockHtml}
    ${recentHtml}`;
  }

  // Remplace le dashboard classique
  VM.dash = vDashNew;
})();
