#!/usr/bin/env python3
"""Vérifie public/ext-qr-scan.js + public/qr-decoder.js dans un VRAI Chromium avec une caméra simulée (flux vidéo = image d'une étiquette PDF).
Ce que cela prouve : getUserMedia, lecture QR (repli SMPQr si pas de BarcodeDetector), préremplissage/verrouillage du formulaire, envoi de qr_scan_id
(jamais de valeurs décidées par le navigateur), libération de la caméra, refus d'autorisation caméra. Ce que cela ne prouve PAS : un téléphone réel,
l'application Android, l'impression papier. Usage : verify-qr-scanner-browser.py <etiquette.png> <repertoire_public> """
import sys, os, subprocess, tempfile, json, threading, http.server, functools
import cv2
from playwright.sync_api import sync_playwright
png, pub = sys.argv[1], sys.argv[2]
exp = cv2.QRCodeDetector().detectAndDecode(cv2.imread(png))[0]
assert exp.startswith('SMP1:'), 'étiquette de référence illisible'
tmp = tempfile.mkdtemp(); y4m = os.path.join(tmp, 'cam.y4m')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-t', '2', '-r', '10', '-vf', 'scale=-2:480,pad=640:480:(ow-iw)/2:0:white,format=yuv420p', y4m], check=True)
fixture = '''<!doctype html><meta charset=utf-8><body><div id=modal></div><script>
window.CALLS=[];window.TOASTS=[];var V={},VM={},NAV_ICONS={};var TK='t',SID='1';
function modal(h){document.getElementById('modal').innerHTML='<div class=mm>'+h+'</div>'}function closeM(){document.getElementById('modal').innerHTML=''}
function toast(m,k){TOASTS.push([m,k])}function can(){return true}function esc(s){return String(s)}function T(h,r){return '<table>'+r.map(x=>'<tr>'+x.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table>'}
async function api(m,p,b){CALLS.push([m,p,b]);if(p==='/sales/scan-pump'){if(window.FAIL)throw Object.assign(new Error('Ce QR Code a été désactivé.'),{status:409,details:{code:'QR_REVOKED'}});
 return {scan_id:77,expires_at:'2999-01-01',pump:{id:2,number:2,name:'Pompe 2'},counter:{id:21,counter_number:1},product:{id:5,name:'Gasoil'},employee:{id:9,name:'Mamadou'},shift:{id:1,status:'open'},can_record_sale:true}}return {}}
window.SALE=[];window.smpFuelSale=async function(b){SALE.push(JSON.parse(JSON.stringify(b)));return{}};
window.addFuel=async function(){modal('<div class=sp><div class=sp-ttl>x</div><div class=tabs id=fm></div><div class=sp-grid><select id=fs_pump><option value=1>P1</option><option value=2>P2</option></select><select id=fc></select><input id=fs_emp_label><select id=fs_emp_sel></select><input id=fe></div></div>');
 var s=document.getElementById('fs_pump'),c=document.getElementById('fc');s.onchange=function(){c.innerHTML=s.value==='2'?'<option value=21>C1</option><option value=22>C2</option>':'<option value=11>C1</option>'};s.onchange();c.onchange=function(){}};
</script><script src="/qr-decoder.js"></script><script src="/ext-qr-scan.js"></script>'''
open(os.path.join(tmp, 'fx.html'), 'w').write(fixture)
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def translate_path(self, p):
        p = p.split('?')[0]
        return os.path.join(tmp, 'fx.html') if p == '/fx.html' else os.path.join(pub, p.lstrip('/'))
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
url = 'http://127.0.0.1:%d/fx.html' % srv.server_address[1]
res = []
def check(n, ok, extra=''):
    res.append(ok); print(('✓ ' if ok else '✗ ') + n + (' — ' + str(extra) if extra and not ok else ''))
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + y4m])
    ctx = b.new_context(permissions=['camera'], viewport={'width': 420, 'height': 800}); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto(url)
    check('Le bouton « Scanner une pompe » est ajouté au formulaire de vente', (pg.evaluate("addFuel().then(()=>!!document.getElementById('qr_scan_btn'))")))
    bd = pg.evaluate("typeof BarcodeDetector")
    print('  (BarcodeDetector :', bd, ')')
    pg.evaluate("()=>{window.__streams=[];var o=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async function(c){var s=await o(c);window.__streams.push(s);return s}}")
    pg.click('#qr_scan_btn')
    pg.wait_for_function("window.CALLS.length>0", timeout=20000)
    call = pg.evaluate("CALLS[0]")
    check('Le QR de l’étiquette est lu par la caméra et envoyé au serveur tel quel', call[1] == '/sales/scan-pump' and call[2].get('code') == exp, call)
    check('Aucune vente envoyée par le scan', pg.evaluate("SALE.length") == 0)
    pg.wait_for_timeout(300)
    check('Formulaire prérempli : pompe 2, compteur 21, employé du compte, champs verrouillés', pg.evaluate("[fs_pump.value,fc.value,fe.value,fs_pump.disabled,fc.disabled,fs_emp_label.value.indexOf('Mamadou')>=0].join()") == '2,21,9,true,true,true')
    live = pg.evaluate("(()=>{var v=document.getElementById('qrs_video');return !!v})()")
    check('Scanner fermé après lecture', live is False)
    pg.evaluate("window.smpFuelSale({counter_id:999,employee_id:1,liters:10})")
    sale = pg.evaluate("SALE[0]")
    check('La vente transporte qr_scan_id (le serveur impose pompe/employé)', sale.get('qr_scan_id') == 77, sale)
    pg.click('#qr_unlock')
    pg.evaluate("window.smpFuelSale({counter_id:11,liters:5})")
    check('Après « Annuler le scan » : plus de qr_scan_id, formulaire déverrouillé', pg.evaluate("SALE[1].qr_scan_id") is None and pg.evaluate("!fs_pump.disabled"))
    check('Caméra libérée après lecture (toutes les pistes vidéo terminées)', pg.evaluate("__streams.length>=1 && __streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))"))
    # refus serveur : message du serveur, rien n'est prérempli
    pg.evaluate("addFuel()"); pg.wait_for_timeout(200); pg.evaluate("window.FAIL=true;CALLS.length=0"); pg.click('#qr_scan_btn'); pg.wait_for_function("CALLS.length>0", timeout=20000); pg.wait_for_timeout(300)
    check('QR refusé par le serveur : message affiché, formulaire non verrouillé', pg.evaluate("TOASTS[TOASTS.length-1][0]") == 'Ce QR Code a été désactivé.' and pg.evaluate("!fs_pump.disabled"))
    # saisie manuelle de la référence
    pg.evaluate("window.FAIL=false;addFuel();CALLS.length=0"); pg.wait_for_timeout(200)
    pg.evaluate("()=>{navigator.mediaDevices.getUserMedia=function(){return Promise.reject(Object.assign(new Error('x'),{name:'NotAllowedError'}))}}")
    pg.click('#qr_scan_btn'); pg.wait_for_selector('#qrs_msg'); pg.wait_for_timeout(300)
    check('Autorisation caméra refusée : message CAMERA_DENIED et solution de reprise', 'autorisation d’accès à la caméra a été refusée' in pg.inner_text('#qrs_msg'))
    pg.evaluate("document.querySelector('details').open=true"); pg.fill('#qrs_ref', '7f3k 9a2c'); pg.click('#qrs_refok'); pg.wait_for_function("CALLS.length>0")
    check('Saisie manuelle : référence envoyée au serveur (mêmes contrôles)', pg.evaluate("CALLS[0][2].short_ref") == '7f3k 9a2c')
    check('Aucune erreur JavaScript', not errs, errs)
    b.close()
print('%d/%d contrôles réussis.' % (sum(res), len(res))); sys.exit(0 if all(res) else 1)
