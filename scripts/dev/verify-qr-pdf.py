#!/usr/bin/env python3
"""Vérifie les PDF d'étiquettes : structure (qpdf --check), rendu (pdftoppm 200 dpi) et lecture de CHAQUE QR par OpenCV, comparée aux jetons attendus.
Usage : python3 scripts/dev/verify-qr-pdf.py [dossier_sortie_pdf]. Ne prouve PAS la lisibilité sur une impression papier réelle (essai à faire sur site)."""
import subprocess, sys, os, json, glob, tempfile
import cv2, numpy as np
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
out = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else tempfile.mkdtemp()
subprocess.check_call(['node', os.path.join(root, 'scripts/dev/make-qr-test-pdfs.js'), out])
exp = json.load(open(os.path.join(out, 'qr-test-jetons.json'))); res = []
def chk(n, ok): res.append(ok); print(('✓ ' if ok else '✗ ') + n)
for f in ('qr-test-planche-A4.pdf', 'qr-test-etiquette-A5.pdf'):
    p = os.path.join(out, f); r = subprocess.run(['qpdf', '--check', p], capture_output=True, text=True)
    chk(f + ' : structure PDF valide (qpdf --check)', r.returncode == 0 and 'No syntax or stream encoding errors' in r.stdout)
tmp = tempfile.mkdtemp(); pre = os.path.join(tmp, 'p')
subprocess.check_call(['pdftoppm', '-r', '200', '-png', os.path.join(out, 'qr-test-planche-A4.pdf'), pre])
pages = sorted(glob.glob(pre + '*.png')); chk('Planche A4 : %d page(s) pour 8 étiquettes (6 par page)' % len(pages), len(pages) == 2)
det = cv2.QRCodeDetector(); found = []
for pg in pages:
    img = cv2.imread(pg); h, w = img.shape[:2]
    for row in range(3):          # 3 lignes × 2 colonnes, découpées comme sur la planche
        for col in range(2):
            y0 = int(h * (0.04 + 0.066 + row * 0.3)); y1 = int(y0 + h * 0.29); x0 = int(w * col * 0.5); x1 = int(x0 + w * 0.5)
            txt = det.detectAndDecode(img[y0:y1, x0:x1])[0]
            if txt: found.append(txt)
chk('Planche A4 : les 8 QR sont lus par OpenCV et correspondent exactement aux jetons', sorted(found) == sorted(exp))
subprocess.check_call(['pdftoppm', '-r', '200', '-png', os.path.join(out, 'qr-test-etiquette-A5.pdf'), os.path.join(tmp, 's')])
s = cv2.imread(glob.glob(os.path.join(tmp, 's*.png'))[0]); chk('Étiquette A5 : le QR est lu et correspond au premier jeton', det.detectAndDecode(s)[0] == exp[0])
txt = subprocess.run(['pdftotext', os.path.join(out, 'qr-test-planche-A4.pdf'), '-'], capture_output=True, text=True).stdout
chk('Textes imprimés : station, pompe, produit, référence courte', all(k in txt for k in ('STATION DE TEST', 'Pompe 1 - Compteur 1', 'Gasoil', 'Réf.')) and 'SMP1:' not in txt)
print('%d/%d contrôles réussis.' % (sum(res), len(res))); sys.exit(0 if all(res) else 1)
