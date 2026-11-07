// Test de validation unitaire et fonctionnelle (hors Happy Path)
const assert = require('node:assert');
const test = require('node:test');

const path = require('path');
const U = require('../src/utils');
const { createWedding, addGuest, importGuests, stats } = require('../src/weddings');
const payments = require('../src/payments');
const { q } = require('../src/db');

test('1. Normalisation des numéros de téléphone camerounais', () => {
  assert.strictEqual(U.normalizePhone('657664546'), '237657664546', 'Doit préfixer 237');
  assert.strictEqual(U.normalizePhone('+237 657 66 45 46'), '237657664546', 'Doit nettoyer espaces et +');
  assert.strictEqual(U.normalizePhone('00237657664546'), '237657664546', 'Doit gérer le 00');
  assert.strictEqual(U.normalizePhone(''), '', 'Doit gérer chaîne vide sans crasher');
  assert.strictEqual(U.normalizePhone(null), '', 'Doit gérer null sans crasher');
});

test('2. Création de faire-part et unicité du slug', () => {
  const w1 = createWedding({
    bride: 'TestBride',
    groom: 'TestGroom',
    slug: 'test-couple-unique'
  });
  assert.strictEqual(w1.slug, 'test-couple-unique');

  // Conflit volontaire de slug
  const w2 = createWedding({
    bride: 'TestBride',
    groom: 'TestGroom',
    slug: 'test-couple-unique'
  });
  assert.strictEqual(w2.slug, 'test-couple-unique-2', 'Doit générer un slug incrémenté en cas de doublon');

  // Nettoyage
  q.run('DELETE FROM weddings WHERE id IN (?, ?)', w1.id, w2.id);
});

test('3. Gestion des invités et calcul des statistiques (RSVP + Cagnotte)', () => {
  const w = createWedding({ bride: 'Alice', groom: 'Bob', slug: 'test-stats-wedding' });

  // Ajout direct
  const g1 = addGuest(w.id, { name: 'Invité 1', phone: '657664546', seats: 2 });
  assert.strictEqual(g1.seats, 2);
  assert.strictEqual(g1.status, 'pending');

  // Import textuel (formats multiples)
  const count = importGuests(w.id, 'Invité 2, 690112233, 3\nInvité 3; 677889900; 1\nLigne Invalide sans nom');
  assert.strictEqual(count, 3);

  // Simulation réponse RSVP
  q.run("UPDATE guests SET status = 'yes', attending_count = 2 WHERE id = ?", g1.id);

  // Simulation don cagnotte
  q.run(`INSERT INTO contributions (wedding_id, name, phone, amount, reference, status)
         VALUES (?, 'Donateur', '237657664546', 25000, 'ref-test-stats-01', 'complete')`, w.id);

  const s = stats(w.id);
  assert.strictEqual(s.guests.yes, 1);
  assert.strictEqual(s.guests.people, 2);
  assert.strictEqual(s.cagnotte.total, 25000);
  assert.strictEqual(s.cagnotte.count, 1);

  // Nettoyage
  q.run('DELETE FROM weddings WHERE id = ?', w.id);
});

test('4. Sécurité des webhooks Notch Pay (Validation de signature)', () => {
  const rawBody = JSON.stringify({ event: 'payment.complete', data: { amount: 50000 } });
  const hashKey = 'hsk_test_secret_12345';
  process.env.NOTCHPAY_WEBHOOK_HASH = hashKey;

  const crypto = require('crypto');
  const validSignature = crypto.createHmac('sha256', hashKey).update(rawBody).digest('hex');
  const invalidSignature = 'faux_hash_signature_invalide';

  assert.strictEqual(payments.verifyWebhookSignature(rawBody, validSignature), true, 'Doit valider la bonne signature');
  assert.strictEqual(payments.verifyWebhookSignature(rawBody, invalidSignature), false, 'Doit rejeter une mauvaise signature');
  assert.strictEqual(payments.verifyWebhookSignature(rawBody, null), false, 'Doit rejeter une signature manquante');
});
