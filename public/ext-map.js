/* Carte des stations (Mapbox GL JS) — positions = latitude/longitude saisies par l'administrateur local.
 * - Vue « Carte des stations » : stations du compte client (ou toutes les stations pour le Super Admin).
 * - Carte intégrée à la page « Mes stations ».
 * Mapbox GL JS est chargé à la demande (aucun coût au démarrage de l'application). */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  const MB_VERSION = 'v2.15.0';
  const MB_BASE = 'https://api.mapbox.com/mapbox-gl-js/' + MB_VERSION + '/';
  const DEFAULT_CENTER = [-7.9981, 12.6392];            // Bamako (affichage par défaut si aucune station localisée)
  const COLOR = { station: '#0284c7', current: '#0a6b5c' };
  let mapboxPromise = null, mapInstance = null;

  // ---- Intégration à l'application ------------------------------------------------------
  V.carte = ['Carte des stations', 'user.manage|settings.edit|report.view|finance.view'];
  try { SUPERADMIN_VIEWS.add('carte'); SHARED_VIEWS.add('carte'); } catch (_) {}   // visible Super Admin + comptes clients
  try { NAV_ICONS.carte = '🗺️'; } catch (_) {}

  // ---- Chargement paresseux de Mapbox GL JS ---------------------------------------------
  function loadMapbox() {
    if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
    if (mapboxPromise) return mapboxPromise;
    mapboxPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-mapbox]')) {
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = MB_BASE + 'mapbox-gl.css'; l.setAttribute('data-mapbox', '1');
        document.head.appendChild(l);
      }
      const s = document.createElement('script');
      s.src = MB_BASE + 'mapbox-gl.js'; s.async = true;
      s.onload = () => window.mapboxgl ? resolve(window.mapboxgl) : reject(new Error('Mapbox indisponible'));
      s.onerror = () => { mapboxPromise = null; reject(new Error('Impossible de charger Mapbox (connexion requise).')); };
      document.head.appendChild(s);
    });
    return mapboxPromise;
  }

  const validCoord = (lat, lng) => lat != null && lng != null && lat !== '' && lng !== '' &&
    Number.isFinite(+lat) && Number.isFinite(+lng) && Math.abs(+lat) <= 90 && Math.abs(+lng) <= 180;

  // ---- Fenêtre d'info d'un marqueur (DOM, pas d'HTML brut : pas d'injection) ---------------
  function popupNode(s) {
    const box = document.createElement('div');
    const b = document.createElement('b'); b.textContent = s.name || ('Station #' + s.id); box.appendChild(b);
    const add = t => { if (!t) return; box.appendChild(document.createElement('br')); box.appendChild(document.createTextNode(t)); };
    add(s.client_name); add(s.address); add(s.phone);
    add(Number(s.latitude).toFixed(5) + ', ' + Number(s.longitude).toFixed(5));
    if (s.active_users != null) add('Comptes actifs : ' + Number(s.active_users) + ' · Connectés : ' + Number(s.online_users || 0));
    return box;
  }

  function mapBlock(height) {
    return '<div id="smp-map" style="width:100%;height:' + (height || 420) + 'px;border-radius:12px;overflow:hidden;background:var(--bd)"></div>' +
           '<p id="smp-map-msg" style="font-size:12px;color:var(--m);margin:6px 0 0"></p>';
  }

  // ---- Initialisation de la carte (attend que le conteneur soit présent dans le DOM) -------
  async function initMap(stations) {
    let el = null;
    for (let i = 0; i < 40 && !(el = document.getElementById('smp-map')); i++) await new Promise(r => setTimeout(r, 50));
    if (!el) return;
    const msg = document.getElementById('smp-map-msg');
    const say = t => { if (msg) msg.textContent = t || ''; };
    try {
      const [cfg, gl] = await Promise.all([G('/config/map'), loadMapbox()]);
      if (!cfg || !cfg.token) { el.innerHTML = '<p class="warn" style="margin:12px">Jeton Mapbox absent : définissez la variable d\'environnement MAPBOX_TOKEN.</p>'; return; }
      gl.accessToken = cfg.token;
      if (mapInstance) { try { mapInstance.remove(); } catch (_) {} mapInstance = null; }

      const located = (stations || []).filter(s => validCoord(s.latitude, s.longitude));
      const first = located[0];
      mapInstance = new gl.Map({
        container: el, style: cfg.style || 'mapbox://styles/mapbox/streets-v12',
        center: first ? [+first.longitude, +first.latitude] : DEFAULT_CENTER, zoom: first ? 13 : 5,
        preserveDrawingBuffer: true   // nécessaire pour intégrer la carte dans le rapport PDF (capture du canvas)
      });
      mapInstance.addControl(new gl.NavigationControl(), 'top-right');

      const markers = {};
      located.forEach(s => {
        const cur = s.is_current || String(s.id) === String(typeof SID !== 'undefined' ? SID : '');
        const live = s.online_users != null ? s.online_users > 0 : cur;   // Super Admin : vert = au moins un compte connecté
        markers[s.id] = new gl.Marker({ color: live ? COLOR.current : COLOR.station })
          .setLngLat([+s.longitude, +s.latitude])
          .setPopup(new gl.Popup({ offset: 25 }).setDOMContent(popupNode(s)))
          .addTo(mapInstance);
      });
      if (located.length > 1) {
        const bounds = new gl.LngLatBounds();
        located.forEach(s => bounds.extend([+s.longitude, +s.latitude]));
        mapInstance.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
      }
      window.smpFocusStation = id => {
        const s = located.find(x => String(x.id) === String(id)); if (!s || !mapInstance) return;
        mapInstance.flyTo({ center: [+s.longitude, +s.latitude], zoom: 15 });
        if (markers[id]) markers[id].togglePopup();
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
      const missing = (stations || []).length - located.length;
      say(!located.length
        ? 'Aucune station localisée : renseignez la latitude et la longitude dans Paramètres → Général.'
        : (missing > 0 ? missing + ' station(s) sans coordonnées ne sont pas affichées.' : ''));
    } catch (e) {
      el.innerHTML = '<p class="warn" style="margin:12px">' + esc((e && e.message) || 'Carte indisponible') + '</p>';
    }
  }

  // ---- Export PDF « Carte des stations » -------------------------------------------------
  // Capture la carte affichée (canvas Mapbox) + numéros de station dessinés à la position des marqueurs (les marqueurs sont du DOM, absents du canvas).
  async function captureMap(list) {
    try {
      const m = mapInstance; if (!m || !document.getElementById('smp-map')) return null;
      if (!m.loaded()) await Promise.race([new Promise(r => m.once('idle', r)), new Promise(r => setTimeout(r, 5000))]);
      const src = m.getCanvas(); if (!src || !src.width || !src.height) return null;
      const draw = (maxW, quality) => {
        const k = Math.min(1, maxW / src.width), W = Math.round(src.width * k), H = Math.round(src.height * k);
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d'); g.drawImage(src, 0, 0, W, H);
        const sx = W / (src.clientWidth || src.width), sy = H / (src.clientHeight || src.height), rad = Math.max(9, 11 * sx);
        list.forEach((s, i) => {
          if (!validCoord(s.latitude, s.longitude)) return;
          const p = m.project([+s.longitude, +s.latitude]), x = p.x * sx, y = p.y * sy;
          if (x < -rad || y < -rad || x > W + rad || y > H + rad) return;
          g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2);
          g.fillStyle = (s.is_current || s.online_users > 0) ? COLOR.current : COLOR.station; g.fill();
          g.lineWidth = Math.max(2, rad / 5); g.strokeStyle = '#ffffff'; g.stroke();
          g.fillStyle = '#ffffff'; g.font = 'bold ' + Math.round(rad * 1.05) + 'px Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, y + 1);
        });
        return c.toDataURL('image/jpeg', quality);
      };
      let out = draw(1400, 0.82);
      if (out.length > 1400000) out = draw(1000, 0.65);
      return out.length <= 1500000 ? out : null;
    } catch (_) { return null; }   // canvas « tainted » ou WebGL indisponible : le rapport est produit sans la carte
  }

  window.smpExportPdf = async function () {
    const rt = window.RT, st = window.__smpView;
    if (!rt || !st) { toast('Carte non chargée', 'error'); return; }
    if (!rt.canPdf()) { toast('Droit insuffisant pour exporter ce rapport.', 'error'); return; }
    const list = st.stations || [];
    if (!list.length) { toast('Aucune station à exporter', 'info'); return; }
    const btn = document.getElementById('smp-pdf-btn'); if (btn) btn.disabled = true;
    try {
      const located = list.filter(s => validCoord(s.latitude, s.longitude)).length;
      const img = await captureMap(list);
      const all = st.scope === 'all';
      const sections = [rt.H.kv('Résumé', [['Stations', String(list.length)], ['Stations localisées', located + ' / ' + list.length], ['Stations sans coordonnées', String(list.length - located)], ['Périmètre', all ? 'Toutes les stations actives' : 'Mes stations']])];
      if (img) sections.push({ type: 'image', title: 'Carte', data: img, caption: 'Vue de la carte au moment de l\u2019export. Le numéro de chaque repère correspond à la colonne N° du tableau.' });
      else sections.push({ type: 'text', title: 'Carte', text: 'La carte n\u2019est pas disponible pour cet export (jeton Mapbox absent, hors connexion ou carte non chargée). La liste des stations ci-dessous reste complète.' });
      const head = ['N°', 'Station'].concat(all ? ['Client'] : []).concat(['Adresse (ville / quartier)', 'Latitude', 'Longitude', 'Téléphone', 'Statut']);
      sections.push({ type: 'table', title: 'Liste des stations', head: head, rows: list.map((s, i) => {
        const loc = validCoord(s.latitude, s.longitude), status = (loc ? 'Localisée' : 'Non localisée') + (s.is_current ? ' · Active' : '');
        return [i + 1, s.name || ('Station #' + s.id)].concat(all ? [s.client_name || '—'] : []).concat([s.address || '—', loc ? Number(s.latitude).toFixed(5) : '—', loc ? Number(s.longitude).toFixed(5) : '—', s.phone || '—', status])
      }), notes: ['Les champs « ville » et « quartier » ne sont pas enregistrés séparément : l\u2019adresse saisie dans la fiche station est reprise telle quelle. Coordonnées en degrés décimaux (WGS 84).'] });
      await rt.pdf({ title: 'Carte des stations', subtitle: all ? 'Toutes les stations actives' : 'Localisation des stations', period: 'État au ' + new Date().toLocaleDateString('fr-FR'), sections: sections, landscape: true, filename: 'carte-des-stations' });
    } catch (e) { toast((e && e.message) || 'Export PDF impossible', 'error'); }
    finally { if (btn) btn.disabled = false; }
  };
  // Le Super Admin n'a aucun accès aux routes métier (garde-fou serveur) : /api/docs/render lui est fermé, le bouton n'est donc proposé qu'aux comptes station.
  const pdfBtn = () => (window.RT && RT.canPdf() && !(typeof ME !== 'undefined' && ME && ME.is_global) ? '<button id="smp-pdf-btn" class="b2" onclick="smpExportPdf()" title="Exporter la liste des stations et la carte en PDF">📄 Exporter en PDF</button>' : '');

  // ---- Vue « Carte des stations » ---------------------------------------------------------
  // Super Admin : tous les clients (positions GPS) + comptes utilisateurs actifs / connectés
  const dt = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleString('fr-FR') : '—'; };
  window.smpFilterAccounts = v => {
    const q = String(v || '').toLowerCase();
    document.querySelectorAll('#smp-accounts tbody tr').forEach(r => { r.hidden = !r.textContent.toLowerCase().includes(q); });
  };
  async function carteSuperAdmin() {
    let out;
    try { out = await G('/admin/platform/clients-map'); }
    catch (e) { return '<h2 style="margin-top:0">Carte des stations</h2><p class="warn">' + esc(e.message || 'Carte indisponible') + '</p>'; }
    const list = out.stations || [], t = out.totals || {};
    const kpi = (label, v) => '<div class="card" style="padding:10px 14px;min-width:130px"><div style="font-size:12px;color:var(--m)">' + esc(label) + '</div><b style="font-size:20px">' + esc(String(v == null ? 0 : v)) + '</b></div>';
    const stationRows = list.map(s => [
      esc(s.name),
      esc(s.client_name || '—'),
      s.located ? esc(Number(s.latitude).toFixed(5)) : '—',
      s.located ? esc(Number(s.longitude).toFixed(5)) : '—',
      esc(String(s.active_users || 0)),
      s.online_users > 0 ? '<span class="tag">' + Number(s.online_users) + ' connecté(s)</span>' : '—',
      s.located ? '<button class="b2" onclick="smpFocusStation(' + Number(s.id) + ')">Voir sur la carte</button>' : '<span class="tag x">Non localisée</span>'
    ]);
    const clientRows = (out.clients || []).map(c => [
      esc(c.name),
      esc(c.status || '—'),
      esc(c.located_stations + ' / ' + c.stations),
      esc(String(c.active_users)),
      c.online_users > 0 ? '<span class="tag">' + Number(c.online_users) + '</span>' : '0'
    ]);
    const userRows = (out.users || []).map(u => [
      esc(u.login) + (u.full_name ? '<br><small style="color:var(--m)">' + esc(u.full_name) + '</small>' : ''),
      esc(u.client_name || '—'),
      esc(u.role_label || '—'),
      esc(u.station_names || '—'),
      esc(dt(u.last_login_at)),
      u.online ? '<span class="tag">🟢 Connecté</span>' : '<span class="tag x">Hors ligne</span>'
    ]);
    setTimeout(() => initMap(list), 0);
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0">Carte des stations</h2><span style="display:flex;gap:8px;flex-wrap:wrap">' + pdfBtn() + '<button class="b2" onclick="go(\'carte\')">↻ Actualiser</button></span></div>' +
      '<p style="font-size:13px;color:var(--m)">Toutes les stations actives de vos clients, positionnées d\'après les coordonnées GPS saisies par chaque administrateur local. Marqueur vert = au moins un compte connecté ; bleu = aucun compte connecté.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">' + kpi('Clients', t.clients) + kpi('Stations localisées', (t.located_stations || 0) + ' / ' + (t.stations || 0)) + kpi('Comptes actifs', t.active_users) + kpi('Comptes connectés', t.online_users) + '</div>' +
      mapBlock(460) +
      '<h3 style="margin:18px 0 8px">Clients</h3>' + T(['Client', 'Statut', 'Stations localisées', 'Comptes actifs', 'Connectés'], clientRows) +
      '<h3 style="margin:18px 0 8px">Stations</h3>' + T(['Station', 'Client', 'Latitude', 'Longitude', 'Comptes actifs', 'Connectés', ''], stationRows) +
      '<h3 style="margin:18px 0 8px">Comptes utilisateurs actifs</h3>' +
      '<input type="search" placeholder="Filtrer par compte, client, rôle, station…" oninput="smpFilterAccounts(this.value)" style="max-width:380px;margin-bottom:8px">' +
      '<div id="smp-accounts">' + T(['Compte', 'Client', 'Rôle', 'Stations', 'Dernière connexion', 'Statut'], userRows) + '</div>';
  }

  VM.carte = async function () {
    if (typeof ME !== 'undefined' && ME && ME.is_global) return carteSuperAdmin();
    const out = await G('/stations/map').catch(() => ({ stations: [] }));
    const list = out.stations || [];
    const all = out.scope === 'all';
    const rows = list.map(s => [
      esc(s.name) + (s.is_current ? ' <span class="tag">Active</span>' : ''),
      all ? esc(s.client_name || '—') : esc(s.address || '—'),
      s.located ? esc(Number(s.latitude).toFixed(5)) : '—',
      s.located ? esc(Number(s.longitude).toFixed(5)) : '—',
      s.located ? '<button class="b2" onclick="smpFocusStation(' + Number(s.id) + ')">Voir sur la carte</button>' : '<span class="tag x">Non localisée</span>'
    ]);
    window.__smpView = { stations: list, scope: out.scope };
    setTimeout(() => initMap(list), 0);
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0">Carte des stations</h2>' + pdfBtn() + '</div>' +
      '<p style="font-size:13px;color:var(--m);margin-top:0">' + (all
        ? 'Toutes les stations actives des comptes clients. Les positions proviennent des coordonnées saisies par chaque administrateur local.'
        : 'Vos stations, positionnées d\'après leurs coordonnées GPS (Paramètres → Général : Latitude et Longitude).') + '</p>' +
      mapBlock(460) +
      '<div style="margin-top:14px">' + T(['Station', all ? 'Client' : 'Adresse', 'Latitude', 'Longitude', ''], rows) + '</div>';
  };

  // ---- Carte intégrée à « Mes stations » --------------------------------------------------
  const prevStations = VM.stations;
  if (typeof prevStations === 'function') {
    VM.stations = async function () {
      const html = await prevStations.apply(this, arguments);
      const out = await G('/stations/map').catch(() => ({ stations: [] }));
      setTimeout(() => initMap(out.stations || []), 0);
      return html + '<h3 style="margin-top:18px">Localisation des stations</h3>' + mapBlock(380);
    };
  }

  // Libère le contexte WebGL quand on quitte la page de la carte
  const prevGo = window.go;
  if (typeof prevGo === 'function') {
    window.go = async function (k) {
      if (mapInstance && k !== 'carte' && k !== 'stations') { try { mapInstance.remove(); } catch (_) {} mapInstance = null; }
      return prevGo.apply(this, arguments);
    };
  }
})();
