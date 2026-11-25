// Tests unitaires et fonctionnels (Logique métier, Supabase Store, Storage CDN, Webhooks, Thèmes)
const assert = require('node:assert');
const test = require('node:test');
const crypto = require('crypto');

const U = require('../src/utils');
const {
  createWedding, addGuest, importGuests, stats,
  addTable, assignGuestToTable, autoAssignTables, getTablesWithOccupancy, recomputeTableSeats,
} = require('../src/weddings');
const payments = require('../src/payments');
const { store, createSupabaseStore } = require('../src/db');
const { getPublicMediaUrl, uploadToSupabaseStorage, deleteFromSupabaseStorage } = require('../src/supabase');

test('1. Normalisation des numéros de téléphone camerounais', () => {
  assert.strictEqual(U.normalizePhone('657664546'), '237657664546', 'Doit préfixer 237');
  assert.strictEqual(U.normalizePhone('+237 657 66 45 46'), '237657664546', 'Doit nettoyer espaces et +');
  assert.strictEqual(U.normalizePhone('00237657664546'), '237657664546', 'Doit gérer le 00');
  assert.strictEqual(U.normalizePhone(''), '', 'Doit gérer chaîne vide sans crasher');
  assert.strictEqual(U.normalizePhone(null), '', 'Doit gérer null sans crasher');
});

test('2. Création de faire-part et unicité du slug', async () => {
  const w1 = await createWedding({
    bride: 'TestBride',
    groom: 'TestGroom',
    slug: 'test-couple-unique',
  });
  assert.strictEqual(w1.slug, 'test-couple-unique');

  const w2 = await createWedding({
    bride: 'TestBride',
    groom: 'TestGroom',
    slug: 'test-couple-unique',
  });
  assert.strictEqual(w2.slug, 'test-couple-unique-2', 'Doit générer un slug incrémenté en cas de doublon');

  await store.deleteWedding(w1.id);
  await store.deleteWedding(w2.id);
});

test('3. Gestion des invités et calcul des statistiques (RSVP + Cagnotte)', async () => {
  const w = await createWedding({ bride: 'Alice', groom: 'Bob', slug: 'test-stats-wedding' });

  const g1 = await addGuest(w.id, { name: 'Invité 1', phone: '657664546', seats: 2 });
  assert.strictEqual(g1.seats, 2);
  assert.strictEqual(g1.status, 'pending');

  const count = await importGuests(w.id, 'Invité 2, 690112233, 3\nInvité 3; 677889900; 1\nLigne Invalide sans nom');
  assert.strictEqual(count, 3);

  await store.updateGuest(g1.id, { status: 'yes', attending_count: 2 });

  await store.insertContribution({
    wedding_id: w.id,
    name: 'Donateur',
    phone: '237657664546',
    amount: 25000,
    reference: 'ref-test-stats-01',
    status: 'complete',
  });

  const s = await stats(w.id);
  assert.strictEqual(s.guests.yes, 1);
  assert.strictEqual(s.guests.people, 2);
  assert.strictEqual(s.cagnotte.total, 25000);
  assert.strictEqual(s.cagnotte.count, 1);

  await store.deleteWedding(w.id);
});

test('4. Sécurité des webhooks Notch Pay (Validation de signature)', () => {
  const rawBody = JSON.stringify({ event: 'payment.complete', data: { amount: 50000 } });
  const hashKey = 'hsk_test_secret_12345';
  process.env.NOTCHPAY_WEBHOOK_HASH = hashKey;

  const validSignature = crypto.createHmac('sha256', hashKey).update(rawBody).digest('hex');
  const invalidSignature = 'faux_hash_signature_invalide';

  assert.strictEqual(payments.verifyWebhookSignature(rawBody, validSignature), true, 'Doit valider la bonne signature');
  assert.strictEqual(payments.verifyWebhookSignature(rawBody, invalidSignature), false, 'Doit rejeter une mauvaise signature');
  assert.strictEqual(payments.verifyWebhookSignature(rawBody, null), false, 'Doit rejeter une signature manquante');
});

