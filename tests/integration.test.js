// Tests d'intégration HTTP de bout en bout (Simule requêtes clients/mariés/admin)
const test = require('node:test');
const assert = require('node:assert');

// Charger variables et app
require('dotenv').config();
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'test-secret-password';
process.env.ADMIN_ACCESS_KEY = 'test-device-key-stealth-99';
process.env.SESSION_SECRET = 'test-session-secret-random-32-chars';

const app = require('../server');
const { store } = require('../src/db');
const { createWedding, addGuest, addTable, ensureDemoSeeded } = require('../src/weddings');

let server;
const PORT = 3001;
const BASE = `http://127.0.0.1:${PORT}`;

test.before(async () => {
  await ensureDemoSeeded();
  await new Promise((resolve) => {
    server = app.listen(PORT, '127.0.0.1', () => resolve());
  });
});

test.after(() => {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
});

// Helper fetch HTTP
async function request(urlPath, options = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    redirect: 'manual',
    ...options,
  });
  const text = await res.text();
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, headers: res.headers, body: text, cookies };
}

test('NIVEAU 2.1 — Consultation publique, Healthcheck et cas d’erreur 404', async () => {
  const health = await request('/healthz');
  assert.strictEqual(health.status, 200);
  assert.ok(health.body.includes('"ok":true'), 'Le endpoint /healthz doit répondre ok: true');

  const gsc = await request('/google77ad2c934068be32.html');
  assert.strictEqual(gsc.status, 200);
  assert.strictEqual(gsc.body.trim(), 'google-site-verification: google77ad2c934068be32.html', 'Le fichier Google Search Console doit être servi exactement');

  const sitemap = await request('/sitemap.xml');
  assert.strictEqual(sitemap.status, 200);
  assert.ok(sitemap.body.includes('<urlset'), 'Le sitemap XML doit être généré pour Google Search Console');

  const home = await request('/');
  assert.strictEqual(home.status, 200);
  assert.ok(home.body.includes('Votre faire-part de mariage') || home.body.includes('Votre faire-part'), 'Doit afficher la landing page');
  assert.ok(home.body.includes('/confidentialite'), 'Doit contenir le lien vers la politique de confidentialité');

  const privacy = await request('/confidentialite');
  assert.strictEqual(privacy.status, 200);
  assert.ok(privacy.body.includes('Politique de confidentialité'), 'Doit afficher la politique de confidentialité');

  const demo = await request('/i/demo', {
    headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'www.ndolos.site' },
  });
  assert.strictEqual(demo.status, 200);
  assert.ok(demo.body.includes('Grâce'), 'Doit afficher le faire-part démo');
  assert.ok(demo.body.includes('content="https://www.ndolos.site/i/demo"'), 'og:url doit correspondre exactement au domaine www appelé sans boucle de redirection');
  assert.ok(demo.body.includes('content="https://www.ndolos.site/img/og-cover.jpg?v=3"'), 'og:image doit pointer vers le JPEG CDN direct sans redirection');

  const ogImg = await fetch(`${BASE}/img/og-cover.jpg?v=3`);
  assert.strictEqual(ogImg.status, 200);
  assert.ok((ogImg.headers.get('content-type') || '').includes('image/jpeg'), 'og-cover.jpg doit être servi en image/jpeg');

  const notFound = await request('/i/mariage-inconnu-inexistant-404');
  assert.strictEqual(notFound.status, 404);
  assert.ok(notFound.body.includes('Invitation introuvable'), 'Doit afficher une page 404 propre');
});

