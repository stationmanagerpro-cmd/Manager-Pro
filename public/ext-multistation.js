/* Multi-stations — espace dédié au compte client (limites contrat + indicateurs consolidés) */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  V.stations = ['Mes stations', 'user.manage|settings.edit|report.view|finance.view'];

  function quotaFromContract(quotaApi) {
    if (quotaApi) {
      return {
        max: quotaApi.max_stations != null ? Number(quotaApi.max_stations) : null,
        canCreate: !!quotaApi.can_create_station && !quotaApi.suspended,
        used: quotaApi.stations_used != null ? Number(quotaApi.stations_used) : (ME.stations || []).length,
        suspended: !!quotaApi.suspended
      };
    }
    const c = ME && ME.contract;
    if (!c || c.unrestricted) return { max: null, canCreate: true, used: (ME.stations || []).length };
    return {
      max: c.max_stations != null ? Number(c.max_stations) : null,
      canCreate: !!c.can_create_station && !c.suspended,
      used: (ME.stations || []).length,
      suspended: !!c.suspended
    };
  }

  async function refreshStationsFromMe() {
    try {
      const me = await G('/me');
      if (me && Array.isArray(me.stations)) ME.stations = me.stations;
      if (me && me.contract) ME.contract = me.contract;
    } catch (_) {}
  }

  function fmtMoney(n, cur) {
    try {
      return (typeof f === 'function' ? f(n) : Number(n || 0).toLocaleString('fr-FR')) + (cur ? ' ' + cur : '');
    } catch (_) {
      return String(n);
    }
  }

  async function vStations() {
    if (ME?.is_global) {
      return `<p class="warn">Le Super Admin gère les stations depuis le détail de chaque compte client.</p>
        <button class="b2" onclick="go('clients')">Comptes clients & licences</button>`;
    }
    await refreshStationsFromMe();
    const overview = await G('/stations/overview').catch(() => null);
    const q = quotaFromContract(overview && overview.quota);
    const list = (overview && overview.stations && overview.stations.length)
      ? overview.stations
      : (ME.stations || []).map(s => ({
          id: s.id, name: s.name, currency: s.currency, is_current: String(s.id) === String(SID),
          open_shifts: null, low_stock: null, employees: null, sales_today: null
        }));
    const totals = (overview && overview.totals) || {
      stations: list.length, open_shifts: '—', low_stock: '—', employees: '—', sales_today: null
    };
    const canCreate = q.canCreate && (q.max == null || q.used < q.max);
    const limitLabel = q.max == null ? 'Illimité' : `${q.used} / ${q.max}`;

    const rows = list.map(s => {
      const active = s.is_current || String(s.id) === String(SID);
      return [
        esc(s.name) + (active ? ' <span class="tag">Active</span>' : ''),
        esc(s.currency || 'FCFA'),
        s.open_shifts != null ? String(s.open_shifts) : '—',
        s.low_stock != null ? String(s.low_stock) : '—',
        s.employees != null ? String(s.employees) : '—',
        s.sales_today != null ? fmtMoney(s.sales_today, s.currency) : '—',
        active
          ? '<span style="color:var(--m);font-size:12px">En cours</span>'
          : `<button class="b2" onclick="chSt(${Number(s.id)})">Basculer</button>`
      ];
    });

    const createBtn = can('user.manage')
      ? (canCreate
          ? `<button onclick="msCreateStation()">Ajouter une station</button>`
          : `<button disabled title="Limite atteinte ou non autorisée par le contrat">Ajouter une station</button>`)
      : '';

    return `<h2 style="margin-top:0">Mes stations</h2>
      <p style="font-size:13px;color:var(--m);margin-top:0">
        Vue consolidée de vos stations. Les totaux agrègent toutes les stations accessibles ;
        les chiffres par ligne restent propres à chaque station (aucune fusion de données métier).
      </p>
      <div class="cards">
        <div class="card"><small>Stations</small><b>${totals.stations}</b></div>
        <div class="card"><small>Quota contrat</small><b>${esc(limitLabel)}</b></div>
        <div class="card"><small>Quarts ouverts (total)</small><b>${totals.open_shifts}</b></div>
        <div class="card"><small>Alertes stock bas (total)</small><b>${totals.low_stock}</b></div>
        <div class="card"><small>Employés actifs (total)</small><b>${totals.employees}</b></div>
        <div class="card"><small>Ventes du jour (total)</small><b>${totals.sales_today != null ? fmtMoney(totals.sales_today) : '—'}</b></div>
      </div>
      <div class="bar" style="margin:12px 0;flex-wrap:wrap;gap:8px">
        ${createBtn}
        <button class="b2" onclick="go('admin')">Centre d'administration</button>
        <button class="b2" onclick="go('stations')">Actualiser</button>
      </div>
      ${rows.length
        ? T(['Station', 'Devise', 'Quarts ouverts', 'Stock bas', 'Employés', 'Ventes jour', ''], rows)
        : '<p class="warn">Aucune station accessible. Contactez l\'Administrateur Principal.</p>'}
      ${typeof msRenderCompare === 'function' ? msRenderCompare(list) : ''}
      <p style="font-size:12px;color:var(--m);margin-top:12px">
        Création : ${q.suspended ? 'bloquée (contrat suspendu)' : (q.canCreate ? (canCreate ? 'autorisée dans la limite du contrat' : 'limite atteinte') : 'interdite par le contrat')}.
        Isolation : ventes, stocks, quarts et employés restent séparés par station_id.
      </p>`;
  }

  window.msCreateStation = function () {
    if (!can('user.manage')) return toast('Permission user.manage requise', 'error');
    const q = quotaFromContract();
    if (q.suspended) return toast('Contrat suspendu : création impossible', 'error');
    if (!q.canCreate) return toast('Création de station non autorisée par votre contrat', 'error');
    if (q.max != null && q.used >= q.max) {
      return toast(`Limite de stations atteinte (${q.used}/${q.max})`, 'error');
    }
    form('Nouvelle station', [
      ['name', 'Nom de la station *'],
      ['address', 'Adresse'],
      ['latitude', 'Latitude (ex. 12.6392)'],
      ['longitude', 'Longitude (ex. -7.9981)'],
      ['phone', 'Téléphone'],
      ['currency', 'Devise']
    ], { currency: 'FCFA' }, async d => {
      const name = String(d.name || '').trim();
      if (!name) { toast('Nom obligatoire', 'error'); return; }
      const s = await Po('/stations', {
        name,
        address: d.address || undefined,
        phone: d.phone || undefined,
        currency: d.currency || 'FCFA',
        latitude: String(d.latitude || '').trim() || undefined,
        longitude: String(d.longitude || '').trim() || undefined
      });
      closeM();
      toast('Station créée : ' + s.name, 'success');
      await refreshStationsFromMe();
      if (typeof stationOptions === 'function') stationOptions();
      if (s && s.id && typeof chSt === 'function') await chSt(s.id);
      else if (typeof go === 'function') go('stations');
    });
  };

  const prevNew = window.newStation;
  window.newStation = function () {
    if (typeof window.msCreateStation === 'function') return window.msCreateStation();
    if (typeof prevNew === 'function') return prevNew();
  };

  Object.assign(VM, { stations: vStations });

  window.msRenderCompare = function (stations) {
    if (!stations || stations.length < 2) return '';
    const maxSales = Math.max(1, ...stations.map(s => Number(s.sales_today) || 0));
    const maxVol = Math.max(1, ...stations.map(s => Number(s.fuel_liters_today) || Number(s.volume_today) || 0));
    const rows = stations.map(s => {
      const sales = Number(s.sales_today) || 0;
      const vol = Number(s.fuel_liters_today) || Number(s.volume_today) || 0;
      const gap = Number(s.cash_gap_open) || Number(s.open_cash_gap) || 0;
      return [
        esc(s.name || ('#' + s.id)),
        (typeof f === 'function' ? f(sales) : sales),
        '<div style="height:8px;background:var(--bd);border-radius:4px;min-width:80px"><i style="display:block;height:8px;width:' +
          Math.round(sales / maxSales * 100) + '%;background:var(--p);border-radius:4px"></i></div>',
        vol ? (Math.round(vol * 10) / 10) + ' L' : '—',
        s.open_shifts != null ? s.open_shifts : (s.open_shift ? 1 : 0),
        s.low_stock != null ? s.low_stock : '—',
        gap ? (typeof f === 'function' ? f(gap) : gap) : '—'
      ];
    });
    return '<h3 style="margin-top:18px">Comparatif du jour</h3>' +
      T(['Station', 'CA jour', '', 'Volume', 'Quarts ouverts', 'Stock bas', 'Écart caisse'], rows);
  };

})();