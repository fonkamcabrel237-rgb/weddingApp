// Logique métier partagée (compatible Supabase PostgreSQL & SQLite local) :
// création de faire-part, invités, tables, placement automatique, cagnotte.
const { store, nowStr } = require('./db');
const { slugify, token, normalizePhone, sanitizeHex, PLANS, normalizePlan, isPrestige, GUEST_CATEGORIES } = require('./utils');

async function uniqueSlug(base) {
  const root = slugify(base) || 'mariage';
  let slug = root;
  let i = 1;
  while (await store.getWeddingBySlug(slug)) {
    slug = `${root}-${++i}`;
  }
  return slug;
}

async function createWedding(data) {
  const plan = normalizePlan(data.plan);
  const prestige = isPrestige(plan);
  const slug = await uniqueSlug(data.slug || `${data.bride}-et-${data.groom}`);
  const maxGuests = Math.max(10, Math.min(5000, parseInt(data.max_guests, 10) || 200));
  const requestedTheme = data.theme || 'royal';
  const safeTheme = !prestige && requestedTheme === 'custom' ? 'royal' : requestedTheme;
  const safeStrictRsvp = !prestige
    ? 0
    : (data.strict_rsvp === undefined ? 1 : Number(Boolean(data.strict_rsvp)));

  return store.insertWedding({
    slug,
    status: data.status || 'draft',
    plan,
    price: Number(data.price) || PLANS[plan].price,
    paid: data.paid ? 1 : 0,
    partner: data.partner || null,
    partner_commission: Number(data.partner_commission) || 0,
    event_type: data.event_type || 'mariage',
    bride: String(data.bride || '').trim(),
    groom: String(data.groom || '').trim(),
    headline: data.headline || 'Nous nous disons OUI !',
    story: data.story || null,
    hashtag: data.hashtag || null,
    event_date: data.event_date || null,
    venue_name: data.venue_name || null,
    venue_address: data.venue_address || null,
    city: data.city || null,
    maps_query: data.maps_query || null,
    program: JSON.stringify(data.program || []),
    dress_code: data.dress_code || null,
    theme: safeTheme,
    custom_bg: sanitizeHex(data.custom_bg, '#faf6f0'),
    custom_accent: sanitizeHex(data.custom_accent, '#b8913f'),
    music_url: data.music_url || null,
    rsvp_deadline: data.rsvp_deadline || null,
    couple_phone: normalizePhone(data.couple_phone) || null,
    couple_email: data.couple_email || null,
    cagnotte_enabled: data.cagnotte_enabled === undefined ? 1 : (data.cagnotte_enabled ? 1 : 0),
    cagnotte_goal: Number(data.cagnotte_goal) || 0,
    cagnotte_text: data.cagnotte_text || null,
    momo_number: normalizePhone(data.momo_number) || null,
    momo_name: data.momo_name || null,
    om_number: normalizePhone(data.om_number) || null,
    om_name: data.om_name || null,
    max_guests: maxGuests,
    strict_rsvp: safeStrictRsvp,
    access_key: data.access_key || token(12),
    lead_id: data.lead_id || null,
  });
}

// Nombre de chaises réellement occupées/réservées par un invité
function guestActiveSeats(g) {
  if (!g || g.status === 'no') return 0;
  if (g.status === 'yes') return Math.max(1, Number(g.attending_count) || Number(g.seats) || 1);
  return Math.max(1, Number(g.seats) || 1);
}