test('5. Gestion des tables par intimité, placement auto et anti-surcharge', async () => {
  const w = await createWedding({ bride: 'Nadine', groom: 'Samuel', slug: 'test-tables-wedding', max_guests: 20 });

  const tVip = await addTable(w.id, { name: 'Table Baham VIP', capacity: 4, category: 'vip_mariee' });
  const tAmis = await addTable(w.id, { name: 'Table Kribi Amis', capacity: 4, category: 'amis' });

  const g1 = await addGuest(w.id, { name: 'M. & Mme Njoya', phone: '690001122', seats: 2, category: 'vip_mariee', table_id: 'auto' });
  assert.strictEqual(g1.table_name, 'Table Baham VIP');
  assert.strictEqual(g1.seat_numbers, '1-2');

  const g2 = await addGuest(w.id, { name: 'Famille Kamga', phone: '690003344', seats: 3, category: 'vip_mariee', table_id: 'auto' });
  assert.strictEqual(g2.table_id, null, "Ne doit pas surcharger une table qui n'a que 2 places libres");

  const forced = await assignGuestToTable(w.id, g2.id, tVip.id);
  assert.strictEqual(forced.ok, false, 'Doit bloquer le dépassement de capacité de la table');

  const g3 = await addGuest(w.id, { name: 'Cédric & Laura', phone: '677112233', seats: 2, category: 'amis', table_id: 'none' });
  const resAuto = await autoAssignTables(w.id);
  assert.strictEqual(resAuto.placed, 1);
  const g3Updated = await store.getGuestById(g3.id);
  assert.strictEqual(g3Updated.table_name, 'Table Kribi Amis');
  assert.strictEqual(g3Updated.seat_numbers, '1-2');

  await store.updateGuest(g1.id, { status: 'no', attending_count: 0 });
  await recomputeTableSeats(tVip.id);
  const tablesAfter = await getTablesWithOccupancy(w.id);
  const vipAfter = tablesAfter.find((t) => t.id === tVip.id);
  assert.strictEqual(vipAfter.occupied, 0);
  assert.strictEqual(vipAfter.free, 4);
  assert.ok(tAmis.id);

  await store.deleteWedding(w.id);
});

test('6. Moteur colorimétrique de thème sur-mesure (contraste automatique)', () => {
  const lightStyle = U.customThemeStyle({ theme: 'custom', custom_bg: '#fdf8f4', custom_accent: '#c85a32' });
  assert.ok(lightStyle.includes('--bg:#fdf8f4'), 'Doit injecter le fond clair choisi');
  assert.ok(lightStyle.includes('--accent:#c85a32'), "Doit injecter la couleur d'accent choisie");
  assert.ok(lightStyle.includes('--text:#221b16'), 'Doit choisir automatiquement un texte sombre sur fond clair');

  const darkStyle = U.customThemeStyle({ theme: 'custom', custom_bg: '#0c1629', custom_accent: '#d4af37' });
  assert.ok(darkStyle.includes('--bg:#0c1629'), 'Doit injecter le fond sombre choisi');
  assert.ok(darkStyle.includes('--text:#f5f0e6'), 'Doit choisir automatiquement un texte ivoire sur fond sombre');
});

