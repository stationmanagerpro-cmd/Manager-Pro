'use strict';
const fs = require('fs');
const src = fs.readFileSync('scripts/diagnose-fiscal.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
let count = 0;
function ok(v, msg) { if (!v) throw new Error(msg); count++; }
ok(pkg.scripts['diagnose:fiscal'] === 'node scripts/diagnose-fiscal.js', 'script npm diagnose:fiscal déclaré');
ok(src.includes("process.env.DATABASE_URL"), 'contrôle DATABASE_URL');
ok(src.includes('Mot de passe PostgreSQL absent de DATABASE_URL'), 'diagnostic mot de passe absent');
ok(src.includes("current_database() AS database"), 'confirme la base réellement ciblée');
ok(src.includes("to_regclass('public.fiscal_audit_log')"), 'vérifie la table journal fiscal');
ok(src.includes("'046_fiscalite.sql','050_fiscal_checklist.sql','057_fiscal_access_permission.sql','058_fiscalite_admin_platform_only.sql'"), 'vérifie migrations critiques');
ok(src.includes("r.code='ADMIN' AND pe.code='fiscal.access'"), 'vérifie la permission fiscale du rôle ADMIN');
ok(src.includes('Rôle ADMIN (administrateur local) avec accès Fiscalité') && src.includes('Rôle SUPERADMIN sans accès opérationnel Fiscalité'), 'ADMIN local doit avoir l\'accès ; SUPERADMIN ne doit pas l\'avoir');
ok(src.includes('Aucun changement n’a été appliqué'), 'diagnostic strictement en lecture seule');
ok(!/console\.(log|error)\(\s*process\.env\.DATABASE_URL/.test(src), 'ne journalise pas directement le secret DATABASE_URL');
console.log(`OK fiscal-diagnostic-script-static (${count} assertions)`);
