#!/usr/bin/env python3
"""Vérification INDÉPENDANTE de public/qr-decoder.js : QR générés par OpenCV (cv2.QRCodeEncoder), décodés par le
décodeur du projet (via Node). Usage : python3 scripts/dev/verify-qr-decoder-opencv.py"""
import json, subprocess, os, sys, random
import numpy as np, cv2
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
random.seed(3); alpha = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
texts = ['SMP1:' + ''.join(random.choice(alpha) for _ in range(32)) for _ in range(6)] + ['SMP1:court', 'x' * 60]
imgs = []
for t in texts:
    p = cv2.QRCodeEncoder_Params(); p.correction_level = cv2.QRCodeEncoder_CORRECT_LEVEL_M
    q = cv2.QRCodeEncoder.create(p).encode(t)
    q = cv2.copyMakeBorder(q, 24, 24, 24, 24, cv2.BORDER_CONSTANT, value=255)
    q = cv2.resize(q, None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)
    imgs.append(q)
payload = [{'w': int(i.shape[1]), 'h': int(i.shape[0]), 'data': i.flatten().tolist()} for i in imgs]
js = "const d=require(process.argv[1]+'/public/qr-decoder.js');const a=JSON.parse(require('fs').readFileSync(0,'utf8'));" \
     "console.log(JSON.stringify(a.map(x=>d.decodeGray(Uint8Array.from(x.data),x.w,x.h))))"
out = subprocess.run(['node', '-e', js, root], input=json.dumps(payload).encode(), capture_output=True, check=True).stdout
res = json.loads(out); ok = 0
for t, r in zip(texts, res):
    good = (r == t); ok += good; print(('OK  ' if good else 'FAIL') + f' {len(t)} octets')
print(f'{ok}/{len(texts)} QR générés par OpenCV {cv2.__version__} décodés par public/qr-decoder.js')
sys.exit(0 if ok == len(texts) else 1)
