'use strict';
// Garde-fou « tout est relié » : (1) chaque appel d'API du front a une vraie route serveur ; (2) chaque route serveur est appelée par un écran,
// sauf celles listées EXTERNES (pages publiques, application Android, terminal carte, santé). Toute nouvelle route sans écran fait échouer ce test.
const fs=require('fs'),path=require('path');process.chdir(path.join(__dirname,'..'));const read=f=>fs.readFileSync(f,'utf8');
const server=read('src/server.js');
const mounts={auth:['']};
for(const m of server.matchAll(/app\.use\(\s*'\/api([^']*)'\s*,\s*(?:\w+,\s*)*require\('\.\/([\w-]+)'\)(?:\.(\w+))?/g)){(mounts[m[2]]=mounts[m[2]]||[]).push(m[1])}
// routes déclarées directement dans server.js
const routes=[];
const add=(m,p,f)=>routes.push({m:m.toUpperCase(),p,f});
for(const f of fs.readdirSync('src').filter(x=>x.endsWith('.js'))){const base=f.slice(0,-3);const s=read('src/'+f);
  const prefs=f==='server.js'?['']:(mounts[base]||[]);
  if(f!=='server.js'&&!prefs.length)continue;
  // normalise multi-ligne
  for(const m of s.matchAll(/\b\w+\.(get|post|put|patch|delete|all)\(\s*(['"`])(\/[^'"`]*)\2/g))for(const pf of prefs)add(m[1]==='all'?'ANY':m[1],pf+m[3],f);
  for(const m of s.matchAll(/\b\w+\.(get|post|put|patch|delete)\(\s*\[([^\]]+)\]/g))for(const q of m[2].matchAll(/['"`](\/[^'"`]*)['"`]/g))for(const pf of prefs)add(m[1],pf+q[1],f);
}
for(const m of server.matchAll(/app\.(get|post|put|patch|delete)\(\s*'\/api([^']*)'/g))add(m[1],m[2],'server.js');
const norm=p=>p.split('?')[0].replace(/\$\{[^}]*\}/g,':x').replace(/\/:[A-Za-z_]+(\([^)]*\))?\??/g,'/:x').replace(/\/+$/,'')||'/';
add('post','/auth/login','auth.js');   // pub (monté sous /auth)
routes.forEach(r=>r.n=norm(r.p));
const pub=fs.readdirSync('public').filter(f=>/\.js$/.test(f)&&f!=='sw.js').map(f=>'public/'+f);
const calls=[];
for(const f of pub){const s=read(f);
  for(const m of s.matchAll(/\b(G|Po|Pu|Pa|Dl|api)\(\s*(?:'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*)?(['"`])(\/[^'"`]*)\3/g)){
    const meth={G:'GET',Po:'POST',Pu:'PUT',Pa:'PATCH',Dl:'DELETE'}[m[1]]||m[2];if(!meth)continue;
    let p=m[4];const trunc=/[/=?&]$/.test(p)&&m[3]!=='`'; calls.push({m:meth,p,n:norm(p),f,trunc});}
  for(const m of s.matchAll(/fetch\(\s*(['"`])\/api(\/[^'"`]*)\1/g))calls.push({m:'ANY',p:m[2],n:norm(m[2]),f});
}
const same=(c,r)=>{const a=c.n.split('/'),b=r.n.split('/');
  const okSeg=(x,y)=>x===y||x===':x'||y===':x';
  if(c.trunc||/\/$/.test(c.p)){ // appel avec suffixe concaténé : préfixe commun suffisant
    if(a.length>b.length)return false; return a.slice(0,a.length).every((x,i)=>okSeg(x,b[i]))&&(c.m==='ANY'||r.m==='ANY'||c.m===r.m);}
  return a.length===b.length&&a.every((x,i)=>okSeg(x,b[i]))&&(c.m==='ANY'||r.m==='ANY'||c.m===r.m);};

const IGNORE_CALL=[/^POST \/$/];   // appels à chemin entièrement dynamique (ex. Po('/' + kind + ...))
const orphan=calls.filter(c=>!routes.some(r=>same(c,r))&&!IGNORE_CALL.some(x=>x.test(c.m+' '+c.p)));
const allFront=pub.map(read).join('\n');
const EXTERNAL=[/^\/(public|branding|manifest|logo|favicon|login-bg|banner|home|access|c\/)/,/^\/(api\/)?health$/,/^\/superadmin$/,/^\/mobile\/alerts/,/^\/fleet\/authorize/,/^\/me\/advertising\/images/,/^\/admin\/access-keys/];
const unlinked=routes.filter(r=>!calls.some(c=>same(c,r))).filter(r=>{
  if(EXTERNAL.some(x=>x.test(r.p)))return false;
  const key=r.p.replace(/\/:[A-Za-z]+/g,'').split('/').slice(-2).join('/');   // appel construit dynamiquement : on cherche la fin du chemin dans le code du front
  return !allFront.includes(key);
});
let bad=0;
if(orphan.length){bad++;console.error('✘ Appels du front sans route serveur :');orphan.forEach(c=>console.error('   ',c.m,c.p,'←',c.f));}
const KNOWN_NO_SCREEN=new Set(['PUT /pumps/:pumpId/counters/:n','GET /admin/licenses/duration-presets','GET /exports/:kind/preferences','PUT /exports/:kind/preferences','GET /money/accounts/:id/movements','POST /messaging/messages/:id/read','POST /messaging/messages/:id/archive']);
const fresh=unlinked.filter(r=>!KNOWN_NO_SCREEN.has(r.m+' '+r.p));
if(fresh.length){bad++;console.error('✘ Routes serveur sans écran (ni exception documentée) :');fresh.forEach(r=>console.error('   ',r.m,r.p,'['+r.f+']'));}
if(bad){process.exit(1);}
console.log('✓ links-audit : '+calls.length+' appels front reliés à '+routes.length+' routes ; '+KNOWN_NO_SCREEN.size+' routes sans écran documentées (API seule)');
