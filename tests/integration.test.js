// Tests d'intégration HTTP de bout en bout (Simule requêtes clients/mariés/admin)
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// Charger variables et app
require('dotenv').config();
process.env.ADMIN_PASSWORD = 'test-secret-password';
process.env.SESSION_SECRET = 'test-session-secret-random-32-chars';

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { q } = require('../src/db');
const utils = require('../src/utils');
const payments = require('../src/payments');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET));

app.use((req, res, next) => {
  Object.assign(res.locals, utils, {
    brand: 'Ndolo Invitations',
    businessWhatsapp: '237657664546',
    businessEmail: 'contact@ndolo.cm',
    baseUrl: 'http://127.0.0.1:3001',
    paymentMode: 'demo',
    path: req.path,
    flash: null,
  });
  next();
});

app.use('/admin', require('../src/routes/admin'));
app.use('/espace', require('../src/routes/couple'));
app.use('/', require('../src/routes/public'));

let server;
const PORT = 3001;
const BASE = `http://127.0.0.1:${PORT}`;

test.before(() => {
  return new Promise((resolve) => {
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

test('NIVEAU 2.1 — Consultation publique et cas d’erreur 404', async () => {
  // Page d'accueil
  const home = await request('/');
  assert.strictEqual(home.status, 200);
  assert.ok(home.body.includes('Votre faire-part de mariage'), 'Doit afficher la landing page');

  // Mariage démo existant
  const demo = await request('/i/demo');
  assert.strictEqual(demo.status, 200);
  assert.ok(demo.body.includes('Grâce'), 'Doit afficher le faire-part démo');

  // Slug inexistant -> 404
  const notFound = await request('/i/mariage-inconnu-inexistant-404');
  assert.strictEqual(notFound.status, 404);
  assert.ok(notFound.body.includes('Invitation introuvable'), 'Doit afficher une page 404 propre');
});

test('NIVEAU 2.2 — Tunnel RSVP complet (Nom, Présence, Livre d\'or)', async () => {
  // 1. Soumission RSVP présent
  const params = new URLSearchParams({
    name: 'Jean Eto\'o',
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

  // Doit rediriger vers /i/demo/merci?g=TOKEN
  assert.strictEqual(rsvpRes.status, 302);
  const location = rsvpRes.headers.get('location');
  assert.ok(location.includes('/merci?g='), 'Doit rediriger vers la page de remerciement');

  // Vérification en base avec paramètre préparé ?
  const guest = q.get('SELECT * FROM guests WHERE name = ? ORDER BY id DESC LIMIT 1', "Jean Eto'o");
  assert.ok(guest, 'L\'invité doit être enregistré en base');
  assert.strictEqual(guest.status, 'yes');
  assert.strictEqual(guest.attending_count, 2);

  // 2. Accès au Pass QR de cet invité
  const passRes = await request(`/i/demo/pass/${guest.token}`);
  assert.strictEqual(passRes.status, 200);
  assert.ok(passRes.body.includes('Pass d&#39;entrée') || passRes.body.includes('Pass d\'entrée') || passRes.body.includes('Pass'));
  assert.ok(passRes.body.includes('Jean Eto&#39;o') || passRes.body.includes("Jean Eto'o"), 'Le nom doit être rendu dans le pass');

  // Nettoyage de l'invité de test
  q.run('DELETE FROM guests WHERE id = ?', guest.id);
});

test('NIVEAU 2.3 — Tunnel Cagnotte MoMo / OM (Simulation Démo & Confirmation)', async () => {
  // 1. Démarrage d'une contribution
  const contribParams = new URLSearchParams({
    name: 'Parrain Marc',
    phone: '657664546',
    amount: '15000',
    message: 'Pour votre installation !',
  });

  const initRes = await request('/i/demo/cagnotte', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: contribParams.toString(),
  });

  assert.strictEqual(initRes.status, 302);
  const redirectUrl = initRes.headers.get('location');
  assert.ok(redirectUrl.includes('/paiement/demo?reference='), 'En mode démo, doit rediriger vers la page simulateur');

  // Extraire la référence
  const ref = new URL(redirectUrl, BASE).searchParams.get('reference');
  const contrib = q.get('SELECT * FROM contributions WHERE reference = ?', ref);
  assert.ok(contrib, 'La contribution doit être insérée en statut pending');
  assert.strictEqual(contrib.amount, 15000);
  assert.strictEqual(contrib.status, 'pending');

  // 2. Validation de la simulation démo (Résultat = ok)
  const validateParams = new URLSearchParams({
    reference: ref,
    result: 'ok',
  });
  const simuRes = await request('/paiement/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: validateParams.toString(),
  });

  assert.strictEqual(simuRes.status, 302);
  assert.ok(simuRes.headers.get('location').includes('/paiement/retour?reference='));

  // Vérifier passage à 'complete'
  const updatedContrib = q.get('SELECT * FROM contributions WHERE reference = ?', ref);
  assert.strictEqual(updatedContrib.status, 'complete', 'La contribution doit être validée');

  // Nettoyage
  q.run('DELETE FROM contributions WHERE id = ?', updatedContrib.id);
});

test('NIVEAU 2.4 — Espace Mariés : Protection d’accès & Check-in QR le jour J', async () => {
  const w = q.get("SELECT * FROM weddings WHERE slug = 'demo'");

  // 1. Tentative sans clé secrète -> doit demander le code
  const noKey = await request('/espace/demo');
  assert.strictEqual(noKey.status, 200);
  assert.ok(noKey.body.includes('Code d&#39;accès') || noKey.body.includes('Code d\'accès') || noKey.body.includes('Code'));

  // 2. Connexion avec mauvaise clé
  const badLogin = await request('/espace/demo/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'key=mauvais_code',
  });
  assert.strictEqual(badLogin.status, 200);
  assert.ok(badLogin.body.includes('Code incorrect'));

  // 3. Connexion légitime avec la bonne access_key
  const goodLogin = await request('/espace/demo/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `key=${w.access_key}`,
  });
  assert.strictEqual(goodLogin.status, 302);
  const cookieHeader = goodLogin.cookies.find(c => c.startsWith(`c${w.id}=`));
  assert.ok(cookieHeader, 'Doit déposer le cookie signé de session marié');
  const cookieVal = cookieHeader.split(';')[0];

  // 4. Test émargement / scan QR code le jour J
  // Créer un invité
  const token = 'test-token-checkin-99';
  q.run("INSERT INTO guests (wedding_id, name, seats, attending_count, status, token) VALUES (?, 'Invité VIP', 2, 2, 'yes', ?)", w.id, token);

  // Scanner le pass
  const checkinRes = await request(`/espace/demo/checkin/${token}`, {
    method: 'POST',
    headers: { 'Cookie': cookieVal },
  });
  assert.strictEqual(checkinRes.status, 302);

  const checkedGuest = q.get('SELECT * FROM guests WHERE token = ?', token);
  assert.ok(checkedGuest.checked_in_at, 'L\'invité doit être horodaté comme entré');

  // Scan doublon (déjà entré)
  const viewPassAgain = await request(`/espace/demo/checkin/${token}`, {
    headers: { 'Cookie': cookieVal },
  });
  assert.strictEqual(viewPassAgain.status, 200);
  assert.ok(viewPassAgain.body.includes('Déjà entré'), 'Doit alerter l\'accueil en cas de doublon/fraude');

  // Nettoyage
  q.run('DELETE FROM guests WHERE token = ?', token);
});
