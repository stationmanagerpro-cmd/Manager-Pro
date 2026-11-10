'use strict';

// Rapports opérationnels programmés (heure locale du Mali = UTC, sans changement saisonnier).
const express = require('express');
const { z } = require('zod');
const { pool, tx, wrap, body, need, audit, HttpError } = require('./core');
const { loadContractForUser, featureOn } = require('./contracts');
const { sendMail } = require('./mailer');
const r = express.Router();
const TZ = 'Africa/Bamako';
const CATEGORIES = new Set(['operations', 'cash', 'stock', 'staff', 'payroll', 'incidents', 'accounts']);

async function clientIdOf(req) {
  const { rows:[u] } = await pool.query('SELECT client_id FROM users WHERE id=$1 AND active AND deleted_at IS NULL',[req.user.id]);
  if (!u?.client_id) throw new HttpError(403, 'Compte client indisponible.');
  return Number(u.client_id);
}
function minuteOf(t) { const m = /^(\d{2}):(\d{2})$/.exec(String(t || '').slice(0,5)); if (!m) return null; const h=+m[1], n=+m[2]; return h<24 && n<60 ? h*60+n : null; }
function fmtTime(min) { return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`; }
function nextRun({ frequency, scheduled_date, day_of_week, day_of_month, send_mode, send_time, random_start, random_end }, after = new Date()) {
  const startMin = send_mode === 'random' ? minuteOf(random_start) : minuteOf(send_time);
  const endMin = send_mode === 'random' ? minuteOf(random_end) : startMin;
  if (startMin == null || endMin == null || endMin < startMin) throw new HttpError(400, 'Heure de programmation invalide.');
  const picked = () => send_mode === 'random' ? startMin + Math.floor(Math.random() * (endMin - startMin)) : startMin;
  const at = (y,m,d) => { const min=picked(); return new Date(Date.UTC(y,m,d,Math.floor(min/60),min%60,0,0)); };
  const base = new Date(after);
  if (frequency === 'once') {
    const [y,m,d] = String(scheduled_date).slice(0,10).split('-').map(Number);
    const date = at(y,m-1,d);
    if (!Number.isFinite(date.getTime()) || date <= after) throw new HttpError(400, 'La date et l’heure programmées doivent être dans le futur.');
    return date;
  }
  // Date/heure du Mali : UTC+0. Le choix aléatoire est fixé et persisté pour chaque occurrence.
  let day = new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),base.getUTCDate()));
  for (let i=0;i<370;i++,day.setUTCDate(day.getUTCDate()+1)) {
    const match = frequency === 'daily' ? true
      : frequency === 'weekly' ? day.getUTCDay() === Number(day_of_week)
      : day.getUTCDate() === Number(day_of_month);
    if (!match) continue;
    const candidate = at(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate());
    if (candidate > after) return candidate;
  }
  throw new HttpError(400, 'Impossible de calculer la prochaine exécution.');
}
async function requireEnabled(req) {
  if (req.user.is_global) throw new HttpError(403, 'La programmation client n’est pas accessible depuis le compte Super Admin.');
  const contract = await loadContractForUser(req.user.id, false);
  if (contract?.suspended || (!featureOn(contract,'can_use_auto_alerts') && !featureOn(contract,'module:auto_alerts'))) {
    throw new HttpError(403, 'La programmation des rapports n’est pas autorisée par votre contrat.', { code:'FEATURE_DISABLED', feature:'can_use_auto_alerts' });
  }
  const clientId = await clientIdOf(req);
  const { rows:[u] } = await pool.query('SELECT client_id FROM users WHERE id=$1 AND active AND deleted_at IS NULL',[req.user.id]);
  if (!u || Number(u.client_id) !== clientId) throw new HttpError(403,'Compte client invalide.');
  return clientId;
}

r.get('/messaging/report-schedules', need('settings.edit','user.manage'), wrap(async (req,res)=>{
  const clientId = await requireEnabled(req);
  const [{ rows:schedules },{ rows:users }] = await Promise.all([
    pool.query(`SELECT id,station_id,title,frequency,scheduled_date,day_of_week,day_of_month,send_mode,send_time,random_start,random_end,recipient_user_ids,categories,report_types,delivery_channels,email_recipients,active,next_run_at,last_sent_at,last_error,created_at FROM alert_report_schedules WHERE client_id=$1 ORDER BY next_run_at`,[clientId]),
    pool.query(`SELECT u.id,u.login,u.full_name,(SELECT e.email FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1) AS email,r.code AS role,r.label AS role_label FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.client_id=$1 AND u.active AND u.deleted_at IS NULL ORDER BY COALESCE(u.full_name,u.login)`,[clientId])
  ]);
  res.json({ enabled:true, timezone:TZ, email_configured:!!process.env.SMTP_HOST, schedules, users });
}));

const schema = z.object({
  title:z.string().trim().min(2).max(120), station_id:z.number().int().positive().nullable().optional(),
  frequency:z.enum(['once','weekly','monthly']), scheduled_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  day_of_week:z.number().int().min(0).max(6).nullable().optional(), day_of_month:z.number().int().min(1).max(28).nullable().optional(),
  send_mode:z.enum(['fixed','random']).default('fixed'), send_time:z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  random_start:z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), random_end:z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  recipient_user_ids:z.array(z.number().int().positive()).min(1).max(100),
  categories:z.array(z.string()).min(1).max(7),
  report_types:z.array(z.enum(['financial_summary','operational_alerts','stock_summary','hr_summary'])).min(1).max(4).default(['financial_summary']),
  delivery_channels:z.array(z.enum(['app','email'])).min(1).max(2).default(['app']),
  email_recipients:z.array(z.string().trim().email().max(254)).max(20).default([]), active:z.boolean().default(true)
});
r.post('/messaging/report-schedules', need('settings.edit','user.manage'), body(schema), wrap(async(req,res)=>{
  const clientId=await requireEnabled(req); const b=req.body;
  if (b.categories.some(c=>!CATEGORIES.has(c))) throw new HttpError(400,'Catégorie de rapport inconnue.');
  if (b.report_types.includes('financial_summary') && !req.user.perms?.has('finance.view') && !req.user.perms?.has('report.view')) throw new HttpError(403,'Permission de consultation financière ou de rapports requise.');
  if (b.report_types.includes('stock_summary') && !req.user.perms?.has('stock.adjust') && !req.user.perms?.has('report.view')) throw new HttpError(403,'Permission de consultation des stocks requise.');
  if (b.report_types.includes('hr_summary') && !req.user.perms?.has('hr.manage') && !req.user.perms?.has('report.view')) throw new HttpError(403,'Permission de consultation RH requise.');
  if (b.delivery_channels.includes('email') && !process.env.SMTP_HOST) throw new HttpError(503,'Envoi email indisponible : le serveur SMTP doit d’abord être configuré.');
  if (b.delivery_channels.includes('email') && !b.email_recipients.length) throw new HttpError(400,'Ajoutez au moins une adresse email pour activer l’envoi par email.');
  if (new Set(b.email_recipients.map(x=>x.toLowerCase())).size !== b.email_recipients.length) throw new HttpError(400,'Une adresse email est répétée.');
  if (b.frequency==='daily' && (b.scheduled_date || b.day_of_week!=null || b.day_of_month!=null)) throw new HttpError(400,'Quotidien : pas de date ni jour spécifiques.');
  if (b.frequency==='once' && (!b.scheduled_date || b.day_of_week!=null || b.day_of_month!=null)) throw new HttpError(400,'Une date précise est obligatoire pour une programmation unique.');
  if (b.frequency==='weekly' && (!Number.isInteger(b.day_of_week) || b.scheduled_date || b.day_of_month!=null)) throw new HttpError(400,'Choisissez le jour de la semaine.');
  if (b.frequency==='monthly' && (!Number.isInteger(b.day_of_month) || b.scheduled_date || b.day_of_week!=null)) throw new HttpError(400,'Choisissez le jour du mois (1 à 28).');
  if (b.send_mode==='fixed' && (!b.send_time || b.random_start || b.random_end)) throw new HttpError(400,'Choisissez une heure fixe valide.');
  if (b.send_mode==='random' && (!b.random_start || !b.random_end || b.send_time)) throw new HttpError(400,'Définissez une plage horaire aléatoire valide.');
  if (b.station_id != null) { const q=await pool.query('SELECT 1 FROM stations WHERE id=$1 AND client_id=$2 AND active',[b.station_id,clientId]); if(!q.rowCount) throw new HttpError(403,'Station hors du compte client.'); }
  const {rows:valid}=await pool.query('SELECT id FROM users WHERE client_id=$1 AND active AND deleted_at IS NULL AND id=ANY($2::bigint[])',[clientId,b.recipient_user_ids]);
  const validIds=valid.map(x=>Number(x.id)); if(validIds.length!==new Set(b.recipient_user_ids).size || validIds.length!==b.recipient_user_ids.length) throw new HttpError(400,'Chaque destinataire doit être un utilisateur actif du même compte client.');
  const scheduleFields={...b};
  if(b.frequency!=='once') scheduleFields.scheduled_date=null;
  if(b.frequency!=='weekly') scheduleFields.day_of_week=null;
  if(b.frequency!=='monthly') scheduleFields.day_of_month=null;
  if(b.send_mode==='fixed'){scheduleFields.random_start=null;scheduleFields.random_end=null;}else scheduleFields.send_time=null;
  const due=nextRun(scheduleFields);
  const {rows:[row]}=await pool.query(`INSERT INTO alert_report_schedules(client_id,station_id,created_by,title,frequency,scheduled_date,day_of_week,day_of_month,send_mode,send_time,random_start,random_end,recipient_user_ids,categories,report_types,delivery_channels,email_recipients,active,next_run_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    RETURNING id,title,frequency,send_mode,next_run_at,active,report_types,delivery_channels,email_recipients`,[clientId,b.station_id??null,req.user.id,b.title,b.frequency,scheduleFields.scheduled_date??null,scheduleFields.day_of_week??null,scheduleFields.day_of_month??null,b.send_mode,scheduleFields.send_time??null,scheduleFields.random_start??null,scheduleFields.random_end??null,validIds,b.categories,b.report_types,b.delivery_channels,b.email_recipients,b.active,due]);
  await audit(pool,req,'alertes','Programmation de rapport créée','alert_report_schedules',row.id,null,{frequency:b.frequency,send_mode:b.send_mode,recipient_count:validIds.length,categories:b.categories,report_types:b.report_types,delivery_channels:b.delivery_channels,email_recipient_count:b.email_recipients.length});
  res.status(201).json({schedule:row,timezone:TZ});
}));

r.patch('/messaging/report-schedules/:id', need('settings.edit','user.manage'), body(z.object({active:z.boolean()})), wrap(async(req,res)=>{
  const clientId=await requireEnabled(req); const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<=0) throw new HttpError(400,'Identifiant de programmation invalide.');
  const {rows:[row]}=await pool.query(`UPDATE alert_report_schedules SET active=$3,updated_at=now() WHERE id=$1 AND client_id=$2 RETURNING id,active,next_run_at`,[id,clientId,req.body.active]);
  if(!row) throw new HttpError(404,'Programmation introuvable.');
  await audit(pool,req,'alertes',req.body.active?'Programmation activée':'Programmation suspendue','alert_report_schedules',id,null,{active:req.body.active}); res.json({schedule:row});
}));
r.delete('/messaging/report-schedules/:id', need('settings.edit','user.manage'), wrap(async(req,res)=>{
  const clientId=await requireEnabled(req); const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<=0) throw new HttpError(400,'Identifiant de programmation invalide.');
  const {rowCount}=await pool.query('DELETE FROM alert_report_schedules WHERE id=$1 AND client_id=$2',[id,clientId]);
  if(!rowCount) throw new HttpError(404,'Programmation introuvable.');
  await audit(pool,req,'alertes','Programmation supprimée','alert_report_schedules',id,null,{}); res.json({ok:true});
}));

function previousMonthWindow(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth()-1, 1));
  return { start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10), label: `${String(start.getUTCMonth()+1).padStart(2,'0')}/${start.getUTCFullYear()}` };
}
async function buildDigest(schedule) {
  const sections = [`Rapport programmé : ${schedule.title}`, `Compte client : ${schedule.client_id}${schedule.station_id ? ` · Station ${schedule.station_id}` : ' · Toutes les stations'}`, `Généré le ${new Date().toLocaleString('fr-FR',{timeZone:TZ})}`];
  const types = schedule.report_types?.length ? schedule.report_types : ['operational_alerts'];
  const window = previousMonthWindow();
  const sid = schedule.station_id;
  if (types.includes('financial_summary')) {
    const { rows:[f] } = await pool.query(`SELECT
      COALESCE((SELECT SUM(total) FROM sales WHERE status='valide' AND sold_at >= $1::date AND sold_at < $2::date AND ($3::bigint IS NULL OR station_id=$3)),0)::numeric AS revenue,
      COALESCE((SELECT SUM(amount) FROM expenses WHERE deleted_at IS NULL AND spent_on >= $1::date AND spent_on < $2::date AND ($3::bigint IS NULL OR station_id=$3)),0)::numeric AS expenses,
      (SELECT COUNT(*)::int FROM sales WHERE status='valide' AND sold_at >= $1::date AND sold_at < $2::date AND ($3::bigint IS NULL OR station_id=$3)) AS sales_count`,[window.start,window.end,sid]);
    const revenue=Number(f.revenue||0), expenses=Number(f.expenses||0);
    sections.push(`\nSITUATION FINANCIÈRE — ${window.label}`,`Période : ${window.start} au ${window.end}`,`Chiffre d’affaires enregistré : ${revenue.toLocaleString('fr-FR')} FCFA`,`Dépenses enregistrées : ${expenses.toLocaleString('fr-FR')} FCFA`,`Différence indicative (CA - dépenses enregistrées) : ${(revenue-expenses).toLocaleString('fr-FR')} FCFA`,`Ventes validées : ${f.sales_count}`,`Note : cet indicateur n’est pas un bénéfice comptable certifié et n’inclut pas nécessairement tous les coûts, dettes ou ajustements.`);
  }
  if (types.includes('stock_summary')) {
    const { rows:[st] } = await pool.query(`SELECT COUNT(*)::int AS products, COUNT(*) FILTER (WHERE COALESCE(sk.quantity,0)<=p.min_stock)::int AS low_stock FROM products p LEFT JOIN stock sk ON sk.product_id=p.id WHERE p.active=TRUE AND p.deleted_at IS NULL AND ($1::bigint IS NULL OR p.station_id=$1)`,[sid]);
    sections.push(`\nSTOCKS`,`Produits actifs suivis : ${st.products}`,`Produits au seuil minimum ou en dessous : ${st.low_stock}`);
  }
  if (types.includes('hr_summary')) {
    const { rows:[hr] } = await pool.query(`SELECT COUNT(*)::int AS employees, COUNT(*) FILTER (WHERE status='actif')::int AS active FROM employees WHERE deleted_at IS NULL AND ($1::bigint IS NULL OR station_id=$1)`,[sid]);
    sections.push(`\nPERSONNEL`,`Employés enregistrés : ${hr.employees}`,`Employés actifs : ${hr.active}`);
  }
  if (types.includes('operational_alerts')) {
    const since = schedule.last_sent_at || new Date(Date.now()-30*86400000);
    const {rows}=await pool.query(`SELECT m.system_kind AS kind,m.alert_status,COUNT(*)::int AS count FROM messages m
      WHERE m.client_id=$1 AND m.is_system=TRUE AND m.deleted_at IS NULL AND m.created_at>$2
        AND ($3::bigint IS NULL OR
          (m.ref_table='shifts' AND EXISTS(SELECT 1 FROM shifts sh WHERE sh.id=m.ref_id AND sh.station_id=$3)) OR
          (m.ref_table='products' AND EXISTS(SELECT 1 FROM products p WHERE p.id=m.ref_id AND p.station_id=$3)) OR
          (m.ref_table='purchases' AND EXISTS(SELECT 1 FROM purchases pu WHERE pu.id=m.ref_id AND pu.station_id=$3)) OR
          (m.ref_table='payroll_pending' AND m.ref_id=$3))
      GROUP BY m.system_kind,m.alert_status ORDER BY m.system_kind,m.alert_status`,[schedule.client_id,since,sid]);
    const categoryByKind={cash_variance:'cash',shift_close:'cash',counter_anomaly:'operations',stock_anomaly:'stock',stock_low:'stock',purchase_variance:'cash',absence:'staff',late_arrival:'staff',account_inactive:'accounts',account_locked:'accounts',payroll_anomaly:'payroll',payroll_pending:'payroll',incident_note:'incidents',license_expiring:'accounts',backup_failure:'operations'};
    const filtered=rows.filter(x=> (schedule.categories||[]).includes('operations') || (schedule.categories||[]).includes(categoryByKind[x.kind] || 'operations'));
    sections.push(`\nALERTES OPÉRATIONNELLES (depuis ${new Date(since).toLocaleDateString('fr-FR',{timeZone:TZ})})`,`Total d’alertes : ${filtered.reduce((n,x)=>n+Number(x.count),0)}`,...(filtered.slice(0,30).map(x=>`• ${x.kind || 'alerte'} — ${x.alert_status}: ${x.count}`)));
  }
  sections.push('\nRapport automatique Manager PRO.');
  return sections.join('\n');
}
async function dispatchDueReports() {
  const client=await pool.connect(); let locked=false;
  try {
    locked=!!(await client.query('SELECT pg_try_advisory_lock(74120319) AS locked')).rows[0]?.locked;
    if(!locked) return {skipped:'another_instance_running'};
    const {rows:due}=await pool.query(`SELECT * FROM alert_report_schedules WHERE active=TRUE AND next_run_at<=now() ORDER BY next_run_at LIMIT 50`);
    let sent=0, failed=0;
    for(const s of due){
      try{
        const contract=await loadContractForUser(s.created_by,false);
        if(!contract || contract.suspended || (!featureOn(contract,'can_use_auto_alerts')&&!featureOn(contract,'module:auto_alerts'))){
          await pool.query('UPDATE alert_report_schedules SET active=FALSE,last_error=$2,updated_at=now() WHERE id=$1',[s.id,'Autorisation contractuelle absente ou suspendue']); failed++; continue;
        }
        const {rows:recipients}=await pool.query('SELECT id FROM users WHERE client_id=$1 AND id=ANY($2::bigint[]) AND active AND deleted_at IS NULL',[s.client_id,s.recipient_user_ids]);
        if(!recipients.length) throw new Error('Aucun destinataire actif dans ce compte client.');
        const body=await buildDigest(s);
        if ((s.delivery_channels||['app']).includes('app')) { const convId=await tx(async c=>{
          const {rows:[conv]}=await c.query(`INSERT INTO conversations(client_id,title,is_group,created_by) VALUES($1,$2,TRUE,NULL) RETURNING id`,[s.client_id,'Rapport programmé : '+s.title]);
          for(const u of recipients) await c.query('INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2)',[conv.id,u.id]);
          const sender=Number(recipients[0].id);
          const {rows:[msg]}=await c.query(`INSERT INTO messages(client_id,conversation_id,sender_id,body,is_system,system_kind,ref_table,ref_id) VALUES($1,$2,$3,$4,TRUE,'scheduled_report','alert_report_schedules',$5) RETURNING id`,[s.client_id,conv.id,sender,body,s.id]);
          for(const u of recipients) if(Number(u.id)!==sender) await c.query('INSERT INTO message_states(message_id,user_id) VALUES($1,$2)',[msg.id,u.id]);
        return conv.id;
        }); require('./realtime').notifyConversation(convId,{system:true}); }
        if ((s.delivery_channels||['app']).includes('email')) {
          const emails=(s.email_recipients||[]).filter(x=>typeof x==='string' && x.includes('@'));
          if (!emails.length) throw new Error('Aucune adresse email valide configurée.');
          await sendMail({to:emails.join(','),subject:`Manager PRO — ${s.title}`,text:body});
        }
        if(s.frequency==='once') await pool.query('UPDATE alert_report_schedules SET active=FALSE,last_sent_at=now(),last_error=NULL,updated_at=now() WHERE id=$1',[s.id]);
        else { const next=nextRun(s,new Date()); await pool.query('UPDATE alert_report_schedules SET next_run_at=$2,last_sent_at=now(),last_error=NULL,updated_at=now() WHERE id=$1',[s.id,next]); }
        sent++;
      }catch(e){ failed++; await pool.query('UPDATE alert_report_schedules SET last_error=$2,updated_at=now() WHERE id=$1',[s.id,String(e.message).slice(0,500)]).catch(()=>{}); console.warn(`[rapports-programmes] ${s.id}: ${e.message}`); }
    }
    return {sent,failed};
  } finally { if(locked) await client.query('SELECT pg_advisory_unlock(74120319)').catch(()=>{}); client.release(); }
}
function startScheduler(){ if(process.env.ALERTS_AUTO==='0') return null; const timer=setInterval(()=>dispatchDueReports().catch(e=>console.warn('[rapports-programmes]',e.message)),60*1000); if(timer.unref) timer.unref(); const first=setTimeout(()=>dispatchDueReports().catch(e=>console.warn('[rapports-programmes]',e.message)),25000); if(first.unref) first.unref(); return timer; }

/** Preset one-click : digest direction quotidien (défaut 20:00). */
r.post('/messaging/report-schedules/preset-direction', need('settings.edit', 'user.manage'), body(z.object({
  send_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  email_recipients: z.array(z.string().email()).max(20).optional(),
  station_id: z.number().int().positive().nullable().optional()
}).strict()), wrap(async (req, res) => {
  const clientId = await clientIdOf(req);
  const contract = await loadContractForUser(req.user.id, false);
  if (!contract || contract.suspended) throw new HttpError(403, 'Contrat suspendu.');
  if (!featureOn(contract, 'can_use_auto_alerts') && !featureOn(contract, 'module:auto_alerts')) {
    throw new HttpError(403, 'Alertes automatiques non autorisées par le contrat.');
  }
  const send_time = req.body.send_time || '20:00';
  const emails = Array.isArray(req.body.email_recipients) ? req.body.email_recipients : [];
  const channels = emails.length ? ['app', 'email'] : ['app'];
  const scheduleFields = {
    frequency: 'daily',
    scheduled_date: null,
    day_of_week: null,
    day_of_month: null,
    send_mode: 'fixed',
    send_time,
    random_start: null,
    random_end: null
  };
  const due = nextRun(scheduleFields);
  const title = 'Digest direction quotidien';
  const { rows: [row] } = await pool.query(
    `INSERT INTO alert_report_schedules(
      client_id, station_id, created_by, title, frequency, scheduled_date, day_of_week, day_of_month,
      send_mode, send_time, random_start, random_end, recipient_user_ids, categories, report_types,
      delivery_channels, email_recipients, active, next_run_at
    ) VALUES ($1,$2,$3,$4,'daily',NULL,NULL,NULL,'fixed',$5,NULL,NULL,$6,$7,$8,$9,$10,TRUE,$11)
    RETURNING *`,
    [
      clientId,
      req.body.station_id != null ? req.body.station_id : (req.sid || null),
      req.user.id,
      title,
      send_time,
      [req.user.id],
      ['operations', 'cash', 'stock', 'staff'],
      ['direction_digest', 'alerts_summary'],
      channels,
      emails,
      due
    ]
  );
  await audit(pool, req, 'messaging', 'Preset digest direction quotidien', 'alert_report_schedules', row.id);
  res.status(201).json(row);
}));

module.exports={r,startScheduler,dispatchDueReports,nextRun,previousMonthWindow,TZ};
