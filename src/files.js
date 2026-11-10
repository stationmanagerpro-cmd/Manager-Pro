// Stockage durable des images et pièces jointes dans PostgreSQL/Neon.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool, HttpError } = require('./core');
const MAX=2*1024*1024;
const TYPES={png:'image/png',jpg:'image/jpeg',webp:'image/webp',pdf:'application/pdf'};
function sniff(b){if(b.length>8&&b.slice(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'png';if(b.length>3&&b[0]===255&&b[1]===216&&b[2]===255)return'jpg';if(b.length>12&&b.slice(0,4).toString()==='RIFF'&&b.slice(8,12).toString()==='WEBP')return'webp';if(b.length>5&&b.slice(0,5).toString()==='%PDF-')return'pdf';return null;}
function decode(dataUrl,allowPdf=false){const m=/^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl||''));if(!m)throw new HttpError(400,'Fichier invalide : envoyez une image au format data URL (base64)');const buf=Buffer.from(m[2],'base64');if(!buf.length||buf.length>MAX)throw new HttpError(413,'Fichier trop volumineux ou vide (2 Mo maximum)');const ext=sniff(buf);if(!ext||(ext==='pdf'&&!allowPdf))throw new HttpError(415,allowPdf?'Formats acceptés : PNG, JPEG, WebP ou PDF':'Formats acceptés : PNG, JPEG ou WebP');return{buf,ext};}
const idOf=rel=>{if(typeof rel!=='string'||!rel.startsWith('stored_files:'))return null;const id=rel.slice(13).split('.')[0];return /^[0-9a-f-]{36}$/i.test(id)?id:null;};
const legacyPath=rel=>{if(typeof rel!=='string'||!rel||path.isAbsolute(rel))return null;const root=path.resolve(process.env.UPLOAD_DIR||'./uploads'),p=path.resolve(root,rel);return p.startsWith(root+path.sep)?p:null;};
async function save(dir,dataUrl,allowPdf=false){const{buf,ext}=decode(dataUrl,allowPdf),id=crypto.randomUUID(),key=String(dir).replace(/[^a-zA-Z0-9/_-]/g,'').slice(0,180)+'/'+id+'.'+ext;await pool.query('INSERT INTO stored_files(id,storage_key,mime_type,file_size,content) VALUES($1,$2,$3,$4,$5)',[id,key,TYPES[ext],buf.length,buf]);return'stored_files:'+id+'.'+ext;}
async function read(rel){const id=idOf(rel);if(id){const{rows}=await pool.query('SELECT content FROM stored_files WHERE id=$1',[id]);return rows[0]?.content?Buffer.from(rows[0].content):null;}const p=legacyPath(rel);try{return p?fs.readFileSync(p):null;}catch{return null;}}
async function remove(rel){const id=idOf(rel);if(id){await pool.query('DELETE FROM stored_files WHERE id=$1',[id]);return;}const p=legacyPath(rel);if(p)try{fs.rmSync(p,{force:true});}catch{}}
async function typeOf(rel){const id=idOf(rel);if(id){const{rows}=await pool.query('SELECT mime_type FROM stored_files WHERE id=$1',[id]);return rows[0]?.mime_type||'application/octet-stream';}return TYPES[path.extname(String(rel||'')).slice(1).toLowerCase()]||'application/octet-stream';}
module.exports={save,read,remove,typeOf};