// Recalcule les numéros de sièges (ex: "1-2", "3") pour tous les invités actifs d'une table
async function recomputeTableSeats(tableId) {
  if (!tableId) return;
  const table = await store.getTableById(tableId);
  if (!table) {
    await store.clearTableGuests(tableId);
    return;
  }
  await store.clearTableGuests(tableId, { onlyDeclined: true });

  const allGuests = await store.listGuestsByWedding(table.wedding_id);
  const guests = allGuests
    .filter((g) => g.table_id === table.id && g.status !== 'no')
    .sort((a, b) => {
      const sA = a.status === 'yes' ? 0 : 1;
      const sB = b.status === 'yes' ? 0 : 1;
      return sA !== sB ? sA - sB : a.id - b.id;
    });

  let cursor = 1;
  for (const g of guests) {
    const count = guestActiveSeats(g);
    const start = cursor;
    const end = cursor + count - 1;
    const label = start === end ? `${start}` : `${start}-${end}`;
    cursor = end + 1;
    await store.updateGuest(g.id, { table_name: table.name, seat_numbers: label });
  }
}

async function addTable(weddingId, { name, capacity, category }) {
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cleanName) return null;
  const cap = Math.max(1, Math.min(50, parseInt(capacity, 10) || 10));
  const cat = GUEST_CATEGORIES[category] ? category : 'famille_mariee';
  const existing = await store.listTablesByWedding(weddingId);
  const maxPos = existing.reduce((m, t) => Math.max(m, t.position || 0), 0);
  return store.insertTable({
    wedding_id: Number(weddingId),
    name: cleanName,
    capacity: cap,
    category: cat,
    position: maxPos + 1,
  });
}

async function deleteTable(weddingId, tableId) {
  await store.clearTableGuests(tableId, { weddingId });
  await store.deleteTableRow(weddingId, tableId);
}

async function getTablesWithOccupancy(weddingId) {
  const [tables, allGuests] = await Promise.all([
    store.listTablesByWedding(weddingId),
    store.listGuestsByWedding(weddingId),
  ]);
  const guests = allGuests.filter((g) => g.table_id != null && g.status !== 'no');
  const byTable = new Map();
  for (const t of tables) byTable.set(t.id, []);
  for (const g of guests) {
    if (byTable.has(g.table_id)) byTable.get(g.table_id).push(g);
  }
  return tables.map((t) => {
    const list = byTable.get(t.id) || [];
    const occupied = list.reduce((acc, g) => acc + guestActiveSeats(g), 0);
    const confirmed = list.reduce((acc, g) => acc + (g.status === 'yes' ? guestActiveSeats(g) : 0), 0);
    const checkedIn = list.reduce((acc, g) => acc + (g.checked_in_at ? guestActiveSeats(g) : 0), 0);
    return {
      ...t,
      guests: list,
      occupied,
      confirmed,
      checkedIn,
      free: Math.max(0, t.capacity - occupied),
    };
  });
}

const FALLBACK_CATEGORIES = {
  vip_mariee: ['famille_mariee', 'honneur'],
  famille_mariee: ['vip_mariee'],
  vip_marie: ['famille_marie', 'honneur'],
  famille_marie: ['vip_marie'],
  honneur: ['vip_mariee', 'vip_marie'],
  amis: ['collegues', 'association'],
  collegues: ['amis', 'association'],
  association: ['amis', 'collegues'],
};