test('7. Driver Supabase PostgreSQL & Supabase Storage CDN (Vercel Serverless)', async () => {
  // Simulation d'un client @supabase/supabase-js en mémoire pour tester 100% du driver Supabase
  const tables = { weddings: [], guests: [], contributions: [] };
  let autoId = 1;

  function makeQuery(tableName) {
    let filters = [];
    let pendingAction = 'select';
    let payload = null;
    let limitN = null;

    const builder = {
      select() { return builder; },
      insert(row) { pendingAction = 'insert'; payload = row; return builder; },
      update(patch) { pendingAction = 'update'; payload = patch; return builder; },
      delete() { pendingAction = 'delete'; return builder; },
      eq(col, val) { filters.push((r) => r[col] === val); return builder; },
      neq(col, val) { filters.push((r) => r[col] !== val); return builder; },
      is(col, val) { filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return builder; },
      order() { return builder; },
      limit(n) { limitN = n; return builder; },
      async single() {
        const res = await builder.exec();
        return { data: res.data[0] || null, error: null };
      },
      async maybeSingle() {
        const res = await builder.exec();
        return { data: res.data[0] || null, error: null };
      },
      async exec() {
        const arr = tables[tableName];
        if (pendingAction === 'insert') {
          const row = { id: autoId++, views: 0, ...payload };
          arr.push(row);
          return { data: [row], error: null };
        }
        const matched = arr.filter((r) => filters.every((fn) => fn(r)));
        if (pendingAction === 'update') {
          matched.forEach((r) => Object.assign(r, payload));
          return { data: matched, error: null };
        }
        if (pendingAction === 'delete') {
          tables[tableName] = arr.filter((r) => !filters.every((fn) => fn(r)));
          return { data: matched, error: null };
        }
        return { data: limitN ? matched.slice(0, limitN) : matched, error: null };
      },
      then(resolve, reject) { return builder.exec().then(resolve, reject); },
    };
    return builder;
  }

  const uploadedFiles = new Map();
  const mockSupabaseClient = {
    from: (t) => makeQuery(t),
    storage: {
      getBucket: async () => ({ data: { id: 'uploads', public: true }, error: null }),
      from: () => ({
        upload: async (name, buf) => { uploadedFiles.set(name, buf); return { data: { path: name }, error: null }; },
        remove: async (names) => { names.forEach((n) => uploadedFiles.delete(n)); return { data: names, error: null }; },
      }),
    },
  };

  const supaStore = createSupabaseStore(mockSupabaseClient);
  assert.strictEqual(supaStore.mode, 'supabase');

  const w = await supaStore.insertWedding({ slug: 'supa-test', bride: 'Amina', groom: 'Lionel', status: 'published', access_key: 'secret123' });
  assert.strictEqual(w.bride, 'Amina');
  await supaStore.incrementWeddingViews(w.id, w.views);
  const wAfter = await supaStore.getWeddingBySlug('supa-test');
  assert.strictEqual(wAfter.views, 1);

  const g = await supaStore.insertGuest({ wedding_id: w.id, name: 'Éric Mboua', phone: '237699001122', token: 'tok99', status: 'yes' });
  const foundByCase = await supaStore.findGuestForRsvp(w.id, { name: '  éric mboua  ' });
  assert.strictEqual(foundByCase.id, g.id, 'Doit retrouver un invité sans sensibilité à la casse ni aux espaces');

  await supaStore.checkinGuest('tok99', w.id);
  const checked = await supaStore.getGuestByToken('tok99', w.id);
  assert.ok(checked.checked_in_at && checked.checked_in_at.length === 19, 'Horodatage compatible avec slice(11, 16)');

  // Test génération d'URL CDN Supabase Storage
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://projetdemo.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  try {
    const cdnUrl = await uploadToSupabaseStorage('mariage-photo.webp', Buffer.from('webpdata'), 'image/webp', mockSupabaseClient);
    assert.strictEqual(cdnUrl, 'https://projetdemo.supabase.co/storage/v1/object/public/uploads/mariage-photo.webp');
    assert.strictEqual(getPublicMediaUrl('mariage-photo.webp'), cdnUrl);
    await deleteFromSupabaseStorage(cdnUrl, mockSupabaseClient);
    assert.strictEqual(uploadedFiles.has('mariage-photo.webp'), false, 'La photo doit être supprimée du bucket Supabase');
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }

  // Vérifier que le point d'entrée Vercel api/index.js s'exporte sans démarrer de port TCP
  const vercelHandler = require('../api/index');
  assert.strictEqual(typeof vercelHandler, 'function', 'api/index.js doit exporter une fonction Express compatible Vercel');
});
