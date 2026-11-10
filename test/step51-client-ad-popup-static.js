'use strict';
const fs=require('fs'); const s=fs.readFileSync('public/ext-detail-pages.js','utf8');
const checks=[
 ['dialogue pop-up accessible',s.includes('role="dialog"')&&s.includes('aria-modal="true"')],
 ['fermeture disponible',s.includes('window.closeClientAd')],
 ['fond de pop-up fixe',s.includes('.client-ad-overlay{position:fixed')],
 ['rotation plusieurs images chaque minute',s.includes('setInterval(()=>window.clientAdMove(1),60000)')],
 ['réapparition multiple chaque minute',s.includes('imgs.length>1?60000:120000')],
 ['réapparition image unique chaque deux minutes',s.includes('imgs.length>1?60000:120000')],
 ['contenu textuel échappé',s.includes('escv(ad.title)')&&s.includes('escv(ad.text)')],
 ['image échappée',s.includes('escv(url)')]
]; let fail=0; for(const [n,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${n}`);if(!ok)fail++;} console.log(`${checks.length-fail}/${checks.length} checks passed`);process.exitCode=fail?1:0;