async function assignGuestToTable(weddingId, guestId, targetTableId) {
  const guest = await store.getGuestById(guestId, weddingId);
  if (!guest) return { ok: false, error: 'Invité introuvable.' };
  const oldTableId = guest.table_id;

  if (!targetTableId || targetTableId === 'none') {
    await store.updateGuest(guest.id, { table_id: null, table_name: null, seat_numbers: null });
    if (oldTableId) await recomputeTableSeats(oldTableId);
    return { ok: true, table: null };
  }

  if (guest.status === 'no') {
    await store.updateGuest(guest.id, { table_id: null, table_name: null, seat_numbers: null });
    if (oldTableId) await recomputeTableSeats(oldTableId);
    return { ok: false, error: "Cet invité a décliné l'invitation." };
  }

  const needed = guestActiveSeats(guest);
  const tables = await getTablesWithOccupancy(weddingId);

  let chosen = null;
  if (targetTableId === 'auto') {
    const cat = guest.category || 'famille_mariee';
    chosen = tables.find((t) => t.category === cat && (t.id === oldTableId ? t.free + needed : t.free) >= needed);
    if (!chosen) {
      const fallbacks = FALLBACK_CATEGORIES[cat] || [];
      for (const fb of fallbacks) {
        chosen = tables.find((t) => t.category === fb && (t.id === oldTableId ? t.free + needed : t.free) >= needed);
        if (chosen) break;
      }
    }
    if (!chosen) {
      return { ok: false, error: "Aucune table compatible n'a assez de places libres." };
    }
  } else {
    const tid = Number(targetTableId);
    chosen = tables.find((t) => t.id === tid);
    if (!chosen) return { ok: false, error: 'Table introuvable.' };
    const available = chosen.id === oldTableId ? chosen.free + needed : chosen.free;
    if (available < needed) {
      return { ok: false, error: `La table « ${chosen.name} » n'a plus assez de places (${chosen.occupied}/${chosen.capacity} occupées).` };
    }
  }

  await store.updateGuest(guest.id, { table_id: chosen.id, table_name: chosen.name });
  if (oldTableId && oldTableId !== chosen.id) await recomputeTableSeats(oldTableId);
  await recomputeTableSeats(chosen.id);
  return { ok: true, table: chosen };
}

async function autoAssignTables(weddingId) {
  const allGuests = await store.listGuestsByWedding(weddingId);
  const unassigned = allGuests
    .filter((g) => g.status !== 'no' && g.table_id == null)
    .sort((a, b) => {
      const sA = a.status === 'yes' ? 0 : 1;
      const sB = b.status === 'yes' ? 0 : 1;
      if (sA !== sB) return sA - sB;
      if ((b.seats || 1) !== (a.seats || 1)) return (b.seats || 1) - (a.seats || 1);
      return a.id - b.id;
    });

  let placed = 0;
  let unplaced = 0;
  for (const g of unassigned) {
    const res = await assignGuestToTable(weddingId, g.id, 'auto');
    if (res.ok) placed++;
    else unplaced++;
  }
  return { placed, unplaced };
}

async function addGuest(weddingId, { name, phone, seats, category, table_id, source }) {
  const t = token(8);
  const cleanSeats = Math.max(1, Math.min(20, parseInt(seats, 10) || 1));
  const cat = GUEST_CATEGORIES[category] ? category : 'famille_mariee';
  const guest = await store.insertGuest({
    wedding_id: Number(weddingId),
    name: String(name).trim().slice(0, 120),
    phone: normalizePhone(phone) || null,
    seats: cleanSeats,
    category: cat,
    token: t,
    source: source || 'list',
  });
  if (table_id && table_id !== 'none') {
    await assignGuestToTable(weddingId, guest.id, table_id);
  }
  return store.getGuestById(guest.id);
}

async function importGuests(weddingId, text, defaultCategory = 'famille_mariee') {
  let added = 0;
  const w = await store.getWeddingById(weddingId);
  const maxGuests = w?.max_guests || 200;
  let currentSeats = (await stats(weddingId)).guests.activeSeats;

  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split(/[;,\t]/).map((s) => s.trim());
    if (!parts[0] || /^nom$/i.test(parts[0])) continue;
    const reqSeats = Math.max(1, Math.min(20, parseInt(parts[2], 10) || 1));
    if (currentSeats + reqSeats > maxGuests) break;
    const cat = GUEST_CATEGORIES[parts[3]] ? parts[3] : defaultCategory;
    await addGuest(weddingId, { name: parts[0], phone: parts[1], seats: reqSeats, category: cat, table_id: 'auto' });
    currentSeats += reqSeats;
    added++;
  }
  return added;
}