test('NIVEAU 2.2 — Tunnel RSVP contrôlé par la BD des mariés & Pass QR avec Table', async () => {
  const w = await store.getWeddingBySlug('demo');
  await store.updateWedding(w.id, { strict_rsvp: 1 });

  const table = await addTable(w.id, { name: 'Table Royale Wouri', capacity: 6, category: 'vip_marie' });

  const strangerParams = new URLSearchParams({
    name: 'Inconnu Incruste',
    phone: '699999999',
    attending: 'yes',
    count: '2',
  });
  const blockedRes = await request('/i/demo/rsvp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: strangerParams.toString(),
  });
  assert.strictEqual(blockedRes.status, 302);
  assert.ok(blockedRes.headers.get('location').includes('err=not_on_list'), 'Doit bloquer une personne hors liste des mariés');

  const invited = await addGuest(w.id, { name: "Jean Eto'o", phone: '657664546', seats: 2, category: 'vip_marie', table_id: table.id });

  const params = new URLSearchParams({
    token: invited.token,
    name: "Jean Eto'o",
    phone: '657664546',
    attending: 'yes',
    count: '2',
    message: 'Tous nos vœux de bonheur et de prospérité !',
  });

  const rsvpRes = await request('/i/demo/rsvp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  assert.strictEqual(rsvpRes.status, 302);
  const location = rsvpRes.headers.get('location');
  assert.ok(location.includes('/merci?g='), 'Doit rediriger vers la page de remerciement');

  const guest = await store.getGuestById(invited.id);
  assert.strictEqual(guest.status, 'yes');
  assert.strictEqual(guest.attending_count, 2);
  assert.strictEqual(guest.table_name, 'Table Royale Wouri');
  assert.ok(guest.seat_numbers, 'Doit attribuer des numéros de sièges');

  const passRes = await request(`/i/demo/pass/${guest.token}`);
  assert.strictEqual(passRes.status, 200);
  assert.ok(passRes.body.includes('Jean Eto&#39;o') || passRes.body.includes("Jean Eto'o"), "Le nom de l'invité doit être affiché sur le pass");
  assert.ok(passRes.body.includes('Table Royale Wouri'), 'Le nom de la table doit être affiché sur le pass');

  const svgRes = await request(`/i/demo/pass/${guest.token}/ticket.svg`);
  assert.strictEqual(svgRes.status, 200);
  assert.ok(svgRes.body.includes("Jean Eto'o"), "Le billet QR SVG doit contenir le nom de l'invité");
  assert.ok(svgRes.body.includes('TABLE ROYALE WOURI'), 'Le billet QR SVG doit contenir le nom de la table');

  await store.deleteGuest(guest.id, w.id);
  await store.deleteTableRow(w.id, table.id);
});

test('NIVEAU 2.3 — Tunnel Cagnotte MoMo / OM (USSD Direct & Validation Mariés)', async () => {
  const w = await store.getWeddingBySlug('demo');

  const contribParams = new URLSearchParams({
    name: 'Parrain Marc',
    phone: '657664546',
    amount: '15000',
    operator: 'momo',
    message: 'Pour votre installation !',
  });

  const initRes = await request('/i/demo/cagnotte', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: contribParams.toString(),
  });

  assert.strictEqual(initRes.status, 302);
  const redirectUrl = initRes.headers.get('location');
  assert.ok(redirectUrl.includes('ok=cagnotte_merci'), 'Doit rediriger vers le faire-part avec le message de remerciement');

  const ref = new URL(redirectUrl, BASE).searchParams.get('c');
  const contrib = await store.getContributionByRef(ref);
  assert.ok(contrib, 'La contribution doit être insérée en statut pending');
  assert.strictEqual(contrib.amount, 15000);
  assert.strictEqual(contrib.provider, 'momo');
  assert.strictEqual(contrib.status, 'pending');

  const viewSuccess = await request(`/i/demo?ok=cagnotte_merci&c=${ref}`);
  assert.strictEqual(viewSuccess.status, 200);
  assert.ok(viewSuccess.body.includes('Merci de tout'), 'Doit afficher la carte de remerciement pour le don');
  assert.ok(viewSuccess.body.includes('15 000 FCFA'), 'Doit mentionner le montant offert');

  const loginRes = await request('/espace/demo/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `key=${w.access_key}`,
  });
  const cookieHeader = loginRes.cookies.find((c) => c.startsWith(`c${w.id}=`));
  const cookieVal = cookieHeader.split(';')[0];

  const confirmRes = await request(`/espace/demo/cagnotte/${contrib.id}/confirm`, {
    method: 'POST',
    headers: { Cookie: cookieVal },
  });
  assert.strictEqual(confirmRes.status, 302);

  const updatedContrib = await store.getContributionById(contrib.id);
  assert.strictEqual(updatedContrib.status, 'complete', 'La contribution doit être validée par les mariés');

  await store.deleteContribution(updatedContrib.id, w.id);
});

