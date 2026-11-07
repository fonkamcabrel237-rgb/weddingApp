// Logique métier partagée : création de faire-part, invités, cagnotte.
const { q } = require('./db');
const { slugify, token, normalizePhone, PLANS } = require('./utils');

function uniqueSlug(base) {
  let slug = slugify(base) || 'mariage';
  let i = 1;
  while (q.get('SELECT 1 FROM weddings WHERE slug = ?', slug)) slug = `${slugify(base)}-${++i}`;
  return slug;
}

function createWedding(data) {
  const plan = PLANS[data.plan] ? data.plan : 'prestige';
  const slug = uniqueSlug(data.slug || `${data.bride}-et-${data.groom}`);
  const r = q.run(
    `INSERT INTO weddings (slug, status, plan, price, partner, event_type, bride, groom, headline, story,
      event_date, venue_name, venue_address, city, maps_query, program, theme, couple_phone, couple_email,
      momo_number, om_number, access_key, lead_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    slug, data.status || 'draft', plan, Number(data.price) || PLANS[plan].price, data.partner || null,
    data.event_type || 'mariage', data.bride.trim(), data.groom.trim(),
    data.headline || 'Nous nous disons OUI !', data.story || null,
    data.event_date || null, data.venue_name || null, data.venue_address || null, data.city || null,
    data.maps_query || null, JSON.stringify(data.program || []), data.theme || 'royal',
    normalizePhone(data.couple_phone) || null, data.couple_email || null,
    normalizePhone(data.momo_number) || null, normalizePhone(data.om_number) || null,
    token(12), data.lead_id || null,
  );
  return q.get('SELECT * FROM weddings WHERE id = ?', r.lastInsertRowid);
}

function addGuest(weddingId, { name, phone, seats, source }) {
  const t = token(8);
  q.run('INSERT INTO guests (wedding_id, name, phone, seats, token, source) VALUES (?,?,?,?,?,?)',
    weddingId, String(name).trim().slice(0, 120), normalizePhone(phone) || null,
    Math.max(1, Math.min(20, parseInt(seats, 10) || 1)), t, source || 'list');
  return q.get('SELECT * FROM guests WHERE token = ?', t);
}

// Import "Nom, téléphone, places" (une ligne par invité) ou CSV exporté d'Excel (séparateur , ou ;)
function importGuests(weddingId, text) {
  let added = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split(/[;,\t]/).map((s) => s.trim());
    if (!parts[0] || /^nom$/i.test(parts[0])) continue;
    addGuest(weddingId, { name: parts[0], phone: parts[1], seats: parts[2] });
    added++;
  }
  return added;
}

function stats(weddingId) {
  const g = q.get(`SELECT
      COUNT(*) AS total,
      SUM(status='yes') AS yes, SUM(status='no') AS no, SUM(status='pending') AS pending,
      COALESCE(SUM(CASE WHEN status='yes' THEN attending_count END),0) AS people,
      COALESCE(SUM(seats),0) AS seats_invited,
      SUM(checked_in_at IS NOT NULL) AS checked_in
    FROM guests WHERE wedding_id = ?`, weddingId);
  const c = q.get(`SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
    FROM contributions WHERE wedding_id = ? AND status='complete'`, weddingId);
  const fee = Number(process.env.CAGNOTTE_FEE_PERCENT || 0);
  return {
    guests: { total: g.total || 0, yes: g.yes || 0, no: g.no || 0, pending: g.pending || 0, people: g.people || 0, seats: g.seats_invited || 0, checkedIn: g.checked_in || 0 },
    cagnotte: { count: c.count, total: c.total, fee: Math.round(c.total * fee / 100), net: c.total - Math.round(c.total * fee / 100) },
  };
}

module.exports = { createWedding, addGuest, importGuests, stats, uniqueSlug };