function computeStatsFromRows(wedding, guests, tables, contributions) {
  const maxGuests = wedding?.max_guests || 200;
  let yes = 0;
  let no = 0;
  let pending = 0;
  let people = 0;
  let seatsInvited = 0;
  let activeSeats = 0;
  let seatedSeats = 0;
  let unseatedSeats = 0;
  let checkedIn = 0;

  for (const g of guests || []) {
    if (g.status === 'yes') {
      yes++;
      people += Number(g.attending_count) || 0;
    } else if (g.status === 'no') {
      no++;
    } else {
      pending++;
    }
    seatsInvited += Number(g.seats) || 0;
    const active = g.status === 'no' ? 0 : (g.status === 'yes' ? (Number(g.attending_count) || 0) : (Number(g.seats) || 0));
    activeSeats += active;
    if (g.status !== 'no') {
      if (g.table_id != null) seatedSeats += active;
      else unseatedSeats += active;
    }
    if (g.checked_in_at != null) checkedIn++;
  }

  const tableCapacity = (tables || []).reduce((acc, t) => acc + (Number(t.capacity) || 0), 0);
  const completedContribs = (contributions || []).filter((c) => c.status === 'complete');
  const cagTotal = completedContribs.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  const fee = Number(process.env.CAGNOTTE_FEE_PERCENT || 0);
  const cagFee = Math.round((cagTotal * fee) / 100);

  return {
    guests: {
      total: (guests || []).length,
      yes,
      no,
      pending,
      people,
      seats: seatsInvited,
      activeSeats,
      maxGuests,
      remainingQuota: Math.max(0, maxGuests - activeSeats),
      seatedSeats,
      unseatedSeats,
      checkedIn,
    },
    tables: {
      count: (tables || []).length,
      capacity: tableCapacity,
    },
    cagnotte: {
      count: completedContribs.length,
      total: cagTotal,
      fee: cagFee,
      net: cagTotal - cagFee,
    },
  };
}

async function stats(weddingId) {
  const [w, guests, tables, contribs] = await Promise.all([
    store.getWeddingById(weddingId),
    store.listGuestsByWedding(weddingId),
    store.listTablesByWedding(weddingId),
    store.listContributionsByWedding(weddingId),
  ]);
  return computeStatsFromRows(w, guests, tables, contribs);
}

