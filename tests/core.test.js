// Test de validation unitaire et fonctionnelle (hors Happy Path)
const assert = require('node:assert');
const test = require('node:test');

const path = require('path');
const U = require('../src/utils');
const {
  createWedding, addGuest, importGuests, stats,
  addTable, assignGuestToTable, autoAssignTables, getTablesWithOccupancy, recomputeTableSeats,
} = require('../src/weddings');
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

test('5. Gestion des tables par intimité, placement auto et anti-surcharge', () => {
  const w = createWedding({ bride: 'Nadine', groom: 'Samuel', slug: 'test-tables-wedding', max_guests: 20 });

  // Les mariés créent leurs tables avec leurs noms et capacités
  const tVip = addTable(w.id, { name: 'Table Baham VIP', capacity: 4, category: 'vip_mariee' });
  const tAmis = addTable(w.id, { name: 'Table Kribi Amis', capacity: 4, category: 'amis' });

  // Ajout d'un couple VIP de 2 places -> auto-placé sur Table Baham VIP (Sièges 1-2)
  const g1 = addGuest(w.id, { name: 'M. & Mme Njoya', phone: '690001122', seats: 2, category: 'vip_mariee', table_id: 'auto' });
  assert.strictEqual(g1.table_name, 'Table Baham VIP');
  assert.strictEqual(g1.seat_numbers, '1-2');

  // Ajout d'une famille VIP de 3 places -> dépasse la capacité restante (2 places libres sur 4) -> ne doit pas surcharger
  const g2 = addGuest(w.id, { name: 'Famille Kamga', phone: '690003344', seats: 3, category: 'vip_mariee', table_id: 'auto' });
  assert.strictEqual(g2.table_id, null, 'Ne doit pas surcharger une table qui n\'a que 2 places libres');

  // Tentative de forcer manuellement g2 sur tVip -> doit retourner une erreur
  const forced = assignGuestToTable(w.id, g2.id, tVip.id);
  assert.strictEqual(forced.ok, false, 'Doit bloquer le dépassement de capacité de la table');

  // Ajout d'un ami (2 places) sans table puis autoAssignTables
  const g3 = addGuest(w.id, { name: 'Cédric & Laura', phone: '677112233', seats: 2, category: 'amis', table_id: 'none' });
  const resAuto = autoAssignTables(w.id);
  assert.strictEqual(resAuto.placed, 1);
  const g3Updated = q.get('SELECT * FROM guests WHERE id = ?', g3.id);
  assert.strictEqual(g3Updated.table_name, 'Table Kribi Amis');
  assert.strictEqual(g3Updated.seat_numbers, '1-2');

  // Si M. & Mme Njoya déclinent (status = 'no'), leurs 2 places sur Table Baham VIP se libèrent
  q.run("UPDATE guests SET status = 'no', attending_count = 0 WHERE id = ?", g1.id);
  recomputeTableSeats(tVip.id);
  const tablesAfter = getTablesWithOccupancy(w.id);
  const vipAfter = tablesAfter.find((t) => t.id === tVip.id);
  assert.strictEqual(vipAfter.occupied, 0);
  assert.strictEqual(vipAfter.free, 4);

  q.run('DELETE FROM weddings WHERE id = ?', w.id);
});
