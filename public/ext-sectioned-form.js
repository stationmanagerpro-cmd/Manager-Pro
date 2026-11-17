/* Formulaire sectionné (Super Admin) : en-tête, bande de licence, sections en grille, pied d’actions.
   Même contrat que form() : champs [clé, libellé, type, options], valeurs par défaut, rappel de validation.
   Les champs gardent leurs identifiants f_<clé> : la logique de soumission existante reste inchangée.
   Type 'sw' : interrupteur Actif / Inactif ; la valeur reste dans un champ caché f_<clé> ('true' / 'false').
   L’interrupteur d’en-tête d’une section agit sur toutes les cases 'sw' de cette section. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const sv = v => (typeof esc === 'function' ? esc(v == null ? '' : String(v)) : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  function injectStyle() {
    if (document.getElementById('sf-style')) return;
    const s = document.createElement('style'); s.id = 'sf-style';
    s.textContent = `
.sf{width:min(1120px,96vw);max-width:96vw;text-align:left;color:var(--fg,#0f172a);background:var(--c,#fff);border-radius:20px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(8,20,50,.55)}
.sf-head{display:flex;align-items:center;gap:12px;padding:18px 22px;background:linear-gradient(135deg,#081432,#1e3a8a 60%,#2563EB);color:#fff}
.sf-head h3{margin:0;font-size:18px;color:#fff}
.sf-ico{width:38px;height:38px;border-radius:12px;background:rgba(255,255,255,.16);display:inline-flex;align-items:center;justify-content:center;font-size:20px}
.sf-band{margin:0;padding:14px 22px;background:rgba(37,99,235,.07);border-bottom:1px solid rgba(127,127,127,.18);display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:space-between;font-size:13px}
.sf-band .sf-meta{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}
.sf-band .sf-meta b{font-weight:700}
.sf-band .sf-acts{display:flex;flex-wrap:wrap;gap:6px}
.sf-band .sf-acts button{font-size:12px;padding:6px 10px}
.sf-band .sf-acts button.bd{background:#BD3F0D;color:#fff;border-color:#BD3F0D}
.sf-body{max-height:64vh;overflow-y:auto;padding:6px 22px 16px}
.sf-sec{margin-top:16px}
.sf-sh{margin:0 0 10px;padding:8px 12px;border-radius:10px;font-size:12.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#1e3a8a;background:rgba(37,99,235,.09);border-left:3px solid #2563EB}
.sf-shrow{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 10px}
.sf-shrow .sf-sh{margin:0;flex:1 1 auto;min-width:0}
.sf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.sf-grid label{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600;color:var(--m,#475569);margin:0}
.sf-grid input,.sf-grid select{width:100%;box-sizing:border-box;font-size:13.5px;font-weight:500;color:var(--fg,#0f172a);padding:9px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.35);background:var(--c,#fff)}
.sf-grid input:focus,.sf-grid select:focus{outline:2px solid rgba(37,99,235,.35);border-color:#2563EB}
.sf-fsw{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600;color:var(--m,#475569);min-width:0}
.sf-sw{display:inline-flex;border-radius:6px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.18);flex-shrink:0;align-self:flex-start}
.sf-seg{border:0;margin:0;padding:7px 12px;min-width:74px;font-size:12.5px;font-weight:600;font-family:inherit;line-height:1;color:#fff;border-radius:0;cursor:pointer;transition:opacity .15s,filter .15s}
.sf-seg.sf-on{background:#5e9e3a}
.sf-seg.sf-off{background:#e11d1d;font-style:italic}
.sf-seg.sel{opacity:1}
.sf-seg.dim{opacity:.4}
.sf-seg:disabled{cursor:default}
.sf-seg:not(:disabled):hover{filter:brightness(1.1)}
.sf-seg:focus-visible{outline:2px solid #1d4ed8;outline-offset:1px}
.sf-gbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:rgba(37,99,235,.08);border-left:4px solid #2563EB;border-radius:10px;padding:12px 14px;margin:0 22px 12px}
.sf-foot{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:14px 22px;border-top:1px solid rgba(127,127,127,.2);background:var(--c,#fff)}
.sf-foot button{font-size:13px}
.sf-foot #ok{background:#2563EB;color:#fff}
.sf-hint{font-size:12px;color:var(--m,#64748b);margin:0 0 8px}
@media (max-width:640px){.sf-grid{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }

  /* Interrupteur Actif / Inactif relié aux champs cachés f_<clé> listés dans keys. */
  function swHtml(keys) {
    return `<span class="sf-sw" role="group" data-keys="${sv(keys.join(','))}"><button type="button" class="sf-seg sf-on dim" data-val="true">Actif</button><button type="button" class="sf-seg sf-off dim" data-val="false">Inactif</button></span>`;
  }

  /* Recalcule l’affichage de chaque interrupteur à partir des champs cachés.
     Tout actif : Actif sélectionné. Tout inactif : Inactif sélectionné. Mixte : les deux restent cliquables. */
  function sfSync(root) {
    (root || document).querySelectorAll('.sf-sw').forEach(sw => {
      const keys = (sw.dataset.keys || '').split(',').filter(Boolean);
      const vals = keys.map(k => { const el = document.getElementById('f_' + k); return !!el && el.value === 'true'; });
      const allOn = vals.length > 0 && vals.every(Boolean);
      const allOff = vals.length > 0 && vals.every(v => !v);
      const mixed = !allOn && !allOff;
      sw.querySelectorAll('.sf-seg').forEach(b => {
        const isOn = b.dataset.val === 'true';
        const sel = (allOn && isOn) || (allOff && !isOn);
        b.classList.toggle('sel', sel);
        b.classList.toggle('dim', !sel && !mixed);
        b.disabled = sel;
        b.setAttribute('aria-pressed', String(sel));
      });
    });
  }
  window.sfSync = sfSync;
  window.sfSwitchHtml = swHtml;

  document.addEventListener('click', function (e) {
    const b = e.target && e.target.closest ? e.target.closest('.sf-sw .sf-seg') : null;
    if (!b || b.disabled) return;
    const sw = b.closest('.sf-sw');
    const val = b.dataset.val;
    (sw.dataset.keys || '').split(',').filter(Boolean).forEach(k => {
      const el = document.getElementById('f_' + k);
      if (el) el.value = val;
    });
    sfSync();
    try { if (typeof updateAuthSummary === 'function') updateAuthSummary(); } catch (_) {}
  });

  function fieldHtml([k, l, ty, o], v) {
    const val = v[k] == null ? '' : v[k];
    if (ty === 'sw') {
      const on = String(val) === 'true';
      return `<div class="sf-fsw" data-fkey="${sv(k)}"><span>${l}</span>${swHtml([k])}<input type="hidden" id="f_${k}" value="${on ? 'true' : 'false'}"></div>`;
    }
    if (ty === 's') {
      return `<label data-fkey="${sv(k)}">${l}<select id="f_${k}">${(o || []).map(x => { const a = Array.isArray(x) ? x : [x, x]; return `<option value="${sv(a[0])}" ${String(a[0]) === String(val) ? 'selected' : ''}>${sv(a[1])}</option>`; }).join('')}</select></label>`;
    }
    const type = ty === 'number' ? 'number' : ty === 'date' ? 'date' : ty === 'password' ? 'password' : 'text';
    const ac = ty === 'password' ? ' autocomplete="new-password"' : ' autocomplete="off"';
    return `<label data-fkey="${sv(k)}">${l}<input id="f_${k}" type="${type}"${ac} value="${sv(val)}"></label>`;
  }

  /**
   * @param {string} title
   * @param {Array} fields  liste plate [clé, libellé, type, options] (identique à form())
   * @param {Object} values valeurs par défaut
   * @param {Function} ok   rappel reçu avec les valeurs saisies
   * @param {Object} opts   { sections:[{title, keys[]}], band:'html', icon:'🤝', hint:'texte' }
   */
  window.sectionedForm = function (title, fields, values, ok, opts) {
    injectStyle();
    opts = opts || {};
    const v = values || {};
    const byKey = Object.fromEntries(fields.map(f => [f[0], f]));
    const used = new Set();
    const sections = (opts.sections || []).map(sec => {
      const keys = sec.keys.filter(k => byKey[k]);
      keys.forEach(k => used.add(k));
      return keys.length ? { title: sec.title, fields: keys.map(k => byKey[k]) } : null;
    }).filter(Boolean);
    const rest = fields.filter(f => !used.has(f[0]));
    if (rest.length) sections.push({ title: 'Autres informations', fields: rest });
    const packBar = (typeof authPacksExtraHtml === 'function' && /licence|contrat|client|autorisation/i.test(String(title))) ? (() => { try { return authPacksExtraHtml(); } catch (_) { return ''; } })() : '';
    const body = sections.map(sec => {
      const swKeys = sec.fields.filter(f => f[2] === 'sw').map(f => f[0]);
      const head = `<div class="sf-shrow"><h4 class="sf-sh">${sv(sec.title)}</h4>${swKeys.length ? swHtml(swKeys) : ''}</div>`;
      return `<section class="sf-sec">${head}<div class="sf-grid">${sec.fields.map(f => fieldHtml(f, v)).join('')}</div></section>`;
    }).join('');
    modal(`<div class="sf"><header class="sf-head"><span class="sf-ico" aria-hidden="true">${sv(opts.icon || '🤝')}</span><div><h3>${sv(title)}</h3>${opts.hint ? `<div style="font-size:12.5px;opacity:.85;margin-top:2px">${sv(opts.hint)}</div>` : ''}</div></header>${opts.band || ''}${packBar}<div class="sf-body">${body}</div><footer class="sf-foot"><button class="b2" id="sf-reset" type="button">↺ Initialiser</button><button class="b2" type="button" onclick="closeM()">Annuler</button><button id="ok" type="button">✓ Enregistrer</button></footer></div>`);
    // Le conteneur de la modale est élargi : le formulaire sectionné porte sa propre mise en forme.
    const box = document.querySelector('#m > div');
    if (box) { box.style.maxWidth = '96vw'; box.style.width = 'auto'; box.style.background = 'transparent'; box.style.boxShadow = 'none'; box.style.padding = '0'; box.style.overflow = 'visible'; }
    try { if (typeof updateAuthSummary === 'function') setTimeout(updateAuthSummary, 50); } catch (_) {}
    sfSync();
    setTimeout(sfSync, 0);
    const reset = document.getElementById('sf-reset');
    if (reset) reset.onclick = () => {
      fields.forEach(([k, , ty]) => {
        const el = document.getElementById('f_' + k); if (!el) return;
        el.value = ty === 'sw' ? (String(v[k]) === 'true' ? 'true' : 'false') : (v[k] == null ? '' : v[k]);
      });
      sfSync();
    };
    const okBtn = document.getElementById('ok');
    if (okBtn) okBtn.onclick = async () => {
      okBtn.disabled = true;
      try {
        const d = {};
        for (const [k, , ty] of fields) { const el = document.getElementById('f_' + k); const x = el ? el.value : ''; d[k] = ty === 'number' ? (parseFloat(x) || 0) : x; }
        await ok(d);
      } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message); }
      okBtn.disabled = false;
    };
  };
})();
