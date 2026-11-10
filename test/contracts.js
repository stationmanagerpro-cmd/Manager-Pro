
 // Tests contrats clients (node test/contracts.js <admin_login> <password>)
const BASE = process.env.API || 'http://localhost:3000/api';
const [login, password] = process.argv.slice(2);

if (!login || !password) {
  console.error('Usage: node test/contracts.js <admin> <password>');
  process.exit(2);
}

let token, sid, fails = 0;

const hdr = (t, s) => ({
  'Content-Type': 'application/json',
  ...(t && { Authorization: 'Bearer ' + t }),
  ...(s && { 'X-Station-Id': String(s) })
});

const call = async (method, p, body, o = {}) => {
  const requestToken = o.token !== undefined ? o.token : token;
  const requestSid = o.sid !== undefined ? o.sid : sid;

  const r = await fetch(BASE + p, {
    method,
    headers: hdr(requestToken, requestSid),
    body: body != null ? JSON.stringify(body) : undefined
  });

  return { s: r.status, j: await r.json().catch(() => null) };
};

const ok = (condition, message) => {
  if (condition) {
    console.log('  ✔ ' + message);
  } else {
    fails++;
    console.log('  ✖ ' + message);
  }
};

(async () => {
  const t = Date.now();
  const gPass = 'GerantTest1!';
  const gLogin = 'gerant' + (t % 100000);

  // Connexion du super-administrateur global
  let r = await call(
    'POST',
    '/auth/login',
    { login, password },
    { token: null, sid: null }
  );

  ok(r.s === 200 && !!r.j?.token, 'login admin');

  if (r.s !== 200 || !r.j?.token) {
    console.error('Connexion admin impossible :', r.s, r.j);
    process.exit(1);
  }

  token = r.j.token;

  const meResponse = await call('GET', '/me', null, { sid: null });
  const me = meResponse.j;

  ok(!!me?.is_global, 'admin is_global');

  if (!me?.is_global) {
    console.error('Le compte utilisé doit être un super-administrateur global.');
    process.exit(1);
  }

  // Créer le client, son gérant propriétaire et sa station par défaut.
  r = await call(
    'POST',
    '/admin/clients',
    {
      name: 'Client Test ' + t,
      code: 'CT' + (t % 10000),
      owner_login: gLogin,
      owner_password: gPass
    },
    { sid: null }
  );

  ok(r.s === 201, 'client et gérant créés');

  if (r.s !== 201 || !r.j?.id || !r.j?.station_id || !r.j?.owner_user_id) {
    console.error('Réponse inattendue lors de la création du client :', r.s, r.j);
    process.exit(1);
  }

  const clientId = r.j.id;
  sid = r.j.station_id;
  const gerantId = r.j.owner_user_id;

  // Configurer le contrat : une seule station et module RH désactivé.
  r = await call(
    'PUT',
    `/admin/clients/${clientId}/contract`,
    {
      can_create_station: true,
      max_stations: 1,
      can_manage_users: true,
      max_users: 3,
      features: {
        can_access_hr: false,
        modules: { hr: false },
        can_customize_signature: false
      }
    },
    { sid: null }
  );

  ok(r.s === 200, 'contrat configuré');
  ok(r.s === 200 && r.j?.max_stations === 1, 'max_stations=1');

  // Vérifier que le gérant créé pour le client peut se connecter.
  r = await call(
    'POST',
    '/auth/login',
    { login: gLogin, password: gPass },
    { token: null, sid: null }
  );

  ok(r.s === 200 && !!r.j?.token, 'login gérant');

  if (r.s !== 200 || !r.j?.token) {
    console.error('Connexion gérant impossible :', r.s, r.j);
    process.exit(1);
  }

  const gTok = r.j.token;

  const gMeResponse = await call(
    'GET',
    '/me',
    null,
    { token: gTok, sid: null }
  );

  const gMe = gMeResponse.j;
  ok(!!gMe?.contract && !gMe.contract.unrestricted, 'contrat attaché au /me');

  // Le gérant ne doit pas pouvoir modifier le contrat.
  r = await call(
    'PUT',
    `/admin/clients/${clientId}/contract`,
    { max_stations: 99 },
    { token: gTok, sid }
  );

  ok(r.s === 403, 'gérant ne modifie pas le contrat');

  // Une deuxième station doit être refusée lorsque la limite est à une station.
  r = await call(
    'POST',
    '/stations',
    { name: 'Extra ' + t, currency: 'FCFA' },
    { token: gTok, sid }
  );

  ok(r.s === 403, 'limite stations (2e refusée)');

  // Le module RH doit rester inaccessible sans autorisation.
  r = await call(
    'GET',
    '/hr/v2/dashboard',
    null,
    { token: gTok, sid }
  );

  ok(r.s === 403, 'RH refusé sans module');

  // Un gérant ne doit pas pouvoir s'attribuer les privilèges globaux ADMIN.
  r = await call(
    'POST',
    '/users',
    {
      login: 'hack' + t,
      password: gPass,
      role: 'ADMIN',
      is_global: true,
      station_ids: [sid]
    },
    { token: gTok, sid }
  );

  ok(r.s === 403, 'élévation ADMIN refusée');

  console.log(fails ? `\n✖ ${fails} échec(s)` : '\n✔ Contrats OK');
  process.exit(fails ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});