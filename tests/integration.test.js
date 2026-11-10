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
const { addGuest, addTable } = require('../src/weddings');

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
    flashError: null,
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

test('NIVEAU 2.2 — Tunnel RSVP contrôlé par la BD des mariés & Pass QR avec Table', async () => {
  const w = q.get("SELECT * FROM weddings WHERE slug = 'demo'");
  q.run('UPDATE weddings SET strict_rsvp = 1 WHERE id = ?', w.id);

  // Créer une table personnalisée pour le test
  const table = addTable(w.id, { name: 'Table Royale Wouri', capacity: 6, category: 'vip_marie' });

  // 1. Tentative d'incruste d'une personne NON enregistrée par les mariés -> doit être bloquée
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

  // 2. Les mariés ajoutent leur invité dans la BD
  const invited = addGuest(w.id, { name: "Jean Eto'o", phone: '657664546', seats: 2, category: 'vip_marie', table_id: table.id });

  // 3. L'invité enregistré confirme sa présence
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

  const guest = q.get('SELECT * FROM guests WHERE id = ?', invited.id);
  assert.strictEqual(guest.status, 'yes');
  assert.strictEqual(guest.attending_count, 2);
  assert.strictEqual(guest.table_name, 'Table Royale Wouri');
  assert.ok(guest.seat_numbers, 'Doit attribuer des numéros de sièges');

  // 4. Accès au Pass QR et au billet SVG (Nom de l'invité + Nom de la Table)
  const passRes = await request(`/i/demo/pass/${guest.token}`);
  assert.strictEqual(passRes.status, 200);
  assert.ok(passRes.body.includes('Jean Eto&#39;o') || passRes.body.includes("Jean Eto'o"), 'Le nom de l\'invité doit être affiché sur le pass');
  assert.ok(passRes.body.includes('Table Royale Wouri'), 'Le nom de la table doit être affiché sur le pass');

  const svgRes = await request(`/i/demo/pass/${guest.token}/ticket.svg`);
  assert.strictEqual(svgRes.status, 200);
  assert.ok(svgRes.body.includes("Jean Eto'o"), 'Le billet QR SVG doit contenir le nom de l\'invité');
  assert.ok(svgRes.body.includes('TABLE ROYALE WOURI'), 'Le billet QR SVG doit contenir le nom de la table');

  // Nettoyage
  q.run('DELETE FROM guests WHERE id = ?', guest.id);
  q.run('DELETE FROM wedding_tables WHERE id = ?', table.id);
});

test('NIVEAU 2.3 — Tunnel Cagnotte MoMo / OM (USSD Direct & Validation Mariés)', async () => {
  const w = q.get("SELECT * FROM weddings WHERE slug = 'demo'");

  // 1. Déclaration d'un don direct par un invité via le code USSD MoMo
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

  // Extraire la référence
  const ref = new URL(redirectUrl, BASE).searchParams.get('c');
  const contrib = q.get('SELECT * FROM contributions WHERE reference = ?', ref);
  assert.ok(contrib, 'La contribution doit être insérée en statut pending');
  assert.strictEqual(contrib.amount, 15000);
  assert.strictEqual(contrib.provider, 'momo');
  assert.strictEqual(contrib.status, 'pending');

  // 2. Affichage du message de confirmation et bouton WhatsApp sur le faire-part
  const viewSuccess = await request(`/i/demo?ok=cagnotte_merci&c=${ref}`);
  assert.strictEqual(viewSuccess.status, 200);
  assert.ok(viewSuccess.body.includes('Merci de tout'), 'Doit afficher la carte de remerciement pour le don');
  assert.ok(viewSuccess.body.includes('15 000 FCFA'), 'Doit mentionner le montant offert');

  // 3. Les mariés valident la réception du don dans leur espace
  const loginRes = await request('/espace/demo/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `key=${w.access_key}`,
  });
  const cookieHeader = loginRes.cookies.find(c => c.startsWith(`c${w.id}=`));
  const cookieVal = cookieHeader.split(';')[0];

  const confirmRes = await request(`/espace/demo/cagnotte/${contrib.id}/confirm`, {
    method: 'POST',
    headers: { 'Cookie': cookieVal },
  });
  assert.strictEqual(confirmRes.status, 302);

  // Vérifier passage à 'complete'
  const updatedContrib = q.get('SELECT * FROM contributions WHERE id = ?', contrib.id);
  assert.strictEqual(updatedContrib.status, 'complete', 'La contribution doit être validée par les mariés');

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
  assert.ok(viewPassAgain.body.includes('Pass déjà scanné') || viewPassAgain.body.includes('Déjà entré'), 'Doit alerter l\'accueil en cas de doublon/fraude');

  // Nettoyage
  q.run('DELETE FROM guests WHERE token = ?', token);
});