// Initialise automatiquement le mariage de démonstration (/i/demo) si la base est vide (ex: 1er lancement Supabase)
let demoChecked = false;
async function ensureDemoSeeded() {
  if (demoChecked) return;
  try {
    const existing = await store.getWeddingBySlug('demo');
    if (existing) {
      demoChecked = true;
      return;
    }
    const all = await store.listWeddings();
    if (all.length > 0) {
      demoChecked = true;
      return;
    }
    const w = await createWedding({
      slug: 'demo',
      status: 'published',
      plan: 'prestige',
      price: 50000,
      paid: 1,
      partner: 'Prestige Events Douala',
      partner_commission: 10000,
      event_type: 'mariage_dot',
      bride: 'Grâce',
      groom: 'Junior',
      headline: 'Deux cœurs, une seule destinée 💍',
      story: "Tout a commencé un après-midi de décembre à Bonapriso.\nCe qui n'était qu'un simple café partagé s'est transformé en une complicité évidente, guidée par la foi et l'amour.\n\nAprès 4 belles années à grandir ensemble, nous avons choisi de sceller notre union devant Dieu, nos familles et ceux qui nous sont chers.",
      hashtag: 'GraceJunior2026',
      event_date: '2026-12-19T14:00',
      venue_name: 'Hôtel Akwa Palace',
      venue_address: 'Boulevard de la Liberté, Akwa',
      city: 'Douala',
      maps_query: 'Hotel Akwa Palace Douala',
      program: [
        { title: 'Dot traditionnelle', date: '2026-12-18T10:00', place: 'Résidence familiale (Bonamoussadi)', address: 'Face Collège George Fox, Douala' },
        { title: 'Bénédiction nuptiale', date: '2026-12-19T14:00', place: 'Paroisse EPC Bonapriso', address: 'Rue Njo-Njo, Douala' },
        { title: "Vin d'honneur & Cocktail", date: '2026-12-19T17:00', place: 'Jardins Akwa Palace', address: 'Boulevard de la Liberté, Douala' },
        { title: 'Grande Réception & Soirée dansante', date: '2026-12-19T19:30', place: 'Salle des Fêtes Akwa Palace', address: 'Boulevard de la Liberté, Douala' },
      ],
      dress_code: 'Blanc & Or impérial / Tenue traditionnelle de prestige',
      theme: 'royal',
      rsvp_deadline: '2026-12-10',
      couple_phone: '237690123456',
      couple_email: 'graceetjunior@gmail.com',
      cagnotte_enabled: 1,
      cagnotte_goal: 1500000,
      cagnotte_text: 'Votre présence est le plus précieux des cadeaux. Si vous souhaitez participer à notre voyage de noces et à notre installation, une cagnotte est ouverte.',
      momo_number: '237670123456',
      momo_name: 'Junior Manga',
      om_number: '237690123456',
      om_name: 'Grâce Ngo',
      max_guests: 150,
      strict_rsvp: 1,
    });

    const tHon = await addTable(w.id, { name: "Table d'Honneur — Ndolo", capacity: 8, category: 'honneur' });
    const tVip = await addTable(w.id, { name: 'Table Mont Cameroun', capacity: 10, category: 'vip_mariee' });
    await addTable(w.id, { name: 'Table Wouri', capacity: 10, category: 'famille_marie' });
    await addTable(w.id, { name: 'Table Sanaga', capacity: 10, category: 'amis' });

    const g1 = await addGuest(w.id, { name: 'Tonton Paul & Famille', phone: '237677112233', seats: 4, category: 'vip_mariee', table_id: tVip.id, source: 'list' });
    const g2 = await addGuest(w.id, { name: 'Maman Jacqueline', phone: '237699445566', seats: 2, category: 'vip_mariee', table_id: tVip.id, source: 'list' });
    const g3 = await addGuest(w.id, { name: 'Boris Kamga (Témoin)', phone: '237655889900', seats: 1, category: 'honneur', table_id: tHon.id, source: 'list' });
    await addGuest(w.id, { name: 'Famille Eboa', phone: '237670001122', seats: 3, category: 'famille_marie', table_id: 'auto', source: 'list' });

    await store.updateGuest(g1.id, { status: 'yes', attending_count: 4, message: 'Que Dieu bénisse abondamment votre foyer ! Très honorés.', responded_at: nowStr() });
    await store.updateGuest(g2.id, { status: 'yes', attending_count: 2, message: "Toutes nos félicitations aux futurs mariés ! Hâte d'y être.", responded_at: nowStr() });
    await store.updateGuest(g3.id, { status: 'yes', attending_count: 1, message: 'Présent mon frère, on va célébrer ça comme il se doit ! 🔥', responded_at: nowStr() });

    await recomputeTableSeats(tVip.id);
    await recomputeTableSeats(tHon.id);

    await store.insertContribution({ wedding_id: w.id, name: 'Tonton Paul', phone: '237677112233', amount: 100000, message: 'Un modeste geste pour vos débuts. Bénédictions !', reference: 'demo-ref-001', status: 'complete', paid_at: nowStr() });
    await store.insertContribution({ wedding_id: w.id, name: 'Sandrine & Marc (Paris)', phone: '33612345678', amount: 50000, message: 'De tout cœur avec vous depuis la France ! Félicitations !', reference: 'demo-ref-002', status: 'complete', paid_at: nowStr() });
    demoChecked = true;
  } catch (e) {
    console.warn('[seed-auto] Initialisation démo ignorée :', e.message);
  }
}

module.exports = {
  createWedding,
  addGuest,
  importGuests,
  stats,
  computeStatsFromRows,
  uniqueSlug,
  guestActiveSeats,
  recomputeTableSeats,
  addTable,
  deleteTable,
  getTablesWithOccupancy,
  assignGuestToTable,
  autoAssignTables,
  ensureDemoSeeded,
};
