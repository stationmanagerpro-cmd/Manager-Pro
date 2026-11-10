// Sauvegardes logiques isolées par client et sauvegarde distincte de la plateforme.
// Les archives de client ne contiennent jamais les lignes d'un autre client.
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, HttpError, wrap, audit } = require('./core');
const r = express.Router();
const ROOT = () => path.resolve(process.env.BACKUP_DIR || './backups');
const CLIENT_DIR = id => path.join(ROOT(), 'clients', `client-${Number(id)}`);
const PLATFORM_DIR = () => path.join(ROOT(), 'platform');
const NAME = /^smp-(client-\d+|platform)-\d{4}-\d{2}-\d{2}T[\dTZ-]+\.json\.gz$/;
const EXCLUDE = new Set(['user_sessions', 'backup_logs', 'schema_migrations', 'migrations', 'app_migrations', 'client_contracts', 'license_history', 'license_settings', 'subscription_packs']);
const PRESERVE_RESET = new Set(['clients','client_contracts','stations','users','roles','permissions','role_permissions','schema_migrations','migrations','app_migrations','app_settings','settings','licenses','client_licenses']);
const needGlobal = (req,res,next) => req.user?.is_global ? next() : next(new HttpError(403, 'Réservé au Super Admin.'));
async function verifyPassword(req, supplied) {
  const password = String(supplied || '');
  if (!password) throw new HttpError(400, 'Le mot de passe du Super Admin est requis.');
  const { rows:[u] } = await pool.query('SELECT password_hash,is_global,active FROM users WHERE id=$1 AND deleted_at IS NULL',[req.user.id]);
  if (!u || !u.is_global || !u.active || !(await bcrypt.compare(password,u.password_hash))) throw new HttpError(403,'Mot de passe Super Admin incorrect.');
}
const ident = s => '"' + String(s).replace(/"/g,'""') + '"';
async function schema(client) {
  const { rows: cols } = await client.query(`SELECT c.table_name,c.column_name,c.ordinal_position,c.is_nullable FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.table_schema='public' AND t.table_type='BASE TABLE' ORDER BY c.table_name,c.ordinal_position`);
  const { rows: pks } = await client.query(`SELECT tc.table_name,kcu.column_name,kcu.ordinal_position FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public' ORDER BY tc.table_name,kcu.ordinal_position`);
  const { rows: fks } = await client.query(`SELECT tc.table_name AS child,kcu.column_name AS child_col,ccu.table_name AS parent,ccu.column_name AS parent_col FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND ccu.table_schema='public'`);
  const tables = new Map();
  for (const c of cols) { if (!tables.has(c.table_name)) tables.set(c.table_name,{name:c.table_name,cols:[],pk:[],fks:[],nullable:new Set()}); tables.get(c.table_name).cols.push(c.column_name); if(c.is_nullable==='YES')tables.get(c.table_name).nullable.add(c.column_name); }
  for (const p of pks) tables.get(p.table_name)?.pk.push(p.column_name);
  for (const f of fks) if (tables.has(f.child)&&tables.has(f.parent)) tables.get(f.child).fks.push(f);
  return tables;
}
async function scopedRows(client, clientId, {platform=false}={}) {
  const tables = await schema(client), selected = new Map();
  const add = (name, rows) => { if (!rows.length) return false; if (!selected.has(name)) selected.set(name,new Map()); const dest=selected.get(name), t=tables.get(name); let changed=false; for(const row of rows){const key=JSON.stringify(t.pk.map(k=>row[k])); if(!dest.has(key)){dest.set(key,row);changed=true;}} return changed; };
  if (platform) {
    for (const name of ['users','roles','permissions','role_permissions','app_settings','settings']) {
      const t=tables.get(name); if(!t || !t.pk.length || EXCLUDE.has(name)) continue;
      let rows=[];
      if(name==='users') rows=(await client.query('SELECT * FROM public.users WHERE is_global=true')).rows;
      else if(['app_settings','settings'].includes(name) && t.cols.includes('client_id')) rows=(await client.query(`SELECT * FROM public.${ident(name)} WHERE client_id IS NULL`)).rows;
      else if(['app_settings','settings'].includes(name) && t.cols.includes('station_id')) rows=(await client.query(`SELECT * FROM public.${ident(name)} WHERE station_id IS NULL`)).rows;
      else if(name==='app_settings') rows=(await client.query('SELECT * FROM public.app_settings')).rows;
      else if(name==='roles') rows=(await client.query('SELECT r.* FROM public.roles r JOIN public.users u ON u.role_id=r.id WHERE u.is_global=true')).rows;
      else if(name==='permissions') rows=(await client.query('SELECT * FROM public.permissions')).rows;
      else if(name==='role_permissions') rows=(await client.query('SELECT rp.* FROM public.role_permissions rp JOIN public.roles r ON r.id=rp.role_id JOIN public.users u ON u.role_id=r.id WHERE u.is_global=true')).rows;
      add(name,rows);
    }
  } else {
    const c = (await client.query('SELECT * FROM public.clients WHERE id=$1',[clientId])).rows;
    if (!c.length) throw new HttpError(404,'Client introuvable.'); add('clients',c);
    for (const t of tables.values()) {
      if (EXCLUDE.has(t.name) || ['clients','users','stations'].includes(t.name)) continue;
      if ((t.cols.includes('client_id') || t.cols.includes('station_id')) && !t.pk.length) throw new HttpError(409, `Sauvegarde isolée refusée : la table ${t.name} n'a pas de clé primaire exploitable.`);
      if (!t.pk.length) continue;
      const cond=[]; const vals=[];
      if(t.cols.includes('client_id')) { vals.push(clientId); cond.push(`${ident('client_id')}=$${vals.length}`); }
      if(t.cols.includes('station_id')) { vals.push(clientId); cond.push(`${ident('station_id')} IN (SELECT id FROM public.stations WHERE client_id=$${vals.length})`); }
      if(cond.length) add(t.name,(await client.query(`SELECT * FROM public.${ident(t.name)} WHERE ${cond.join(' OR ')}`,vals)).rows);
    }
    const stations=(await client.query('SELECT * FROM public.stations WHERE client_id=$1',[clientId])).rows; add('stations',stations);
    const users=(await client.query('SELECT * FROM public.users WHERE client_id=$1 AND COALESCE(is_global,false)=false',[clientId])).rows; add('users',users);
    // Fermeture descendante des clés étrangères : ajoute les enfants des lignes déjà isolées.
    let changed=true, rounds=0;
    while(changed && rounds++<40){ changed=false;
      for(const [parent,rowsMap] of [...selected]){
        const pt=tables.get(parent); if(!pt?.pk || pt.pk.length!==1) continue;
        const ids=[...rowsMap.values()].map(x=>x[pt.pk[0]]).filter(x=>x!==null&&x!==undefined);
        if(!ids.length) continue;
        for(const child of tables.values()){
          if(EXCLUDE.has(child.name)) continue;
          if(child.fks.some(f=>f.parent===parent&&f.parent_col===pt.pk[0]) && !child.pk.length) throw new HttpError(409, `Sauvegarde isolée refusée : la table dépendante ${child.name} n'a pas de clé primaire exploitable.`);
          for(const fk of child.fks.filter(f=>f.parent===parent&&f.parent_col===pt.pk[0])){
            // Les sessions et tables globales sont volontairement exclues. La sélection par FK
            // ne peut s'étendre qu'à partir d'une ligne déjà appartenant au client.
            const rows=(await client.query(`SELECT * FROM public.${ident(child.name)} WHERE ${ident(fk.child_col)} = ANY($1)`,[ids])).rows;
            if(add(child.name,rows)) changed=true;
          }
        }
      }
    }
    if(rounds>=40 && changed) throw new HttpError(409,'Le graphe de dépendances dépasse la limite de sécurité; sauvegarde refusée.');
    // Ne jamais inclure les sessions ou les données de journal de sauvegarde dans un paquet client.
    selected.delete('user_sessions'); selected.delete('backup_logs');
  }
  const out={}; for(const [name,m] of selected){ const t=tables.get(name); out[name]={columns:t.cols,pk:t.pk,rows:[...m.values()]}; }
  return {tables:out, schemaVersion:1};
}
function fileName(scope,id){ return `smp-${scope==='platform'?'platform':`client-${id}`}-${new Date().toISOString().replace(/[:.]/g,'-')}.json.gz`; }
async function createPackage(scope,id) {
  const c=await pool.connect(); try { const data=await scopedRows(c,id,{platform:scope==='platform'}); const client=scope==='platform'?null:(await c.query('SELECT id,name,code FROM clients WHERE id=$1',[id])).rows[0];
    const payload={format:'station-manager-pro-logical-backup',version:1,scope,client:client?{id:Number(client.id),name:client.name,code:client.code}:null,created_at:new Date().toISOString(),tables:data.tables};
    const buf=zlib.gzipSync(Buffer.from(JSON.stringify(payload)),{level:9}); if(buf.length<50) throw new Error('Archive de sauvegarde vide.');
    const dir=scope==='platform'?PLATFORM_DIR():CLIENT_DIR(id); fs.mkdirSync(dir,{recursive:true,mode:0o700}); const name=fileName(scope,id), file=path.join(dir,name); fs.writeFileSync(file,buf,{flag:'wx',mode:0o600}); return {name,size:buf.length,created_at:new Date().toISOString(),table_count:Object.keys(data.tables).length,scope,client_id:id||null};
  } finally { c.release(); }
}
function listFiles(scope,id){const dir=scope==='platform'?PLATFORM_DIR():CLIENT_DIR(id); if(!fs.existsSync(dir))return[];return fs.readdirSync(dir).filter(n=>NAME.test(n)).map(name=>{const p=path.join(dir,name);const s=fs.statSync(p);return{name,size:s.size,created_at:s.mtime.toISOString(),scope,client_id:id||null};}).sort((a,b)=>b.created_at.localeCompare(a.created_at));}
function readPackage(file){ let p; try{p=JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));}catch{throw new HttpError(400,'Archive de sauvegarde invalide ou endommagée.');} if(p.format!=='station-manager-pro-logical-backup'||p.version!==1||!p.tables||typeof p.tables!=='object')throw new HttpError(400,'Format de sauvegarde non reconnu.'); return p; }
function parsePackageBuffer(buf, expectedScope='client') {
  let text;
  try {
    // Détecter le vrai format par signature gzip, pas par l’extension du fichier.
    text = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
      ? zlib.gunzipSync(buf).toString('utf8')
      : buf.toString('utf8').replace(/^\uFEFF/, '').trim();
  } catch { throw new HttpError(400, 'Archive corrompue : la décompression gzip a échoué.'); }
  let pkg; try { pkg = JSON.parse(text); } catch { throw new HttpError(400, 'Fichier invalide : contenu ni JSON valide ni archive gzip JSON.'); }
  if (!pkg || pkg.format !== 'station-manager-pro-logical-backup' || pkg.version !== 1 || !pkg.tables || typeof pkg.tables !== 'object' || Array.isArray(pkg.tables)) throw new HttpError(400, 'Format ou version d’archive non pris en charge. Archive attendue : station-manager-pro-logical-backup version 1.');
  if (pkg.scope !== expectedScope) throw new HttpError(400, `Type d’archive incorrect : ${expectedScope === 'client' ? 'une sauvegarde isolée de client' : 'une sauvegarde de plateforme'} est requise.`);
  return pkg;
}
const { planOrder } = require('./fk_order');
const pkWhere = (t, startAt = 1) => t.pk.map((k, i) => `${ident(k)}=$${i + startAt}`).join(' AND ');
async function applyPackage(client, pkg, targetId, { reset = false } = {}) {
  if (pkg.scope !== 'client' || Number(pkg.client?.id)!==Number(targetId)) throw new HttpError(400, 'Cette sauvegarde n’appartient pas au client sélectionné.');
  const live = await schema(client), rowsByTable = pkg.tables, tableNames = Object.keys(rowsByTable);
  for (const name of tableNames) {
    if (!live.has(name) || !live.get(name).pk.length) throw new HttpError(400, `Table non compatible avec cette version : ${name}.`);
    const cols = rowsByTable[name].columns || [];
    if (cols.some(c => !live.get(name).cols.includes(c))) throw new HttpError(400, `Schéma incompatible pour la table ${name}.`);
  }
  const protectedTables = new Set(['clients','client_contracts','stations','users','roles','permissions','role_permissions','licenses','client_licenses','schema_migrations','migrations','app_migrations','app_settings','settings']);
  // Ordre sûr : les boucles de clés étrangères (A -> B -> A) sont résolues en différant une colonne optionnelle (NULL puis mise à jour).
  const fkList = tableNames.flatMap(n => live.get(n).fks);
  const plan = planOrder(tableNames, fkList, (t, c) => !!live.get(t)?.nullable.has(c));
  const deferredBy = new Map();
  for (const d of plan.deferred) { if (!deferredBy.has(d.child)) deferredBy.set(d.child, new Set()); deferredBy.get(d.child).add(d.child_col); }
  const current = await scopedRows(client, targetId);
  const currentTables = Object.keys(current.tables).filter(n => !protectedTables.has(n) && live.has(n));
  // 1. Casser les liens circulaires des lignes actuelles (colonne mise à NULL), puis supprimer enfant -> parent.
  //    Les données d'identité, les utilisateurs et le contrat restent en place : le Super Admin ne perd pas l'accès au client.
  for (const [name, cols] of deferredBy) {
    if (protectedTables.has(name) || !current.tables[name]) continue;
    const t = live.get(name); if (!t.pk.length) continue;
    for (const row of current.tables[name].rows) for (const col of cols) await client.query(`UPDATE public.${ident(name)} SET ${ident(col)}=NULL WHERE ${pkWhere(t)}`, t.pk.map(k => row[k]));
  }
  for (const name of plan.order) {
    if (protectedTables.has(name) || !current.tables[name]) continue;
    const t = live.get(name); if (!t.pk.length) continue;
    for (const row of current.tables[name].rows) await client.query(`DELETE FROM public.${ident(name)} WHERE ${pkWhere(t)}`, t.pk.map(k => row[k]));
  }
  if (reset) return { restored: false, deleted_tables: currentTables.length };
  // 2. Réinsertion parent -> enfant ; colonnes différées écrites à NULL puis mises à jour une fois toutes les lignes présentes.
  const later = [];
  for (const name of [...plan.order].reverse()) {
    const pkgTable = rowsByTable[name]; if (!pkgTable || !pkgTable.rows.length) continue;
    const t = live.get(name), cols = pkgTable.columns.filter(c => t.cols.includes(c)), def = deferredBy.get(name) || new Set();
    const updates = cols.filter(c => !t.pk.includes(c)).map(c => `${ident(c)}=EXCLUDED.${ident(c)}`);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    const conflict = t.pk.length ? `ON CONFLICT (${t.pk.map(ident).join(',')}) ${updates.length ? 'DO UPDATE SET ' + updates.join(',') : 'DO NOTHING'}` : '';
    for (const row of pkgTable.rows) {
      const vals = cols.map(c => (def.has(c) || row[c] === undefined ? null : row[c]));
      await client.query(`INSERT INTO public.${ident(name)} (${cols.map(ident).join(',')}) VALUES (${placeholders}) ${conflict}`, vals);
      for (const c of def) if (cols.includes(c) && row[c] != null && !t.pk.includes(c)) later.push({ name, t, col: c, val: row[c], pk: t.pk.map(k => row[k]) });
    }
  }
  for (const u of later) await client.query(`UPDATE public.${ident(u.name)} SET ${ident(u.col)}=$1 WHERE ${pkWhere(u.t, 2)}`, [u.val, ...u.pk]);
  // 3. Réaligner les séquences des tables restaurées pour éviter les collisions d'identifiants.
  for (const name of [...plan.order].reverse()) {
    const t = live.get(name); if (!t || t.pk.length !== 1) continue; const pk = t.pk[0];
    const seq = (await client.query('SELECT pg_get_serial_sequence($1,$2) AS seq', [`public.${name}`, pk])).rows[0]?.seq;
    if (seq) await client.query(`SELECT setval($1, GREATEST(COALESCE((SELECT MAX(${ident(pk)}) FROM public.${ident(name)}),1),1), true)`, [seq]);
  }
  return { restored: true, restored_tables: tableNames.length, deferred_links: plan.deferred.length };
}
async function logOperation({clientId=null,scope,kind,status,fileName=null,size=null,error=null,actorId}){try{await pool.query(`INSERT INTO backup_logs(kind,status,file_name,file_size,error_message,finished_at,meta) VALUES ($1,$2,$3,$4,$5,now(),$6::jsonb)`,[kind,status,fileName,size,error,JSON.stringify({scope,client_id:clientId,actor_id:actorId})]);}catch(e){console.warn('[tenant-backup] journal:',e.message);}}

