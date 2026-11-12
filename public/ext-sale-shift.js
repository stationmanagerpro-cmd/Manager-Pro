/**
 * Interface de saisie de vente adaptée au quart ouvert
 * - Pompe → employé affecté (auto)
 * - Modes de paiement : uniquement moyens liés à un compte (+ espèces / crédit)
 * - Progression d'index aussi en mode litres / montant
 */
(function () {
  'use strict';

  function escLocal(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function linkedPayMethods() {
    try {
      const rows = await G('/payment-methods/linked?all=1');
      if (Array.isArray(rows) && rows.length) {
        // [code, libellé, utilisable] : un moyen non rattaché à un compte actif reste visible (grisé) au lieu de disparaître
        return rows.map(r => [r.code, r.label || r.code, r.linked !== false]);
      }
    } catch (_) { /* repli */ }
    if (typeof pmOpts === 'function') return pmOpts();
    return [['especes', 'Espèces']];
  }

  /** Boutons de mode de paiement : tous les moyens actifs ; ceux sans compte actif sont grisés avec une explication. */
  function payBtnsHtml(opts) {
    const first = opts.findIndex(o => o[2] !== false);
    return opts.map(([c, l, ok], i) => ok === false
      ? `<button type="button" class="pay" disabled data-nl="1" data-c="${escLocal(c)}" aria-pressed="false" title="${escLocal(l)} n’est rattaché à aucun compte actif : rattachez-le dans Finance › Moyens de paiement.">${escLocal(l)} <small>(compte non rattaché)</small></button>`
      : `<button type="button" class="pay${i === first ? ' selected' : ''}" data-c="${escLocal(c)}" aria-pressed="${i === first ? 'true' : 'false'}">${escLocal(l)}</button>`).join('');
  }

  function isLocalAdmin() {
    try {
      if (!ME) return false;
      if (ME.is_global) return false;
      const role = String(ME.role || '').toUpperCase();
      return role === 'ADMIN' || role === 'GERANT' || role === 'SUPERVISEUR'
        || (typeof can === 'function' && (can('shift.open') || can('settings.edit')));
    } catch (_) { return false; }
  }

  function dayDefault() {
    if (typeof dayNow === 'function') return dayNow();
    return new Date().toISOString().slice(0, 10);
  }

  /** Vente carburant : pompe → employé auto, paiements liés */
  window.addFuel = async function addFuelShift() {
    if (typeof can === 'function' && !can('sale.create')) return toast('Permission vente refusée', 'error');
    const cu = await G('/shifts/current');
    if (!cu) return toast('Ouvrez un quart pour saisir des ventes', 'error');

    const [cl, payOpts] = await Promise.all([
      G('/customers').catch(() => []),
      linkedPayMethods()
    ]);

    const team = Array.isArray(cu.team) ? cu.team : [];
    const counters = Array.isArray(cu.counters) ? cu.counters : [];
    if (!counters.length) return toast('Aucun compteur relevé sur ce quart', 'error');

    // Pompes distinctes du quart
    const pumpMap = {};
    counters.forEach(c => {
      const pid = c.pump_id;
      if (!pumpMap[pid]) pumpMap[pid] = { id: pid, name: c.pump, counters: [] };
      pumpMap[pid].counters.push(c);
    });
    const pumps = Object.values(pumpMap);

    const admin = isLocalAdmin();
    // Employé connecté (pompiste)
    let ownEmpId = null;
    try {
      const emps = await G('/employees').catch(() => []);
      const me = (emps || []).find(e => e.user_id && ME && Number(e.user_id) === Number(ME.id));
      if (me) ownEmpId = me.id;
    } catch (_) {}

    // Filtrer pompes si pompiste non admin
    let visiblePumps = pumps;
    if (!admin && ownEmpId && team.length) {
      const mine = team.find(t => Number(t.id) === Number(ownEmpId));
      const allowed = new Set((mine && mine.pump_ids) || (mine && mine.pump_id != null ? [mine.pump_id] : []));
      if (allowed.size) visiblePumps = pumps.filter(p => allowed.has(Number(p.id)));
    }

    function empForPump(pumpId) {
      const hit = team.find(t => {
        const ids = Array.isArray(t.pump_ids) ? t.pump_ids : (t.pump_id != null ? [t.pump_id] : []);
        return ids.map(Number).includes(Number(pumpId));
      });
      return hit || null;
    }

    const pumpOpts = visiblePumps.map(p =>
      `<option value="${Number(p.id)}">${escLocal(p.name)}</option>`
    ).join('');

    const cur_ = typeof CUR !== 'undefined' ? CUR : 'FCFA';
    modal(`<div class="sp">
      <div class="sp-head"><div class="sp-ico" aria-hidden="true">⛽</div>
        <div class="sp-ttl"><h3>Enregistrer une vente carburant</h3>
        <p>La pompe détermine l’employé affecté à l’ouverture du quart. Les ventes mettent à jour la progression d’index du compteur.</p></div>
        <span class="sp-shift">◷ Quart n° ${escLocal(cu.number)} en cours</span></div>
      <div class="tabs" id="fm">
        <a data-m="index" class="on">Par index</a>
        <a data-m="litres">En litres</a>
        ${typeof AP !== 'undefined' && AP.fuel_amount_entry_allowed !== false ? '<a data-m="montant">En montant</a>' : ''}
      </div>
      <div class="sp-grid">
        <div class="sp-main">
          <div class="g">
            ${admin ? `<label>Date<input type="date" id="fs_date" value="${dayDefault()}"></label>` : ''}
            <label>Pompe<select id="fs_pump">${pumpOpts}</select></label>
            <label>Compteur<select id="fc"></select></label>
            <label>Employé<input id="fs_emp_label" type="text" readonly style="background:var(--bg, #f5f5f5)">
              <input type="hidden" id="fe"></label>
            <label class="fi">Ancien index<input id="fo" type="number" step="any" readonly style="background:var(--bg,#f1f1f1);cursor:not-allowed" title="Index initial : repris automatiquement du dernier index connu, non modifiable"></label>
            <label class="fi">Nouvel index<input id="fn" type="number" step="any"></label>
            <label class="fl" style="display:none">Quantité (litres)<input id="fq" type="number" step="any"></label>
            <label class="fa" style="display:none">Montant (${cur_})<input id="fa" type="number" step="any"></label>
            <label style="display:none">Mode de paiement<select id="fp">${payOpts.filter(o => o[2] !== false).map(([c, l]) => `<option value="${escLocal(c)}">${escLocal(l)}</option>`).join('')}</select></label>
            <label>Client (si crédit)<select id="fu"><option value="">Aucun</option>${(cl || []).map(c => `<option value="${c.id}">${escLocal(c.name)}</option>`).join('')}</select></label>
            <label>Carte flotte (n°, facultatif)<input id="fcard" type="text" autocomplete="off" placeholder="Scanner ou saisir le numéro"></label>
            <label class="fcx" style="display:none">PIN de la carte<input id="fpin" type="password" inputmode="numeric" autocomplete="off" maxlength="6"></label>
            <label class="fcx" style="display:none">Kilométrage du véhicule<input id="fodo" type="number" step="any" min="0"></label>
          </div>
          <div class="sp-pay"><div class="sp-paytitle">Mode de paiement</div>
            <div class="sp-paybtns" id="fpb" role="group" aria-label="Mode de paiement">${payBtnsHtml(payOpts)}</div></div>
        </div>
        <aside class="sp-sum" aria-live="polite">
          <div class="sp-sum-head">Récapitulatif</div>
          <div class="sp-sum-body">
            <div class="sp-line"><span>Produit</span><strong id="fr_prod">—</strong></div>
            <div class="sp-line"><span>Quantité</span><strong id="fr_l">0 L</strong></div>
            <div class="sp-line"><span>Prix unitaire</span><strong id="fr_p">—</strong></div>
            <div class="sp-total"><span>Total à encaisser</span><strong id="fr_t">0 ${cur_}</strong></div>
            <div class="sp-ready" id="fr_ok" data-ok="0">Saisie à compléter</div>
            <div class="sp-note" id="fsum"></div>
          </div>
        </aside>
      </div>
      <div class="r sp-actions"><button type="button" class="b2 b-orange" onclick="closeM()">✕ Annuler</button><button type="button" id="fok" class="sp-save">✓ Enregistrer la vente</button></div></div>`);
    function syncPay() {
      const dis = $('#fp').disabled, v = $('#fp').value;
      document.querySelectorAll('#fpb .pay').forEach(b => { const on = b.dataset.c === v; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.disabled = dis || b.dataset.nl === '1'; });
    }
    document.querySelectorAll('#fpb .pay').forEach(b => { b.onclick = () => { $('#fp').value = b.dataset.c; syncPay(); }; });

    window.FM = 'index';
    window.FX = {};
    // Carte flotte : la vente est facturée au titulaire de la carte (crédit) ; paiement et client sont alors imposés par la carte.
    $('#fcard').oninput = () => {
      const on = !!$('#fcard').value.trim();
      document.querySelectorAll('.fcx').forEach(x => { x.style.display = on ? '' : 'none'; });
      $('#fp').disabled = on; $('#fu').disabled = on; syncPay();
    };

    function fillCounters() {
      const pid = Number($('#fs_pump').value);
      const p = visiblePumps.find(x => Number(x.id) === pid);
      const opts = (p ? p.counters : []).map(c =>
        `<option value="${c.counter_id}">C${c.counter_number} · ${escLocal(c.product)}</option>`
      ).join('');
      $('#fc').innerHTML = opts || '<option value="">—</option>';
      const emp = empForPump(pid);
      if (emp) {
        $('#fs_emp_label').value = emp.name || ('#' + emp.id);
        $('#fe').value = emp.id;
      } else if (ownEmpId) {
        $('#fs_emp_label').value = 'Vous';
        $('#fe').value = ownEmpId;
      } else {
        $('#fs_emp_label').value = '— non affecté —';
        $('#fe').value = '';
      }
    }

    async function loadF() {
      try {
        window.FX = await G('/sales/fuel/expected?counter_id=' + $('#fc').value);
        $('#fo').value = window.FX.expected_old_index;
      } catch (e) {
        window.FX = {};
        toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || 'Erreur'), 'error');
      }
      calcF();
    }

    function calcF() {
      const price = Number((window.FX && window.FX.price) || 0);
      let liters = 0, amount = 0, txt = '';
      if (window.FM === 'index') {
        const o = Number($('#fo').value), n = Number($('#fn').value);
        if (n > o) { liters = n - o; amount = liters * price; }
      } else if (window.FM === 'litres') {
        liters = Number($('#fq').value) || 0;
        amount = liters * price;
      } else {
        amount = Number($('#fa').value) || 0;
        liters = price > 0 ? amount / price : 0;
      }
      if (price) txt = `${liters.toFixed(3)} L × ${typeof f === 'function' ? f(price) : price} = <b>${typeof f === 'function' ? f(amount) : amount}</b>`;
      $('#fsum').innerHTML = txt || 'Sélectionnez un compteur et saisissez la quantité.';
      const fm = typeof f === 'function' ? f : (v => String(v)), opt = $('#fc') && $('#fc').selectedOptions && $('#fc').selectedOptions[0];
      if ($('#fr_t')) {
        $('#fr_prod').textContent = opt && opt.value ? opt.textContent : '—';
        $('#fr_l').textContent = liters ? liters.toFixed(3).replace(/\.?0+$/, '') + ' L' : '0 L';
        $('#fr_p').textContent = price ? fm(price) : '—';
        $('#fr_t').textContent = fm(Math.round(amount * 100) / 100);
        const ready = amount > 0 && !!($('#fc') && $('#fc').value);
        $('#fr_ok').dataset.ok = ready ? '1' : '0';
        $('#fr_ok').textContent = ready ? '✓ Transaction prête' : 'Saisie à compléter';
      }
    }

    async function sendF(confirm) {
      const body = {
        counter_id: Number($('#fc').value),
        mode: window.FM === 'montant' ? 'montant' : window.FM,
        employee_id: $('#fe').value ? Number($('#fe').value) : undefined,
        payments: [{ method: $('#fp').value, amount: 0 }],
        customer_id: $('#fu').value ? Number($('#fu').value) : undefined,
        confirm: !!confirm
      };
      const cardNo = ($('#fcard').value || '').trim();
      if (cardNo) {
        body.customer_id = undefined;
        body.fleet_card = { number: cardNo, pin: ($('#fpin').value || '').trim() || undefined, odometer_km: $('#fodo').value ? Number($('#fodo').value) : undefined };
      }
      if (window.FM === 'index') {
        body.index_old = Number($('#fo').value);
        body.index_new = Number($('#fn').value);
      } else if (window.FM === 'litres') {
        body.liters = Number($('#fq').value);
      } else {
        body.amount = Number($('#fa').value);
      }
      // montant paiement = total calculé côté serveur ; on envoie une estimation puis le serveur valide
      try {
        // Premier essai pour obtenir le montant exact via erreur ou succès
        const price = Number((window.FX && window.FX.price) || 0);
        let est = 0;
        if (window.FM === 'index') est = (Number($('#fn').value) - Number($('#fo').value)) * price;
        else if (window.FM === 'litres') est = Number($('#fq').value) * price;
        else est = Number($('#fa').value);
        body.payments[0].amount = Math.round(est * 100) / 100;
        if ($('#fp').value === 'credit' && !body.customer_id && !body.fleet_card) {
          toast('Client requis pour un paiement à crédit', 'error');
          return;
        }
        const sent = await smpFuelSale(body);
        closeM();
        if (sent && sent.queued) toast('Hors ligne : vente gardée sur l’appareil, envoi automatique au retour du réseau', 'info');
        else toast('Vente carburant enregistrée', 'success');
        if (typeof go === 'function') go(typeof cur !== 'undefined' ? cur : 'quart');
      } catch (e) {
        if (e && e.status === 409 && Array.isArray(e.details || e.warnings || e.body?.warnings)) {   // le serveur renvoie les avertissements dans « details »
          if (confirm('Attention :\n' + (e.details || e.warnings || e.body.warnings).join('\n') + '\n\nConfirmer ?')) {
            body.confirm = true;
            try {
              const sent2 = await smpFuelSale(body);
              closeM();
              toast(sent2 && sent2.queued ? 'Hors ligne : vente gardée sur l’appareil, envoi automatique au retour du réseau' : 'Vente enregistrée', sent2 && sent2.queued ? 'info' : 'success');
              if (typeof go === 'function') go(typeof cur !== 'undefined' ? cur : 'quart');
            } catch (e2) {
              toast(typeof errMsg === 'function' ? errMsg(e2) : (e2.message || 'Erreur'), 'error');
            }
          }
        } else {
          toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || 'Erreur'), 'error');
        }
      }
    }

    document.querySelectorAll('#fm a').forEach(a => {
      a.onclick = () => {
        window.FM = a.dataset.m;
        document.querySelectorAll('#fm a').forEach(x => x.classList.toggle('on', x === a));
        document.querySelectorAll('.fi').forEach(x => { x.style.display = window.FM === 'index' ? '' : 'none'; });
        document.querySelectorAll('.fl').forEach(x => { x.style.display = window.FM === 'litres' ? '' : 'none'; });
        document.querySelectorAll('.fa').forEach(x => { x.style.display = window.FM === 'montant' ? '' : 'none'; });
        calcF();
      };
    });
    ['fo', 'fn', 'fq', 'fa'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.oninput = calcF;
    });
    $('#fs_pump').onchange = async () => { fillCounters(); await loadF(); };
    $('#fc').onchange = loadF;
    $('#fok').onclick = () => sendF(false);
    fillCounters();
    await loadF();
  };

  /** Vente de produit (boutique, lubrifiants…) — même présentation que la vente carburant ; employé = participant du quart. */
  window.addProductSale = async function addProductSalePro() {
    if (typeof can === 'function' && !can('sale.create')) return toast('Permission vente refusée', 'error');
    const [pr, cl, em, cu, payOpts] = await Promise.all([G('/products'), G('/customers').catch(() => []), G('/employees').catch(() => []), G('/shifts/current').catch(() => null), linkedPayMethods()]);
    const ps = (pr || []).filter(p => p.category != 'CARBURANT' && p.active !== false && p.active !== 0);
    if (!ps.length) return toast('Aucun produit hors carburant disponible', 'error');
    const team = cu && Array.isArray(cu.team) ? cu.team : [];
    const emps = team.length ? team.map(t => ({ id: t.id, name: t.name })) : (em || []).map(e => ({ id: e.id, name: e.first_name + ' ' + e.last_name }));
    const meEmp = (em || []).find(e => e.user_id && ME && Number(e.user_id) === Number(ME.id));
    const defEmp = (meEmp && emps.some(x => Number(x.id) === Number(meEmp.id))) ? meEmp.id : (emps[0] && emps[0].id);
    const cur_ = typeof CUR !== 'undefined' ? CUR : 'FCFA', fm = typeof f === 'function' ? f : (v => String(v));
    modal(`<div class="sp">
      <div class="sp-head"><div class="sp-ico" aria-hidden="true">🛒</div>
        <div class="sp-ttl"><h3>Enregistrer une vente de produit</h3><p>Boutique, lubrifiants et autres produits. La recette est rattachée à l’employé choisi dans l’historique du quart.</p></div>
        ${cu ? `<span class="sp-shift">◷ Quart n° ${escLocal(cu.number)} en cours</span>` : ''}</div>
      <div class="sp-grid">
        <div class="sp-main">
          <div class="g">
            <label>Produit<select id="pp">${ps.map(p => `<option value="${Number(p.id)}" data-price="${Number(p.sell_price) || 0}" data-stock="${Number(p.stock) || 0}">${escLocal(p.name)}</option>`).join('')}</select></label>
            <label>Quantité<input id="pq" type="number" step="any" min="0" value="1"></label>
            <label>Employé (participant du quart)<select id="pe">${emps.map(e => `<option value="${Number(e.id)}"${Number(e.id) === Number(defEmp) ? ' selected' : ''}>${escLocal(e.name)}</option>`).join('')}</select></label>
            <label>Client (si crédit)<select id="pc"><option value="">Aucun</option>${(cl || []).map(c => `<option value="${c.id}">${escLocal(c.name)}</option>`).join('')}</select></label>
            <label style="display:none">Paiement<select id="ppay">${payOpts.filter(o => o[2] !== false).map(([c, l]) => `<option value="${escLocal(c)}">${escLocal(l)}</option>`).join('')}</select></label>
          </div>
          <div class="sp-pay"><div class="sp-paytitle">Mode de paiement</div>
            <div class="sp-paybtns" id="ppb" role="group" aria-label="Mode de paiement">${payBtnsHtml(payOpts)}</div></div>
        </div>
        <aside class="sp-sum" aria-live="polite"><div class="sp-sum-head">Récapitulatif</div><div class="sp-sum-body">
          <div class="sp-line"><span>Produit</span><strong id="pr_n">—</strong></div>
          <div class="sp-line"><span>Quantité</span><strong id="pr_q">0</strong></div>
          <div class="sp-line"><span>Prix unitaire</span><strong id="pr_p">—</strong></div>
          <div class="sp-line"><span>Stock après vente</span><strong id="pr_s">—</strong></div>
          <div class="sp-total"><span>Total à encaisser</span><strong id="pr_t">0 ${cur_}</strong></div>
          <div class="sp-ready" id="pr_ok" data-ok="0">Saisie à compléter</div></div></aside>
      </div>
      <div class="r sp-actions"><button type="button" class="b2 b-orange" onclick="closeM()">✕ Annuler</button><button type="button" id="pok" class="sp-save">✓ Enregistrer la vente</button></div></div>`);
    const $$ = id => document.getElementById(id);
    function calcP() {
      const o = $$('pp').selectedOptions[0], price = Number(o.dataset.price) || 0, stock = Number(o.dataset.stock) || 0, q = Number($$('pq').value) || 0, tot = Math.round(q * price * 100) / 100;
      $$('pr_n').textContent = o.textContent; $$('pr_q').textContent = String(q); $$('pr_p').textContent = fm(price); $$('pr_s').textContent = String(Math.round((stock - q) * 1000) / 1000); $$('pr_t').textContent = fm(tot);
      const ok = q > 0 && price > 0 && stock - q >= 0; $$('pr_ok').dataset.ok = ok ? '1' : '0'; $$('pr_ok').textContent = ok ? '✓ Transaction prête' : (q > 0 && stock - q < 0 ? 'Stock insuffisant' : 'Saisie à compléter');
      return { price, tot, q };
    }
    function syncP() { const v = $$('ppay').value; document.querySelectorAll('#ppb .pay').forEach(b => { const on = b.dataset.c === v; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
    document.querySelectorAll('#ppb .pay').forEach(b => { b.onclick = () => { $$('ppay').value = b.dataset.c; syncP(); }; });
    $$('pp').onchange = calcP; $$('pq').oninput = calcP; calcP();
    $$('pok').onclick = async () => {
      const { tot, q } = calcP(), btn = $$('pok');
      if (!(q > 0)) return toast('Saisissez une quantité', 'error');
      if ($$('ppay').value === 'credit' && !$$('pc').value) return toast('Client requis pour un paiement à crédit', 'error');
      btn.disabled = true;
      try {
        await Po('/sales', { items: [{ product_id: Number($$('pp').value), quantity: q }], payments: [{ method: $$('ppay').value, amount: tot }], customer_id: $$('pc').value ? Number($$('pc').value) : undefined, employee_id: $$('pe').value ? Number($$('pe').value) : undefined });
        closeM(); toast('Vente produit enregistrée', 'success'); if (typeof go === 'function') go(typeof cur !== 'undefined' && cur === 'quart' ? 'quart' : 'ventes');
      } catch (e) { btn.disabled = false; toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || 'Erreur'), 'error'); }
    };
  };

  /** Choix type de vente — conserve le sélecteur Produit / Carburant */
  window.addS = async function addSShift() {
    if (typeof can === 'function' && !can('sale.create')) return toast('Permission vente refusée', 'error');
    modal(`<h3>Nouvelle vente</h3>
      <p style="color:var(--m);font-size:13px">Choisissez le type de vente. Les ventes carburant sont liées à la pompe et à l’employé du quart.</p>
      <div class="cards" style="grid-template-columns:1fr 1fr;gap:12px;margin:16px 0">
        <button type="button" class="card" style="cursor:pointer;text-align:center;padding:20px 12px" id="vs-prod">
          <div style="font-size:28px;margin-bottom:6px">🛒</div>
          <b>Produit</b>
          <div style="font-size:12px;color:var(--m);margin-top:4px">Boutique, lubrifiants…</div>
        </button>
        <button type="button" class="card" style="cursor:pointer;text-align:center;padding:20px 12px" id="vs-fuel">
          <div style="font-size:28px;margin-bottom:6px">⛽</div>
          <b>Carburant</b>
          <div style="font-size:12px;color:var(--m);margin-top:4px">Pompe, index, litres ou montant</div>
        </button>
      </div>
      <div class="r"><button class="b2" onclick="closeM()">Annuler</button></div>`);
    document.getElementById('vs-prod').onclick = () => { closeM(); if (typeof addProductSale === 'function') addProductSale(); };
    document.getElementById('vs-fuel').onclick = () => { closeM(); window.addFuel(); };
  };
})();
