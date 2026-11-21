/* Scan QR des pompes — (1) scanner + préremplissage du formulaire de vente carburant, (2) vue « Gestion des QR Codes ».
 * Règle d'or : le QR identifie le compteur ; le compte connecté identifie l'employé ; affectations et quart décident ; le SERVEUR autorise.
 * Ce fichier ne fait que préparer l'écran : il n'enregistre jamais de vente et n'envoie au serveur que l'identifiant du scan (qr_scan_id) ;
 * le serveur refait tous les contrôles à la validation. Aucune donnée d'employé ou de produit n'est lue du navigateur pour décider. */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  const E = { QR_INVALID: 'QR Code non reconnu.', CAMERA_DENIED: 'L’autorisation d’accès à la caméra a été refusée.', NETWORK_ERROR: 'Vérification impossible auprès du serveur. Réessayez lorsque la connexion est rétablie.',
    CAMERA_UNAVAILABLE: 'Aucune caméra disponible. Saisissez la référence imprimée sous le QR Code.' };
  const esc_ = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const say = (m, k) => { if (typeof toast === 'function') toast(m, k || 'info'); };
  const isNet = e => !e || e.status === 0 || e.status === undefined || e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(String(e.message || ''));
  const errText = e => (e && e.details && e.details.code && e.message) ? e.message : (isNet(e) ? E.NETWORK_ERROR : (typeof errMsg === 'function' ? errMsg(e) : (e && e.message) || 'Erreur'));

  /* ---------------------------------------------------------------- Scanner caméra (Web) / scanner natif (Android) */
  const hasNative = () => !!(window.AndroidBridge && window.AndroidBridge.scan);
  let session = null;   // { stream, timer, closed }

  function stopCamera() {
    if (!session) return;
    session.closed = true; clearTimeout(session.timer);
    try { if (session.stream) session.stream.getTracks().forEach(t => t.stop()); } catch (_) {}
    const v = document.getElementById('qrs_video'); if (v) { try { v.pause(); v.srcObject = null; } catch (_) {} }
    session = null;
  }

  /** Ouvre le scanner et appelle onText({ code } ou { short_ref }) une seule fois, puis libère la caméra. */
  async function openScanner(onText) {
    if (hasNative()) {   // Application Android : lecteur ML Kit natif (formats QR inclus), pas de WebView getUserMedia
      let done = false;
      window.__mpScanHandler = c => { if (done || !window.__qrScanWanted) return false; done = true; window.__qrScanWanted = false; onText({ code: String(c || '') }); return true; };   // même forme d'objet que sur le Web : un texte brut serait refusé (JSON invalide)
      window.__qrScanWanted = true; try { window.AndroidBridge.scan(); } catch (e) { window.__qrScanWanted = false; say(E.CAMERA_UNAVAILABLE, 'error'); }
      return;
    }
    // Surcouche PROPRE au scanner : modal() n'a qu'un emplacement et effacerait le formulaire de vente en cours de saisie.
    const old = document.getElementById('qrs_overlay'); if (old) old.remove();
    const ov = document.createElement('div'); ov.id = 'qrs_overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Scanner une pompe');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = '<div style="background:var(--card,#fff);color:var(--fg,#111);border-radius:14px;padding:16px;width:100%;max-width:420px;max-height:96vh;overflow:auto">' + ('<h3>Scanner une pompe</h3><p class="muted" style="margin-top:0">Placez le QR Code de la pompe dans le cadre.</p>' +
      '<div style="position:relative;background:#000;border-radius:10px;overflow:hidden;aspect-ratio:1/1;max-width:360px;margin:0 auto">' +
      '<video id="qrs_video" playsinline muted autoplay style="width:100%;height:100%;object-fit:cover"></video>' +
      '<div style="position:absolute;inset:18%;border:3px solid #fff;border-radius:12px;box-shadow:0 0 0 999px rgba(0,0,0,.35);pointer-events:none"></div></div>' +
      '<p id="qrs_msg" class="muted" style="text-align:center;min-height:1.4em">Démarrage de la caméra…</p>' +
      '<details style="margin:6px 0"><summary>La caméra ne fonctionne pas ? Saisir la référence</summary>' +
      '<label>Référence imprimée sous le QR Code (ex. 7F3K-9A2C)<input id="qrs_ref" autocomplete="off" maxlength="12" placeholder="XXXX-XXXX"></label><div class="r"><button type="button" id="qrs_refok" class="b2">Valider la référence</button></div></details>' +
      '<div class="r"><button type="button" class="b2" id="qrs_close">Fermer sans vente</button></div>') + '</div>';
    document.body.appendChild(ov);
    const msg = t => { const m = document.getElementById('qrs_msg'); if (m) m.textContent = t; };
    const drop = () => { stopCamera(); const o = document.getElementById('qrs_overlay'); if (o) o.remove(); };
    const finish = payload => { drop(); onText(payload); };
    const cancel = drop;
    document.getElementById('qrs_close').onclick = cancel;
    document.getElementById('qrs_refok').onclick = () => { const v = (document.getElementById('qrs_ref').value || '').trim(); if (v) finish({ short_ref: v }); };
    // fermeture du dialogue par un autre moyen (Échap, clic extérieur…) : la caméra doit être libérée
    const watch = setInterval(() => { if (!document.getElementById('qrs_video')) { clearInterval(watch); stopCamera(); } }, 400);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return msg(E.CAMERA_UNAVAILABLE + (location.protocol !== 'https:' && location.hostname !== 'localhost' ? ' (HTTPS obligatoire pour la caméra.)' : ''));
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }); }
    catch (e) { return msg(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? E.CAMERA_DENIED + ' ' + 'Autorisez la caméra dans le navigateur ou saisissez la référence.' : E.CAMERA_UNAVAILABLE); }
    if (!document.getElementById('qrs_video')) { stream.getTracks().forEach(t => t.stop()); return; }   // dialogue fermé pendant la demande d'autorisation
    session = { stream, timer: null, closed: false };
    const video = document.getElementById('qrs_video'); video.srcObject = stream; try { await video.play(); } catch (_) {}
    msg('Recherche du QR Code…');
    let detector = null;
    try { if (window.BarcodeDetector) detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { detector = null; }
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (!session || session.closed) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          let text = null;
          if (detector) { const r = await detector.detect(video); if (r && r[0]) text = r[0].rawValue; }
          if (!text && window.SMPQr) {   // repli sans BarcodeDetector (Firefox, Safari…) : décodeur intégré
            const w = Math.min(video.videoWidth, 640), h = Math.round(video.videoHeight * w / video.videoWidth); canvas.width = w; canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h); const img = ctx.getImageData(0, 0, w, h); const r = window.SMPQr.decodeRGBA(img.data, w, h); if (r) text = typeof r === 'string' ? r : r.text;
          }
          if (text) return finish({ code: text });
        }
      } catch (_) { /* image illisible : on réessaie */ }
      if (session && !session.closed) session.timer = setTimeout(tick, detector ? 120 : 220);
    };
    tick();
  }

  /* ---------------------------------------------------------------- Préremplissage du formulaire de vente carburant */
  window.__qrScan = null;   // { scan_id, expires_at, counter_id, pump_id, employee } — seul l'identifiant du scan est envoyé au serveur

  function lockForm(d) {
    const $ = s => document.querySelector(s), sel = $('#fs_pump'), fc = $('#fc');
    if (!sel || !fc) return false;
    if (![...sel.options].some(o => Number(o.value) === Number(d.pump.id))) { say('Cette pompe n’est pas disponible dans votre formulaire de vente (quart ou affectation).', 'error'); return false; }
    sel.value = String(d.pump.id); if (typeof sel.onchange === 'function') sel.onchange();   // reconstruit la liste des compteurs
    const apply = () => {
      if (![...fc.options].some(o => Number(o.value) === Number(d.counter.id))) return false;
      fc.value = String(d.counter.id); if (typeof fc.onchange === 'function') fc.onchange();
      sel.disabled = true; fc.disabled = true;
      const lab = $('#fs_emp_label'), es = $('#fs_emp_sel'), fe = $('#fe');
      if (es) es.style.display = 'none'; if (lab) { lab.style.display = ''; lab.value = d.employee.name + ' (compte connecté)'; } if (fe) fe.value = String(d.employee.id);
      return true;
    };
    setTimeout(() => { if (!apply()) say('Compteur introuvable dans le formulaire : scan ignoré.', 'error'); }, 0);
    return true;
  }

  function banner(d) {
    let b = document.getElementById('qr_banner');
    if (!b) { b = document.createElement('div'); b.id = 'qr_banner'; b.setAttribute('role', 'status'); b.style.cssText = 'margin:6px 0 10px;padding:8px 12px;border-radius:8px;background:rgba(22,163,74,.12);border:1px solid rgba(22,163,74,.45);font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      const host = document.querySelector('.sp-grid'); if (host && host.parentNode) host.parentNode.insertBefore(b, host); }
    b.innerHTML = d ? '✓ <b>Pompe identifiée par QR Code</b> : ' + esc_(d.pump.name || ('Pompe ' + d.pump.number)) + ' · ' + esc_(d.product.name) + ' · ' + esc_(d.employee.name) + ' <button type="button" class="b2" id="qr_unlock" style="margin-left:auto">Annuler le scan</button>' : '';
    b.style.display = d ? '' : 'none';
    const u = document.getElementById('qr_unlock'); if (u) u.onclick = () => { window.__qrScan = null; const s = document.getElementById('fs_pump'), c = document.getElementById('fc'); if (s) s.disabled = false; if (c) c.disabled = false; banner(null); const b2 = document.getElementById('qr_scan_btn'); if (b2) b2.disabled = false; };
  }

  async function onScanned(payload) {
    try {
      const r = await api('POST', '/sales/scan-pump', payload);
      if (!r || !r.can_record_sale) return say('Scan refusé.', 'error');
      if (!document.getElementById('fs_pump')) return;   // formulaire fermé entre-temps
      if (lockForm(r)) { window.__qrScan = { scan_id: r.scan_id, expires_at: r.expires_at, counter_id: r.counter.id, pump_id: r.pump.id, employee: r.employee }; banner(r); say('Pompe identifiée : complétez la vente puis enregistrez.', 'success'); }
    } catch (e) { say(errText(e), 'error'); }
  }

  function addScanButton() {
    if (document.getElementById('qr_scan_btn') || !document.querySelector('.sp-ttl')) return;
    const tabs = document.getElementById('fm'); if (!tabs || !tabs.parentNode) return;
    const row = document.createElement('div'); row.style.cssText = 'margin:8px 0';
    row.innerHTML = '<button type="button" id="qr_scan_btn" class="b2" style="font-weight:600">📷 Scanner une pompe</button> <span class="muted" style="font-size:12px">Identifie la pompe et le produit ; la vente reste à confirmer.</span>';
    tabs.parentNode.insertBefore(row, tabs);
    document.getElementById('qr_scan_btn').onclick = () => openScanner(onScanned);
  }

  if (typeof window.addFuel === 'function') {
    const baseAddFuel = window.addFuel;
    window.addFuel = async function () { window.__qrScan = null; const r = await baseAddFuel.apply(this, arguments); try { if (typeof can !== 'function' || can('sale.create')) addScanButton(); } catch (_) {} return r; };
  }
  /* La vente envoie le scan, jamais l'employé ni le produit « décidés » par le navigateur. Hors connexion : refus (aucune vente par scan sans contrôle serveur). */
  if (typeof window.smpFuelSale === 'function') {
    const baseSale = window.smpFuelSale;
    window.smpFuelSale = function (body, deps) {
      const s = window.__qrScan;
      if (s && body && document.getElementById('qr_banner') && document.getElementById('qr_banner').style.display !== 'none') body.qr_scan_id = s.scan_id;
      return baseSale.call(this, body, deps);
    };
  }
  window.addEventListener('pagehide', stopCamera);

  /* ---------------------------------------------------------------- Vue d'administration « Gestion des QR Codes » */
  V.qrcodes = ['Gestion des QR Codes', 'qr.manage'];
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.qrcodes = '🔳';
  const ST = { active: ['Actif', '#16a34a'], revoked: ['Révoqué', '#dc2626'], replaced: ['Remplacé', '#6b7280'] };
  const EV = { generate: 'Génération', revoke: 'Révocation', regenerate: 'Régénération', print: 'Impression', scan_ok: 'Scan accepté', scan_refused: 'Scan refusé', sale_ok: 'Vente par scan', sale_refused: 'Vente refusée' };
  const fdt = s => s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  const hdr = () => ({ Authorization: 'Bearer ' + TK, ...(SID && { 'X-Station-Id': SID }) });
  async function deliverPdf(resp, name) {
    try {
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || ('Erreur ' + resp.status)); }
      const url = URL.createObjectURL(await resp.blob());
      const save = () => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
      if (window.AndroidBridge || !window.open) save(); else if (!window.open(url, '_blank')) save();
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      if (typeof go === 'function') setTimeout(() => go('qrcodes'), 600);   // le compteur d'impressions change
    } catch (e) { say('Impression impossible : ' + (e.message || e), 'error'); }
  }
  window.qrPrintOne = async id => { try { await deliverPdf(await fetch(`/api/qr-codes/${Number(id)}/label.pdf`, { headers: hdr() }), 'qr-code-' + Number(id) + '.pdf'); } catch (e) { say(errText(e), 'error'); } };
  window.qrPrintSheet = async () => { try { await deliverPdf(await fetch('/api/qr-codes/sheet.pdf', { headers: hdr() }), 'qr-codes-station.pdf'); } catch (e) { say(errText(e), 'error'); } };
  window.qrGenerateAll = async function () {
    try { const r = await api('POST', '/qr-codes/bulk', {}); say(r.created && r.created.length ? r.created.length + ' QR Code(s) généré(s)' : 'Tous les points de distribution ont déjà un QR Code actif', 'success'); go('qrcodes'); }
    catch (e) { say(errText(e), 'error'); }
  };
  window.qrGenerateOne = async function (pumpId, counterId) {
    try { await api('POST', '/pumps/' + Number(pumpId) + '/qr-code', { counter_id: Number(counterId) }); say('QR Code généré', 'success'); go('qrcodes'); } catch (e) { say(errText(e), 'error'); }
  };
  window.qrRevoke = async function (id) {
    const reason = prompt('Révoquer ce QR Code ? L’étiquette ne fonctionnera plus immédiatement.\nMotif (facultatif) :', ''); if (reason === null) return;
    try { await api('PATCH', '/qr-codes/' + Number(id) + '/revoke', reason.trim() ? { reason: reason.trim() } : {}); say('QR Code révoqué', 'success'); go('qrcodes'); } catch (e) { say(errText(e), 'error'); }
  };
  window.qrRegenerate = async function (id) {
    const reason = prompt('Régénérer ce QR Code ? L’ancien devient inutilisable immédiatement : il faudra réimprimer l’étiquette.\nMotif (facultatif) :', ''); if (reason === null) return;
    try { await api('POST', '/qr-codes/' + Number(id) + '/regenerate', reason.trim() ? { reason: reason.trim() } : {}); say('Nouveau QR Code généré : réimprimez l’étiquette', 'success'); go('qrcodes'); } catch (e) { say(errText(e), 'error'); }
  };
  window.qrHistory = async function () {
    try {
      const h = await api('GET', '/qr-codes/history?limit=200');
      modal('<h3>Historique des QR Codes</h3><div style="max-height:60vh;overflow:auto">' + (typeof T === 'function' ? T(['Date', 'Événement', 'Résultat', 'Pompe', 'Réf.', 'Utilisateur', 'Motif'],
        (h || []).map(x => [fdt(x.at), esc_(EV[x.event] || x.event), x.result === 'ok' ? 'OK' : '<span style="color:#dc2626">Refusé</span>', x.pump_number != null ? esc_(x.pump_number) : '—', esc_(x.short_ref || '—'), esc_(x.user_name || '—'), esc_(x.reason_code || '')])) : '') + '</div><div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>');
    } catch (e) { say(errText(e), 'error'); }
  };

  async function vQrCodes() {
    let d; try { d = await G('/qr-codes'); } catch (e) { return '<p class="warn">' + esc_(errText(e)) + '</p>'; }
    const items = d.items || [], t = d.totals || {};
    const rows = items.map(x => {
      const st = x.qr_id ? ST.active : ['Aucun QR Code', '#6b7280'];
      return [esc_(x.pump_name || ('Pompe ' + x.pump_number)) + (x.pump_status !== 'active' ? ' <small>(désactivée)</small>' : ''), 'C' + Number(x.counter_number) + ' · ' + esc_(x.product),
        '<span class="tag" style="background:' + st[1] + '22;color:' + st[1] + '">' + st[0] + '</span>' + (x.qr_id ? '<br><small class="muted">' + Number(x.print_count) + ' impression(s)</small>' : ''), x.short_ref ? '<code>' + esc_(x.short_ref) + '</code>' : '—', fdt(x.qr_created_at),
        '<div style="display:flex;gap:6px;flex-wrap:wrap;min-width:120px">' + (x.qr_id ? '<button class="b2" onclick="qrPrintOne(' + Number(x.qr_id) + ')">Imprimer</button><button class="b2" onclick="qrRegenerate(' + Number(x.qr_id) + ')">Régénérer</button><button class="b2" onclick="qrRevoke(' + Number(x.qr_id) + ')">Révoquer</button>'
          : '<button class="b2" onclick="qrGenerateOne(' + Number(x.pump_id) + ',' + Number(x.counter_id) + ')">Générer</button>') + '</div>'];
    });
    return '<h2 style="margin-top:0">Gestion des QR Codes</h2>' +
      '<p class="muted">Un QR Code par point de distribution (compteur) : il identifie la pompe et le produit. L’employé est celui du compte connecté ; l’affectation et le quart sont vérifiés par le serveur à chaque scan et à la validation de la vente.</p>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px"><button onclick="qrGenerateAll()">Générer les QR Codes manquants</button><button class="b2" onclick="qrPrintSheet()"' + (t.with_qr ? '' : ' disabled') + '>Imprimer la planche A4 de la station</button><button class="b2" onclick="qrHistory()">Historique</button>' +
      '<span style="margin-left:auto" class="muted">' + Number(t.with_qr || 0) + ' / ' + Number(t.counters || 0) + ' points avec QR Code actif</span></div>' +
      (items.length ? T(['Pompe', 'Compteur · produit', 'Statut', 'Référence', 'Généré le', 'Actions'], rows) : '<p class="muted">Aucune pompe configurée pour cette station.</p>');
  }
  VM.qrcodes = vQrCodes;
})();