r.get('/admin/clients/:id/isolated-backups',needGlobal,wrap(async(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)throw new HttpError(400,'Identifiant client invalide.');const {rowCount}=await pool.query('SELECT 1 FROM clients WHERE id=$1',[id]);if(!rowCount)throw new HttpError(404,'Client introuvable.');res.json({client_id:id,backups:listFiles('client',id)});}));
r.post('/admin/clients/:id/isolated-backups',needGlobal,wrap(async(req,res)=>{const id=Number(req.params.id);await verifyPassword(req,req.body?.superadmin_password);const {rowCount}=await pool.query('SELECT 1 FROM clients WHERE id=$1',[id]);if(!rowCount)throw new HttpError(404,'Client introuvable.');try{const b=await createPackage('client',id);await logOperation({clientId:id,scope:'client',kind:'client-backup',status:'ok',fileName:b.name,size:b.size,actorId:req.user.id});await audit(pool,req,'maintenance',`Sauvegarde isolée du client ${id}: ${b.name}`);res.json({ok:true,...b});}catch(e){await logOperation({clientId:id,scope:'client',kind:'client-backup',status:'failed',error:e.message,actorId:req.user.id});throw e;}}));
r.get('/admin/clients/:id/isolated-backups/:name',needGlobal,wrap(async(req,res)=>{const id=Number(req.params.id),name=String(req.params.name);if(!NAME.test(name)||!name.startsWith(`smp-client-${id}-`))throw new HttpError(400,'Nom de fichier invalide pour ce client.');const file=path.join(CLIENT_DIR(id),name);if(!fs.existsSync(file))throw new HttpError(404,'Sauvegarde introuvable.');res.download(file,name);}));
r.post('/admin/clients/:id/isolated-restore',needGlobal,express.raw({type:['application/gzip','application/x-gzip','application/octet-stream','application/json','text/json','text/plain'],limit:Math.max(1,Math.min(200,+(process.env.RESTORE_MAX_MB||100)))*1024*1024}),wrap(async(req,res)=>{if(process.env.CLIENT_RESTORE_ENABLED!=='1')throw new HttpError(403,'Restauration client désactivée par sécurité. Activez CLIENT_RESTORE_ENABLED=1 uniquement après validation sur une base de test.');await verifyPassword(req,req.headers['x-superadmin-password']);const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)throw new HttpError(400,'Identifiant client invalide.');const buf=req.body;if(!Buffer.isBuffer(buf)||buf.length<2)throw new HttpError(400,'Fichier de sauvegarde absent ou vide.');const pkg=parsePackageBuffer(buf,'client');if(Number(pkg.client?.id)!==id)throw new HttpError(400,`Cette archive appartient au client ${pkg.client?.id ?? 'inconnu'}, pas au client ${id}.`);const safety=await createPackage('client',id);await logOperation({clientId:id,scope:'client',kind:'client-backup',status:'ok',fileName:safety.name,size:safety.size,actorId:req.user.id});const c=await pool.connect();let result;try{await c.query('BEGIN');result=await applyPackage(c,pkg,id);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK').catch(()=>{});await logOperation({clientId:id,scope:'client',kind:'client-restore',status:'failed',fileName:null,size:buf.length,error:e.message,actorId:req.user.id});throw e;}finally{c.release();}await logOperation({clientId:id,scope:'client',kind:'client-restore',status:'ok',fileName:null,size:buf.length,actorId:req.user.id});await audit(pool,req,'maintenance',`Restauration isolée du client ${id}; sauvegarde de sécurité ${safety.name}`);await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id IN (SELECT id FROM users WHERE client_id=$1)',[id]).catch(()=>{});res.json({ok:true,client_id:id,safety_backup:safety.name,...result,note:'Restauration du périmètre client terminée. Les utilisateurs, stations et contrat existants ont été conservés.'});}));
r.post('/admin/clients/:id/isolated-reset',needGlobal,wrap(async(req,res)=>{if(process.env.CLIENT_RESET_ENABLED!=='1')throw new HttpError(403,'Réinitialisation client désactivée par sécurité. Configurez CLIENT_RESET_ENABLED=1 après test isolé.');await verifyPassword(req,req.body?.superadmin_password);if(req.body?.confirmation!=='REINITIALISER CE CLIENT')throw new HttpError(400,'Saisissez exactement REINITIALISER CE CLIENT.');const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)throw new HttpError(400,'Identifiant client invalide.');const {rowCount}=await pool.query('SELECT 1 FROM clients WHERE id=$1',[id]);if(!rowCount)throw new HttpError(404,'Client introuvable.');const b=await createPackage('client',id);const c=await pool.connect();let result;try{await c.query('BEGIN');await c.query("SELECT set_config('station_manager.audited_client_reset','on',true)");const pkg=readPackage(path.join(CLIENT_DIR(id),b.name));result=await applyPackage(c,pkg,id,{reset:true});await audit(c,req,'maintenance',`Réinitialisation isolée du client ${id}; sauvegarde préalable ${b.name}`,'clients',id,null,{backup:b.name,scope:'client',reset:true});await c.query('COMMIT');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}await logOperation({clientId:id,scope:'client',kind:'client-reset',status:'ok',fileName:b.name,size:b.size,actorId:req.user.id});res.json({ok:true,client_id:id,backup:b.name,...result});}));
r.get('/admin/maintenance/platform-backup-history',needGlobal,wrap(async(_req,res)=>{const {rows}=await pool.query(`SELECT id,kind,status,file_name,file_size,error_message,email_sent,email_error,started_at,finished_at,meta FROM backup_logs WHERE meta->>'scope'='platform' ORDER BY started_at DESC LIMIT 50`);res.json({backups:listFiles('platform'),logs:rows});}));
r.get('/admin/clients/:id/isolated-backup-history',needGlobal,wrap(async(req,res)=>{const id=Number(req.params.id);const {rowCount}=await pool.query('SELECT 1 FROM clients WHERE id=$1',[id]);if(!rowCount)throw new HttpError(404,'Client introuvable.');const {rows}=await pool.query(`SELECT id,kind,status,file_name,file_size,error_message,email_sent,email_error,started_at,finished_at,meta FROM backup_logs WHERE meta->>'scope'='client' AND meta->>'client_id'=$1 ORDER BY started_at DESC LIMIT 50`,[String(id)]);res.json({backups:listFiles('client',id),logs:rows});}));
r.get('/admin/maintenance/platform-backups',needGlobal,wrap(async(_req,res)=>res.json({backups:listFiles('platform')})));
r.post('/admin/maintenance/platform-backups',needGlobal,wrap(async(req,res)=>{await verifyPassword(req,req.body?.superadmin_password);const b=await createPackage('platform');await logOperation({scope:'platform',kind:'platform-backup',status:'ok',fileName:b.name,size:b.size,actorId:req.user.id});await audit(pool,req,'maintenance',`Sauvegarde séparée de la plateforme: ${b.name}`);res.json({ok:true,...b});}));
r.get('/admin/maintenance/platform-backups/:name',needGlobal,wrap(async(req,res)=>{const name=String(req.params.name);if(!NAME.test(name)||!name.startsWith('smp-platform-'))throw new HttpError(400,'Nom de sauvegarde plateforme invalide.');const file=path.join(PLATFORM_DIR(),name);if(!fs.existsSync(file))throw new HttpError(404,'Sauvegarde plateforme introuvable.');res.download(file,name);}));
r.post('/admin/maintenance/platform-restore',needGlobal,express.raw({type:['application/gzip','application/x-gzip','application/octet-stream'],limit:Math.max(1,Math.min(200,+(process.env.RESTORE_MAX_MB||100)))*1024*1024}),wrap(async(req,res)=>{if(process.env.PLATFORM_RESTORE_ENABLED!=='1')throw new HttpError(403,'Restauration plateforme désactivée par sécurité. Configurez PLATFORM_RESTORE_ENABLED=1 après test isolé.');await verifyPassword(req,req.headers['x-superadmin-password']);if(!Buffer.isBuffer(req.body)||req.body.length<50)throw new HttpError(400,'Fichier de sauvegarde absent.');let pkg;try{pkg=JSON.parse(zlib.gunzipSync(req.body).toString('utf8'));}catch{throw new HttpError(400,'Archive gzip/JSON invalide.');}if(pkg.format!=='station-manager-pro-logical-backup'||pkg.version!==1||pkg.scope!=='platform'||!pkg.tables)throw new HttpError(400,'Cette archive n’est pas une sauvegarde de plateforme.');const safety=await createPackage('platform');await logOperation({scope:'platform',kind:'platform-backup',status:'ok',fileName:safety.name,size:safety.size,actorId:req.user.id});const c=await pool.connect();let count=0;try{await c.query('BEGIN');const live=await schema(c);const allowed=new Set(['users','roles','permissions','role_permissions','app_settings','settings']);const names=Object.keys(pkg.tables).filter(n=>allowed.has(n));for(const n of names){if(!live.has(n)||pkg.tables[n].columns.some(col=>!live.get(n).cols.includes(col)))throw new HttpError(400,`Schéma incompatible : ${n}.`);}
  // Ne remplacer que le compte global et les paramètres sans rattachement client/station.
  for(const n of names){const t=live.get(n);for(const row of pkg.tables[n].rows||[]){if(n==='users'&&!row.is_global)continue;if((n==='app_settings'||n==='settings')&&((t.cols.includes('client_id')&&row.client_id!=null)||(t.cols.includes('station_id')&&row.station_id!=null)))continue;const cols=pkg.tables[n].columns.filter(x=>t.cols.includes(x));const vals=cols.map(x=>row[x]===undefined?null:row[x]);const updates=cols.filter(x=>!t.pk.includes(x)).map(x=>`${ident(x)}=EXCLUDED.${ident(x)}`);await c.query(`INSERT INTO public.${ident(n)} (${cols.map(ident).join(',')}) VALUES (${cols.map((_,i)=>`$${i+1}`).join(',')}) ON CONFLICT (${t.pk.map(ident).join(',')}) ${updates.length?'DO UPDATE SET '+updates.join(','):'DO NOTHING'}`,vals);count++;}}
  await c.query('COMMIT');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id IN (SELECT id FROM users WHERE is_global=true)').catch(()=>{});await logOperation({scope:'platform',kind:'platform-restore',status:'ok',size:req.body.length,actorId:req.user.id});await audit(pool,req,'maintenance','Restauration de la configuration de plateforme (sans données clients)');res.json({ok:true,restored_records:count,safety_backup:safety.name,note:'Configuration plateforme restaurée. Aucune donnée métier client n’a été remplacée; reconnectez-vous.'});}));

module.exports=r;
