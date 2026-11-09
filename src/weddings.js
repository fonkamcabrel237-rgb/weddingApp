// Logique métier partagée : création de faire-part, invités, tables, placement automatique, cagnotte.
const { q } = require('./db');
const { slugify, token, normalizePhone, sanitizeHex, PLANS, GUEST_CATEGORIES } = require('./utils');

function uniqueSlug(base) {
  let slug = slugify(base) || 'mariage';
  let i = 1;
  while (q.get('SELECT 1 FROM weddings WHERE slug = ?', slug)) slug = `${slugify(base)}-${++i}`;
  return slug;
}

function createWedding(data) {
  const plan = PLANS[data.plan] ? data.plan : 'prestige';
  const slug = uniqueSlug(data.slug || `${data.bride}-et-${data.groom}`);
  const maxGuests = Math.max(10, Math.min(5000, parseInt(data.max_guests, 10) || 200));
  const r = q.run(
    `INSERT INTO weddings (slug, status, plan, price, partner, event_type, bride, groom, headline, story,
      event_date, venue_name, venue_address, city, maps_query, program, theme, custom_bg, custom_accent, couple_phone, couple_email,
      momo_number, om_number, max_guests, strict_rsvp, access_key, lead_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    slug, data.status || 'draft', plan, Number(data.price) || PLANS[plan].price, data.partner || null,
    data.event_type || 'mariage', data.bride.trim(), data.groom.trim(),
    data.headline || 'Nous nous disons OUI !', data.story || null,
    data.event_date || null, data.venue_name || null, data.venue_address || null, data.city || null,
    data.maps_query || null, JSON.stringify(data.program || []), data.theme || 'royal',
    sanitizeHex(data.custom_bg, '#faf6f0'), sanitizeHex(data.custom_accent, '#b8913f'),
    normalizePhone(data.couple_phone) || null, data.couple_email || null,
    normalizePhone(data.momo_number) || null, normalizePhone(data.om_number) || null,
    maxGuests, data.strict_rsvp === undefined ? 1 : Number(Boolean(data.strict_rsvp)),
    token(12), data.lead_id || null,
  );
  return q.get('SELECT * FROM weddings WHERE id = ?', r.lastInsertRowid);
}

// Nombre de chaises réellement occupées/réservées par un invité
function guestActiveSeats(g) {
  if (!g || g.status === 'no') return 0;
  if (g.status === 'yes') return Math.max(1, Number(g.attending_count) || Number(g.seats) || 1);
  return Math.max(1, Number(g.seats) || 1);
}

// Recalcule les numéros de sièges (ex: "1-2", "3") pour tous les invités actifs d'une table
function recomputeTableSeats(tableId) {
  if (!tableId) return;
  const table = q.get('SELECT * FROM wedding_tables WHERE id = ?', tableId);
  if (!table) {
    q.run('UPDATE guests SET table_id = NULL, table_name = NULL, seat_numbers = NULL WHERE table_id = ?', tableId);
    return;
  }
  // Libère automatiquement les invités ayant répondu "Non"
  q.run("UPDATE guests SET table_id = NULL, table_name = NULL, seat_numbers = NULL WHERE table_id = ? AND status = 'no'", tableId);

  const guests = q.all(
    "SELECT * FROM guests WHERE table_id = ? AND status <> 'no' ORDER BY CASE status WHEN 'yes' THEN 0 ELSE 1 END, id ASC",
    tableId
  );
  let cursor = 1;
  for (const g of guests) {
    const count = guestActiveSeats(g);
    const start = cursor;
    const end = cursor + count - 1;
    const label = start === end ? `${start}` : `${start}-${end}`;
    cursor = end + 1;
    q.run('UPDATE guests SET table_name = ?, seat_numbers = ? WHERE id = ?', table.name, label, g.id);
  }
}

function addTable(weddingId, { name, capacity, category }) {
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cleanName) return null;
  const cap = Math.max(1, Math.min(50, parseInt(capacity, 10) || 10));
  const cat = GUEST_CATEGORIES[category] ? category : 'famille_mariee';
  const pos = (q.get('SELECT COALESCE(MAX(position), 0) AS m FROM wedding_tables WHERE wedding_id = ?', weddingId)?.m || 0) + 1;
  const r = q.run(
    'INSERT INTO wedding_tables (wedding_id, name, capacity, category, position) VALUES (?,?,?,?,?)',
    weddingId, cleanName, cap, cat, pos
  );
  return q.get('SELECT * FROM wedding_tables WHERE id = ?', r.lastInsertRowid);
}

function deleteTable(weddingId, tableId) {
  q.run('UPDATE guests SET table_id = NULL, table_name = NULL, seat_numbers = NULL WHERE wedding_id = ? AND table_id = ?', weddingId, tableId);
  q.run('DELETE FROM wedding_tables WHERE id = ? AND wedding_id = ?', tableId, weddingId);
}

function getTablesWithOccupancy(weddingId) {
  const tables = q.all('SELECT * FROM wedding_tables WHERE wedding_id = ? ORDER BY position ASC, id ASC', weddingId);
  const guests = q.all("SELECT * FROM guests WHERE wedding_id = ? AND table_id IS NOT NULL AND status <> 'no' ORDER BY id ASC", weddingId);
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

function assignGuestToTable(weddingId, guestId, targetTableId) {
  const guest = q.get('SELECT * FROM guests WHERE id = ? AND wedding_id = ?', guestId, weddingId);
  if (!guest) return { ok: false, error: 'Invité introuvable.' };
  const oldTableId = guest.table_id;

  if (!targetTableId || targetTableId === 'none') {
    q.run('UPDATE guests SET table_id = NULL, table_name = NULL, seat_numbers = NULL WHERE id = ?', guest.id);
    if (oldTableId) recomputeTableSeats(oldTableId);
    return { ok: true, table: null };
  }

  if (guest.status === 'no') {
    q.run('UPDATE guests SET table_id = NULL, table_name = NULL, seat_numbers = NULL WHERE id = ?', guest.id);
    if (oldTableId) recomputeTableSeats(oldTableId);
    return { ok: false, error: 'Cet invité a décliné l\'invitation.' };
  }

  const needed = guestActiveSeats(guest);
  const tables = getTablesWithOccupancy(weddingId);

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
      return { ok: false, error: 'Aucune table compatible n\'a assez de places libres.' };
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

  q.run('UPDATE guests SET table_id = ?, table_name = ? WHERE id = ?', chosen.id, chosen.name, guest.id);
  if (oldTableId && oldTableId !== chosen.id) recomputeTableSeats(oldTableId);
  recomputeTableSeats(chosen.id);
  return { ok: true, table: chosen };
}

function autoAssignTables(weddingId) {
  const unassigned = q.all(
    "SELECT * FROM guests WHERE wedding_id = ? AND status <> 'no' AND table_id IS NULL ORDER BY CASE status WHEN 'yes' THEN 0 ELSE 1 END, seats DESC, id ASC",
    weddingId
  );
  let placed = 0;
  let unplaced = 0;
  for (const g of unassigned) {
    const res = assignGuestToTable(weddingId, g.id, 'auto');
    if (res.ok) placed++;
    else unplaced++;
  }
  return { placed, unplaced };
}

function addGuest(weddingId, { name, phone, seats, category, table_id, source }) {
  const t = token(8);
  const cleanSeats = Math.max(1, Math.min(20, parseInt(seats, 10) || 1));
  const cat = GUEST_CATEGORIES[category] ? category : 'famille_mariee';
  q.run(
    'INSERT INTO guests (wedding_id, name, phone, seats, category, token, source) VALUES (?,?,?,?,?,?,?)',
    weddingId, String(name).trim().slice(0, 120), normalizePhone(phone) || null,
    cleanSeats, cat, t, source || 'list'
  );
  const guest = q.get('SELECT * FROM guests WHERE token = ?', t);
  if (table_id && table_id !== 'none') {
    assignGuestToTable(weddingId, guest.id, table_id);
  }
  return q.get('SELECT * FROM guests WHERE id = ?', guest.id);
}

// Import "Nom, téléphone, places, catégorie/table" (une ligne par invité)
function importGuests(weddingId, text, defaultCategory = 'famille_mariee') {
  let added = 0;
  const w = q.get('SELECT max_guests FROM weddings WHERE id = ?', weddingId);
  const maxGuests = w?.max_guests || 200;
  let currentSeats = stats(weddingId).guests.activeSeats;

  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split(/[;,\t]/).map((s) => s.trim());
    if (!parts[0] || /^nom$/i.test(parts[0])) continue;
    const reqSeats = Math.max(1, Math.min(20, parseInt(parts[2], 10) || 1));
    if (currentSeats + reqSeats > maxGuests) break;
    const cat = GUEST_CATEGORIES[parts[3]] ? parts[3] : defaultCategory;
    addGuest(weddingId, { name: parts[0], phone: parts[1], seats: reqSeats, category: cat, table_id: 'auto' });
    currentSeats += reqSeats;
    added++;
  }
  return added;
}

function stats(weddingId) {
  const w = q.get('SELECT max_guests, strict_rsvp FROM weddings WHERE id = ?', weddingId) || { max_guests: 200, strict_rsvp: 1 };
  const g = q.get(`SELECT
      COUNT(*) AS total,
      SUM(status='yes') AS yes, SUM(status='no') AS no, SUM(status='pending') AS pending,
      COALESCE(SUM(CASE WHEN status='yes' THEN attending_count END),0) AS people,
      COALESCE(SUM(seats),0) AS seats_invited,
      COALESCE(SUM(CASE WHEN status='no' THEN 0 WHEN status='yes' THEN attending_count ELSE seats END),0) AS active_seats,
      COALESCE(SUM(CASE WHEN status <> 'no' AND table_id IS NOT NULL THEN (CASE WHEN status='yes' THEN attending_count ELSE seats END) ELSE 0 END),0) AS seated_seats,
      COALESCE(SUM(CASE WHEN status <> 'no' AND table_id IS NULL THEN (CASE WHEN status='yes' THEN attending_count ELSE seats END) ELSE 0 END),0) AS unseated_seats,
      SUM(checked_in_at IS NOT NULL) AS checked_in
    FROM guests WHERE wedding_id = ?`, weddingId);
  const tb = q.get('SELECT COUNT(*) AS count, COALESCE(SUM(capacity),0) AS capacity FROM wedding_tables WHERE wedding_id = ?', weddingId);
  const c = q.get(`SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
    FROM contributions WHERE wedding_id = ? AND status='complete'`, weddingId);
  const fee = Number(process.env.CAGNOTTE_FEE_PERCENT || 0);
  const maxGuests = w.max_guests || 200;
  const activeSeats = g.active_seats || 0;
  return {
    guests: {
      total: g.total || 0,
      yes: g.yes || 0,
      no: g.no || 0,
      pending: g.pending || 0,
      people: g.people || 0,
      seats: g.seats_invited || 0,
      activeSeats,
      maxGuests,
      remainingQuota: Math.max(0, maxGuests - activeSeats),
      seatedSeats: g.seated_seats || 0,
      unseatedSeats: g.unseated_seats || 0,
      checkedIn: g.checked_in || 0,
    },
    tables: {
      count: tb.count || 0,
      capacity: tb.capacity || 0,
    },
    cagnotte: { count: c.count, total: c.total, fee: Math.round(c.total * fee / 100), net: c.total - Math.round(c.total * fee / 100) },
  };
}

module.exports = {
  createWedding, addGuest, importGuests, stats, uniqueSlug,
  guestActiveSeats, recomputeTableSeats, addTable, deleteTable,
  getTablesWithOccupancy, assignGuestToTable, autoAssignTables,
};
