// Test unitaire de src/static_gzip.js (Node natif, aucune dépendance).
// node test/static-gzip-unit.js
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const { varyHeader, staticGzip } = require('../src/static_gzip.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sgz-'));
const js = 'const x = "' + 'a'.repeat(5000) + '";\n';
fs.writeFileSync(path.join(root, 'app.js'), js);
fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>t</title>' + 'b'.repeat(3000));
fs.writeFileSync(path.join(root, 'sw.js'), 'self.x=1;' + 'c'.repeat(3000));
fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]));
fs.writeFileSync(path.join(root, 'secret.txt'), 'ok');

// Serveur de test : même ordre que src/server.js (Vary, gzip, puis fichiers « simples » en repli).
const srv = http.createServer((req, res) => {
  const mw = [varyHeader(root), staticGzip(root)];
  let i = 0;
  const next = () => {
    const f = mw[i++];
    if (f) return f(req, res, next);
    // repli : express.static simulé (sert le fichier brut)
    const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.end(fs.readFileSync(p));
  };
  next();
});

const get = (p, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
  const u = new URL('http://127.0.0.1:' + srv.address().port + p);
  const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, headers }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  r.on('error', reject); r.end();
});

let n = 0;
const ok = (name, fn) => { n++; return fn().then(() => console.log('✔', name), e => { console.log('✘', name, '\n   ', e.message); process.exitCode = 1; }); };

srv.listen(0, '127.0.0.1', async () => {
  await ok('JS gzip : contenu décompressé identique, en-têtes corrects', async () => {
    const r = await get('/app.js', { 'Accept-Encoding': 'gzip, deflate' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['content-encoding'], 'gzip');
    assert.strictEqual(r.headers['vary'], 'Accept-Encoding');
    assert.ok(/javascript/.test(r.headers['content-type']));
    assert.strictEqual(zlib.gunzipSync(r.body).toString(), js);
    assert.strictEqual(+r.headers['content-length'], r.body.length);
    assert.ok(r.body.length < js.length, 'doit être plus petit');
  });
  await ok('sans gzip accepté : fichier brut, Vary présent', async () => {
    const r = await get('/app.js', {});
    assert.strictEqual(r.headers['content-encoding'], undefined);
    assert.strictEqual(r.body.toString(), js);
    assert.strictEqual(r.headers['vary'], 'Accept-Encoding');
  });
  await ok('racine « / » : index.html compressé', async () => {
    const r = await get('/', { 'Accept-Encoding': 'gzip' });
    assert.strictEqual(r.headers['content-encoding'], 'gzip');
    assert.ok(zlib.gunzipSync(r.body).toString().startsWith('<!doctype html>'));
  });
  await ok('sw.js exclu : jamais compressé ni modifié par ce module', async () => {
    const r = await get('/sw.js', { 'Accept-Encoding': 'gzip' });
    assert.strictEqual(r.headers['content-encoding'], undefined);
  });
  await ok('image : jamais compressée', async () => {
    const r = await get('/logo.png', { 'Accept-Encoding': 'gzip' });
    assert.strictEqual(r.headers['content-encoding'], undefined);
  });
  await ok('traversée de dossier refusée', async () => {
    const r = await get('/..%2F..%2Fetc%2Fpasswd', { 'Accept-Encoding': 'gzip' });
    assert.notStrictEqual(r.headers['content-encoding'], 'gzip');
  });
  await ok('ETag : 304 quand le navigateur a déjà la version courante', async () => {
    const first = await get('/app.js', { 'Accept-Encoding': 'gzip' });
    const r = await get('/app.js', { 'Accept-Encoding': 'gzip', 'If-None-Match': first.headers['etag'] });
    assert.strictEqual(r.status, 304);
  });
  await ok('HEAD : en-têtes sans corps', async () => {
    const r = await get('/app.js', { 'Accept-Encoding': 'gzip' }, 'HEAD');
    assert.strictEqual(r.headers['content-encoding'], 'gzip');
    assert.strictEqual(r.body.length, 0);
  });
  await ok('fichier modifié : la version gzip est recalculée', async () => {
    const f = path.join(root, 'app.js');
    fs.writeFileSync(f, js + '// v2 ' + 'z'.repeat(200));
    const t = new Date(Date.now() + 5000); fs.utimesSync(f, t, t);
    const r = await get('/app.js', { 'Accept-Encoding': 'gzip' });
    assert.ok(zlib.gunzipSync(r.body).toString().includes('// v2'));
  });
  console.log('\n' + n + ' contrôles exécutés.');
  srv.close();
  fs.rmSync(root, { recursive: true, force: true });
});
