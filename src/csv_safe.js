// Protection CSV contre l'injection de formules dans Excel/LibreOffice.
// Les nombres restent numériques; seules les chaînes utilisateur à risque sont préfixées.
function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(s)) s = "'" + s;
  if (/[\";\r\n]/.test(s)) return '\"' + s.replace(/\"/g, '\"\"') + '\"';
  return s;
}
module.exports = csvCell;
