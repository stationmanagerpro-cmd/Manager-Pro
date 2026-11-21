#!/usr/bin/env python3
"""Vérification INDÉPENDANTE de src/qr_encoder.js : génère des QR avec le code du projet, les rend en image
(échelle 8, marge 4) et les décode avec OpenCV (cv2.QRCodeDetector). Usage : python3 scripts/dev/verify-qr-opencv.py
Sortie : une ligne par cas + « N/N décodés ». Code retour 1 si un cas échoue. Aucune dépendance Node externe."""
import json, subprocess, sys, os
import numpy as np, cv2
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
cases = []
import random
random.seed(7)
alpha = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
for ecl in 'LMQH':
    for n in (1, 5, 12, 20, 37, 60, 90):
        cases.append({'ecl': ecl, 'text': ''.join(random.choice(alpha) for _ in range(n))})
cases.append({'ecl': 'M', 'text': 'SMP1:Station accentuée é è à — ✓'})
cases.append({'ecl': 'M', 'text': 'SMP1:' + 'A' * 150})
js = "const q=require(process.argv[1]+'/src/qr_encoder.js');const c=JSON.parse(process.argv[2]);" \
     "console.log(JSON.stringify(c.map(x=>{const r=q.encode(x.text,{ecl:x.ecl});return {v:r.version,size:r.size,rows:r.modules.map(row=>row.map(b=>b?1:0).join(''))}})))"
out = subprocess.check_output(['node', '-e', js, root, json.dumps(cases)])
res = json.loads(out)
det = cv2.QRCodeDetector(); ok = 0
for c, r in zip(cases, res):
    m = np.array([[int(ch) for ch in row] for row in r['rows']], dtype=np.uint8)
    img = np.where(m == 1, 0, 255).astype(np.uint8)
    img = np.pad(img, 4, constant_values=255)
    img = cv2.resize(img, None, fx=8, fy=8, interpolation=cv2.INTER_NEAREST)
    txt, pts, _ = det.detectAndDecode(img)
    good = (txt == c['text'])
    ok += good
    print(('OK  ' if good else 'FAIL') + f" v{r['v']:<2} {c['ecl']} {len(c['text'].encode()):>3} octets")
print(f'{ok}/{len(cases)} décodés par OpenCV {cv2.__version__}')
sys.exit(0 if ok == len(cases) else 1)