test('NIVEAU 2.4 — Espace Mariés : Protection d’accès & Check-in QR le jour J', async () => {
  const w = await store.getWeddingBySlug('demo');

  const noKey = await request('/espace/demo');
  assert.strictEqual(noKey.status, 200);
  assert.ok(noKey.body.includes('Code d&#39;accès') || noKey.body.includes("Code d'accès") || noKey.body.includes('Code'));

  const badLogin = await request('/espace/demo/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'key=mauvais_code',
  });
  assert.strictEqual(badLogin.status, 200);
  assert.ok(badLogin.body.includes('Code incorrect'));

  const goodLogin = await request('/espace/demo/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `key=${w.access_key}`,
  });
  assert.strictEqual(goodLogin.status, 302);
  const cookieHeader = goodLogin.cookies.find((c) => c.startsWith(`c${w.id}=`));
  assert.ok(cookieHeader, 'Doit déposer le cookie signé de session marié');
  const cookieVal = cookieHeader.split(';')[0];

  const token = 'test-token-checkin-99';
  await store.insertGuest({
    wedding_id: w.id,
    name: 'Invité VIP',
    seats: 2,
    attending_count: 2,
    status: 'yes',
    token,
  });

  const checkinRes = await request(`/espace/demo/checkin/${token}`, {
    method: 'POST',
    headers: { Cookie: cookieVal },
  });
  assert.strictEqual(checkinRes.status, 302);

  const checkedGuest = await store.getGuestByToken(token, w.id);
  assert.ok(checkedGuest.checked_in_at, "L'invité doit être horodaté comme entré");

  const viewPassAgain = await request(`/espace/demo/checkin/${token}`, {
    headers: { Cookie: cookieVal },
  });
  assert.strictEqual(viewPassAgain.status, 200);
  assert.ok(viewPassAgain.body.includes('Pass déjà scanné') || viewPassAgain.body.includes('Déjà entré'), "Doit alerter l'accueil en cas de doublon/fraude");

  await store.deleteGuestByToken(token);
});

test("NIVEAU 2.5 — Modification des informations d'un invité (Nom, Téléphone, Places)", async () => {
  const w = await store.getWeddingBySlug('demo');

  const loginRes = await request('/espace/demo/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `key=${w.access_key}`,
  });
  const cookieHeader = loginRes.cookies.find((c) => c.startsWith(`c${w.id}=`));
  const cookieVal = cookieHeader.split(';')[0];

  const invited = await addGuest(w.id, { name: 'Paul Biya', phone: '655000000', seats: 1, category: 'famille_mariee' });

  const updateRes = await request(`/espace/demo/invites/${invited.id}/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieVal,
    },
    body: new URLSearchParams({
      name: 'Président Paul',
      phone: '657664546',
      seats: '3',
    }).toString(),
  });
  assert.strictEqual(updateRes.status, 302);
  assert.ok(updateRes.headers.get('location').includes('ok='), 'Doit rediriger avec message de succès');

  const updated = await store.getGuestById(invited.id);
  assert.strictEqual(updated.name, 'Président Paul');
  assert.strictEqual(updated.phone, '237657664546');
  assert.strictEqual(updated.seats, 3);

  await store.deleteGuest(invited.id, w.id);
});

test('NIVEAU 2.6 — Conformité CNIL (Bandeau cookies) & Protection Anti-Spam (Honeypot + Rate Limiting)', async () => {
  const { resetRateLimits } = require('../src/security');
  resetRateLimits();

  const home = await request('/');
  assert.strictEqual(home.status, 200);
  assert.ok(home.body.includes('Tout refuser') && home.body.includes('Tout accepter'), 'Doit afficher les boutons Accepter et Refuser');
  assert.ok(home.body.includes('Gérer mes cookies'), 'Doit inclure le lien pour modifier son choix plus tard');

  const beforeViews = (await store.getWeddingBySlug('demo')).views;
  await request('/i/demo');
  const afterNoConsent = (await store.getWeddingBySlug('demo')).views;
  assert.strictEqual(afterNoConsent, beforeViews, 'Ne doit pas incrémenter le compteur avant accord cookies');

  await request('/i/demo', { headers: { Cookie: 'ndolo_consent=accepted' } });
  const afterConsent = (await store.getWeddingBySlug('demo')).views;
  assert.strictEqual(afterConsent, beforeViews + 1, 'Doit incrémenter le compteur après accord explicite');

  const botRes = await request('/i/demo/cagnotte', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      name: 'SpamBot 3000',
      amount: '50000',
      operator: 'momo',
      website_url: 'http://spam-casino.example.com',
    }).toString(),
  });
  assert.strictEqual(botRes.status, 400, 'Doit rejeter immédiatement un robot qui remplit le champ piège');

  const allContribs = await store.listContributionsByWedding((await store.getWeddingBySlug('demo')).id);
  assert.strictEqual(allContribs.find((c) => c.name === 'SpamBot 3000'), undefined, 'Aucune donnée du robot ne doit être enregistrée en base');

  resetRateLimits();
  let lastStatus = 200;
  for (let i = 0; i < 16; i++) {
    const r = await request('/i/demo/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Inconnu', attending: 'no' }).toString(),
    });
    lastStatus = r.status;
  }
  assert.strictEqual(lastStatus, 429, "Doit bloquer avec HTTP 429 au-delà de la limite d'envois autorisée");
  resetRateLimits();
});

test('NIVEAU 2.7 — Offres 35k/50k & Verrouillage strict des fonctions Prestige VIP pour Essentielle', async () => {
  const { resetRateLimits } = require('../src/security');
  resetRateLimits();

  // 1. Page d'accueil : 2 formules claires (35 000 FCFA et 50 000 FCFA)
  const home = await request('/');
  assert.strictEqual(home.status, 200);
  assert.ok(home.body.includes('35 000 FCFA') && home.body.includes('50 000 FCFA'), 'Doit afficher les 2 offres à 35k et 50k FCFA');
  assert.ok(!home.body.includes('75 000 FCFA'), "Ne doit plus afficher l'ancienne 3e formule à 75k");

  // 2. Création d'un mariage en formule Essentielle (35 000 FCFA)
  const wEss = await createWedding({
    bride: 'Clarisse',
    groom: 'Patrick',
    slug: 'test-essentiel-lock',
    plan: 'essentiel',
    status: 'published',
    theme: 'custom', // doit retomber sur 'royal' car custom = Prestige VIP
  });
  assert.strictEqual(wEss.price, 35000);
  assert.strictEqual(wEss.strict_rsvp, 0, 'Essentielle doit ouvrir le RSVP public par défaut');
  assert.strictEqual(wEss.theme, 'royal', 'Le thème sur-mesure doit être réservé à Prestige VIP');

  try {
    // 3. RSVP public ouvert : un invité confirme librement, mais n'a accès ni aux tables ni au Pass QR
    const rsvpRes = await request(`/i/${wEss.slug}/rsvp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Invité Classique', phone: '691234567', attending: 'yes', count: '2' }).toString(),
    });
    assert.strictEqual(rsvpRes.status, 302);
    const merciUrl = rsvpRes.headers.get('location');
    const gToken = new URL(merciUrl, BASE).searchParams.get('g');

    const merciPage = await request(merciUrl);
    assert.strictEqual(merciPage.status, 200);
    assert.ok(!merciPage.body.includes('Voir mon Pass QR'), 'Pas de Pass QR pour la formule Essentielle');

    const passAttempt = await request(`/i/${wEss.slug}/pass/${gToken}`);
    assert.strictEqual(passAttempt.status, 302, "L'accès direct au Pass QR doit être bloqué en formule Essentielle");

    // 4. Connexion à l'espace mariés Essentielle -> les routes Prestige VIP sont verrouillées
    const loginRes = await request(`/espace/${wEss.slug}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `key=${wEss.access_key}`,
    });
    const cookieVal = loginRes.cookies.find((c) => c.startsWith(`c${wEss.id}=`)).split(';')[0];

    const dash = await request(`/espace/${wEss.slug}`, { headers: { Cookie: cookieVal } });
    assert.strictEqual(dash.status, 200);
    assert.ok(dash.body.includes('+15 000 FCFA'), "Doit afficher la carte d'upgrade vers Prestige VIP (+15 000 FCFA)");

    for (const [method, url, body] of [
      ['POST', `/espace/${wEss.slug}/tables`, 'name=TableVIP&capacity=10'],
      ['POST', `/espace/${wEss.slug}/invites`, 'name=Test&seats=2'],
      ['GET', `/espace/${wEss.slug}/export.csv`, null],
      ['GET', `/espace/${wEss.slug}/accueil`, null],
    ]) {
      const locked = await request(url, {
        method,
        headers: Object.assign({ Cookie: cookieVal }, body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        body: body || undefined,
      });
      assert.strictEqual(locked.status, 302, `La route Prestige ${url} doit rediriger quand le couple est en Essentielle`);
      assert.ok((locked.headers.get('location') || '').includes('prestige-upsell'), 'Doit rediriger vers #prestige-upsell');
    }

    // 5. Passage du couple en formule Prestige VIP -> déblocage immédiat !
    await store.updateWedding(wEss.id, { plan: 'prestige', price: 50000 });
    const unlockedCsv = await request(`/espace/${wEss.slug}/export.csv`, { headers: { Cookie: cookieVal } });
    assert.strictEqual(unlockedCsv.status, 200, "L'export Excel se débloque dès passage en Prestige VIP");
    const unlockedAccueil = await request(`/espace/${wEss.slug}/accueil`, { headers: { Cookie: cookieVal } });
    assert.strictEqual(unlockedAccueil.status, 200, 'Le mode accueil Jour J se débloque dès passage en Prestige VIP');
  } finally {
    await store.deleteWedding(wEss.id);
    resetRateLimits();
  }
});

test('NIVEAU 2.8 — Sécurité Admin : Zéro lien public, Mode Furtif 404, Clé d’appareil & Session HMAC révocable', async () => {
  const { resetRateLimits } = require('../src/security');
  resetRateLimits();

  // 1. Aucun lien /admin dans la landing page, la politique de confidentialité ou robots.txt
  const home = await request('/');
  assert.ok(!home.body.includes('/admin'), 'La landing page ne doit exposer aucun lien vers /admin');
  const priv = await request('/confidentialite');
  assert.ok(!priv.body.includes('/admin'), 'La page confidentialité ne doit exposer aucun lien vers /admin');
  const robots = await request('/robots.txt');
  assert.ok(!robots.body.includes('/admin'), 'robots.txt ne doit pas révéler le chemin /admin aux scanners');

  // 2. Sans clé d'appareil : /admin, /admin/login et POST /admin/login renvoient tous une vraie 404 furtive
  const stealthDash = await request('/admin');
  assert.strictEqual(stealthDash.status, 404, 'Visiteur sans clé doit recevoir 404 sur /admin');
  assert.ok(stealthDash.body.includes('Page introuvable'), 'La 404 furtive doit être identique aux 404 publiques');
  assert.strictEqual(stealthDash.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');

  const stealthLogin = await request('/admin/login');
  assert.strictEqual(stealthLogin.status, 404, 'Visiteur sans clé doit recevoir 404 sur /admin/login');

  const badKey = await request('/admin/login?key=mauvaise-cle');
  assert.strictEqual(badKey.status, 404, 'Mauvaise clé d’appareil doit renvoyer 404 sans indice');

  const stealthPost = await request('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=test-secret-password',
  });
  assert.strictEqual(stealthPost.status, 404, 'Même avec le bon mot de passe, un POST sans appareil autorisé reçoit 404');

  // 3. Déverrouillage avec la vraie clé d'appareil -> pose cookie signé adm_dev et retire ?key= de l'URL
  const unlock = await request('/admin?key=test-device-key-stealth-99');
  assert.strictEqual(unlock.status, 302);
  assert.strictEqual(unlock.headers.get('location'), '/admin/login', 'Doit rediriger proprement sans la clé dans l’URL');
  const devCookie = unlock.cookies.find((c) => c.startsWith('adm_dev='));
  assert.ok(devCookie && devCookie.includes('HttpOnly'), 'Doit déposer le cookie signé HttpOnly adm_dev');
  const devCookiePair = devCookie.split(';')[0];

  // 4. L'appareil autorisé voit maintenant le formulaire et peut s'authentifier
  const loginForm = await request('/admin/login', { headers: { Cookie: devCookiePair } });
  assert.strictEqual(loginForm.status, 200);
  assert.ok(loginForm.body.includes('Administration'));

  const wrongPass = await request('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: devCookiePair },
    body: 'password=mauvais-mot-de-passe',
  });
  assert.strictEqual(wrongPass.status, 401);
  assert.ok(wrongPass.body.includes('Mot de passe incorrect'));

  const goodPass = await request('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: devCookiePair },
    body: 'password=test-secret-password',
  });
  assert.strictEqual(goodPass.status, 302);
  assert.strictEqual(goodPass.headers.get('location'), '/admin');
  const admCookie = goodPass.cookies.find((c) => c.startsWith('adm=')).split(';')[0];
  const bothCookies = `${devCookiePair}; ${admCookie}`;

  const adminDash = await request('/admin', { headers: { Cookie: bothCookies } });
  assert.strictEqual(adminDash.status, 200, 'Accès accordé au dashboard avec appareil + session HMAC');

  // 5. Changement du ADMIN_PASSWORD -> révoque immédiatement le cookie de session existant !
  const prevPass = process.env.ADMIN_PASSWORD;
  try {
    process.env.ADMIN_PASSWORD = 'nouveau-mot-de-passe-2026';
    const afterRotate = await request('/admin', { headers: { Cookie: bothCookies } });
    assert.strictEqual(afterRotate.status, 302, 'L’ancien cookie de session doit être immédiatement invalidé après rotation du mot de passe');
  } finally {
    process.env.ADMIN_PASSWORD = prevPass;
    resetRateLimits();
  }
});
