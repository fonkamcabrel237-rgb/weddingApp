// Couche d'accès aux données unifiée :
// - En production (Vercel) : PostgreSQL hébergé sur Supabase (via @supabase/supabase-js HTTPS).
// - En développement local / tests sans variables Supabase : SQLite intégré (node:sqlite).
const path = require('path');
const os = require('os');
const fs = require('fs');
const { isSupabaseEnabled, getSupabase } = require('./supabase');

const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = path.resolve(process.env.DATA_DIR || (IS_VERCEL ? path.join(os.tmpdir(), 'ndolo-data') : './data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

function nowStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function sortWeddings(rows) {
  return [...rows].sort((a, b) => {
    const archA = a.status === 'archived' ? 1 : 0;
    const archB = b.status === 'archived' ? 1 : 0;
    if (archA !== archB) return archA - archB;
    const nullA = a.event_date ? 0 : 1;
    const nullB = b.event_date ? 0 : 1;
    if (nullA !== nullB) return nullA - nullB;
    if (a.event_date && b.event_date && a.event_date !== b.event_date) {
      return a.event_date < b.event_date ? -1 : 1;
    }
    return a.id - b.id;
  });
}

function sortContributions(rows) {
  return [...rows].sort((a, b) => {
    const pA = a.status === 'pending' ? 0 : 1;
    const pB = b.status === 'pending' ? 0 : 1;
    if (pA !== pB) return pA - pB;
    const dA = a.paid_at || '';
    const dB = b.paid_at || '';
    if (dA !== dB) return dA > dB ? -1 : 1;
    return b.id - a.id;
  });
}

function cleanPatch(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = typeof v === 'boolean' ? Number(v) : v;
  }
  return out;
}

function unwrap({ data, error }, context = 'Supabase') {
  if (error) {
    throw new Error(`[${context}] ${error.message || JSON.stringify(error)}`);
  }
  return data;
}

// =====================================================================
// DRIVER 1 : SUPABASE (PostgreSQL distant via HTTPS — Vercel Serverless)
// =====================================================================
function createSupabaseStore(client) {
  return {
    mode: 'supabase',

    // --- Weddings ---
    async getWeddingById(id) {
      return unwrap(await client.from('weddings').select('*').eq('id', Number(id)).maybeSingle(), 'getWeddingById');
    },
    async getWeddingBySlug(slug) {
      return unwrap(await client.from('weddings').select('*').eq('slug', String(slug)).maybeSingle(), 'getWeddingBySlug');
    },
    async findWeddingBySlugExceptId(slug, excludeId) {
      return unwrap(
        await client.from('weddings').select('id').eq('slug', String(slug)).neq('id', Number(excludeId)).maybeSingle(),
        'findWeddingBySlugExceptId'
      );
    },
    async getFirstPublishedWedding() {
      const rows = unwrap(
        await client.from('weddings').select('id, slug').eq('status', 'published').order('id', { ascending: true }),
        'getFirstPublishedWedding'
      ) || [];
      return rows.find((r) => r.slug === 'demo') || rows[0] || null;
    },
    async listWeddings() {
      const rows = unwrap(await client.from('weddings').select('*'), 'listWeddings') || [];
      return sortWeddings(rows);
    },
    async insertWedding(row) {
      const payload = { ...cleanPatch(row), created_at: nowStr(), updated_at: nowStr() };
      return unwrap(await client.from('weddings').insert(payload).select('*').single(), 'insertWedding');
    },
    async updateWedding(id, patch) {
      const payload = { ...cleanPatch(patch), updated_at: nowStr() };
      return unwrap(await client.from('weddings').update(payload).eq('id', Number(id)).select('*').maybeSingle(), 'updateWedding');
    },
    async incrementWeddingViews(id, currentViews) {
      let base = typeof currentViews === 'number' ? currentViews : null;
      if (base === null) {
        const cur = await this.getWeddingById(id);
        if (!cur) return;
        base = cur.views || 0;
      }
      unwrap(await client.from('weddings').update({ views: base + 1 }).eq('id', Number(id)), 'incrementWeddingViews');
    },
    async deleteWedding(id) {
      unwrap(await client.from('weddings').delete().eq('id', Number(id)), 'deleteWedding');
    },

    // --- Leads ---
    async listLeads(limit = 50) {
      return unwrap(
        await client.from('leads').select('*').order('id', { ascending: false }).limit(limit),
        'listLeads'
      ) || [];
    },
    async getLeadById(id) {
      return unwrap(await client.from('leads').select('*').eq('id', Number(id)).maybeSingle(), 'getLeadById');
    },
    async insertLead(row) {
      const payload = { ...cleanPatch(row), created_at: nowStr() };
      return unwrap(await client.from('leads').insert(payload).select('*').single(), 'insertLead');
    },
    async updateLead(id, patch) {
      unwrap(await client.from('leads').update(cleanPatch(patch)).eq('id', Number(id)), 'updateLead');
    },

    // --- Tables ---
    async listTablesByWedding(weddingId) {
      return unwrap(
        await client.from('wedding_tables').select('*').eq('wedding_id', Number(weddingId))
          .order('position', { ascending: true }).order('id', { ascending: true }),
        'listTablesByWedding'
      ) || [];
    },
    async getTableById(id) {
      return unwrap(await client.from('wedding_tables').select('*').eq('id', Number(id)).maybeSingle(), 'getTableById');
    },
    async insertTable(row) {
      const payload = { ...cleanPatch(row), created_at: nowStr() };
      return unwrap(await client.from('wedding_tables').insert(payload).select('*').single(), 'insertTable');
    },
    async deleteTableRow(weddingId, tableId) {
      unwrap(
        await client.from('wedding_tables').delete().eq('id', Number(tableId)).eq('wedding_id', Number(weddingId)),
        'deleteTableRow'
      );
    },

    // --- Photos ---
    async listPhotosByWedding(weddingId) {
      return unwrap(
        await client.from('photos').select('*').eq('wedding_id', Number(weddingId))
          .order('position', { ascending: true }).order('id', { ascending: true }),
        'listPhotosByWedding'
      ) || [];
    },
    async getPhotoById(id, weddingId) {
      let q = client.from('photos').select('*').eq('id', Number(id));
      if (weddingId != null) q = q.eq('wedding_id', Number(weddingId));
      return unwrap(await q.maybeSingle(), 'getPhotoById');
    },
    async insertPhoto(row) {
      const payload = { ...cleanPatch(row), created_at: nowStr() };
      return unwrap(await client.from('photos').insert(payload).select('*').single(), 'insertPhoto');
    },
    async deletePhoto(id) {
      unwrap(await client.from('photos').delete().eq('id', Number(id)), 'deletePhoto');
    },

    // --- Guests ---
    async listGuestsByWedding(weddingId) {
      return unwrap(
        await client.from('guests').select('*').eq('wedding_id', Number(weddingId)).order('id', { ascending: true }),
        'listGuestsByWedding'
      ) || [];
    },
    async getGuestById(id, weddingId) {
      let q = client.from('guests').select('*').eq('id', Number(id));
      if (weddingId != null) q = q.eq('wedding_id', Number(weddingId));
      return unwrap(await q.maybeSingle(), 'getGuestById');
    },
    async getGuestByToken(token, weddingId) {
      let q = client.from('guests').select('*').eq('token', String(token));
      if (weddingId != null) q = q.eq('wedding_id', Number(weddingId));
      return unwrap(await q.maybeSingle(), 'getGuestByToken');
    },
    async findGuestForRsvp(weddingId, { token, phone, name }) {
      const wid = Number(weddingId);
      if (token) {
        const g = await this.getGuestByToken(token, wid);
        if (g) return g;
      }
      if (phone) {
        const rows = unwrap(
          await client.from('guests').select('*').eq('wedding_id', wid).eq('phone', String(phone)).limit(1),
          'findGuestByPhone'
        ) || [];
        if (rows[0]) return rows[0];
      }
      if (name) {
        const needle = String(name).trim().toLowerCase();
        const all = await this.listGuestsByWedding(wid);
        const found = all.find((g) => String(g.name || '').trim().toLowerCase() === needle);
        if (found) return found;
      }
      return null;
    },
    async insertGuest(row) {
      const payload = { ...cleanPatch(row), created_at: nowStr() };
      return unwrap(await client.from('guests').insert(payload).select('*').single(), 'insertGuest');
    },
    async updateGuest(id, patch) {
      unwrap(await client.from('guests').update(cleanPatch(patch)).eq('id', Number(id)), 'updateGuest');
    },
    async clearTableGuests(tableId, { onlyDeclined = false, weddingId = null } = {}) {
      let q = client.from('guests').update({ table_id: null, table_name: null, seat_numbers: null }).eq('table_id', Number(tableId));
      if (onlyDeclined) q = q.eq('status', 'no');
      if (weddingId != null) q = q.eq('wedding_id', Number(weddingId));
      unwrap(await q, 'clearTableGuests');
    },
    async checkinGuest(token, weddingId) {
      unwrap(
        await client.from('guests').update({ checked_in_at: nowStr() })
          .eq('token', String(token)).eq('wedding_id', Number(weddingId)).is('checked_in_at', null),
        'checkinGuest'
      );
    },
    async deleteGuest(id, weddingId) {
      let q = client.from('guests').delete().eq('id', Number(id));
      if (weddingId != null) q = q.eq('wedding_id', Number(weddingId));
      unwrap(await q, 'deleteGuest');
    },
    async deleteGuestByToken(token) {
      unwrap(await client.from('guests').delete().eq('token', String(token)), 'deleteGuestByToken');
    },

    // --- Contributions ---
    async listContributionsByWedding(weddingId) {
      const rows = unwrap(
        await client.from('contributions').select('*').eq('wedding_id', Number(weddingId)),
        'listContributionsByWedding'
      ) || [];
      return sortContributions(rows);
    },
    async listAllCompletedContributions() {
      return unwrap(
        await client.from('contributions').select('id, wedding_id, amount').eq('status', 'complete'),
        'listAllCompletedContributions'
      ) || [];
    },
    async getContributionById(id) {
      return unwrap(await client.from('contributions').select('*').eq('id', Number(id)).maybeSingle(), 'getContributionById');
    },
    async getContributionByRef(reference, weddingId) {
      let q = client.from('contributions').select('*').eq('reference', String(reference));
      if (weddingId != null) q = q.eq('wedding_id', Number(weddingId));
      return unwrap(await q.maybeSingle(), 'getContributionByRef');
    },
    async findContributionByRefs(refs) {
      for (const r of (refs || []).filter(Boolean)) {
        const byRef = unwrap(
          await client.from('contributions').select('*').eq('reference', String(r)).maybeSingle(),
          'findContributionByRef'
        );
        if (byRef) return byRef;
        const byProv = unwrap(
          await client.from('contributions').select('*').eq('provider_ref', String(r)).maybeSingle(),
          'findContributionByProviderRef'
        );
        if (byProv) return byProv;
      }
      return null;
    },
    async insertContribution(row) {
      const payload = { ...cleanPatch(row), created_at: row.created_at || nowStr() };
      return unwrap(await client.from('contributions').insert(payload).select('*').single(), 'insertContribution');
    },
    async updateContribution(id, patch) {
      unwrap(await client.from('contributions').update(cleanPatch(patch)).eq('id', Number(id)), 'updateContribution');
    },
    async deleteContribution(id, weddingId) {
      let q = client.from('contributions').delete().eq('id', Number(id));
      if (weddingId != null) q = q.eq('wedding_id', Number(weddingId));
      unwrap(await q, 'deleteContribution');
    },
  };
}

// =====================================================================
// DRIVER 2 : SQLITE LOCAL (Développement hors-ligne & suite de tests)
// =====================================================================
function initSqliteDb() {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const dbPath = path.join(DATA_DIR, 'ndolo.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bride TEXT, groom TEXT, phone TEXT, email TEXT, city TEXT,
    event_date TEXT, event_type TEXT, plan TEXT, partner TEXT, notes TEXT,
    wedding_id INTEGER, status TEXT DEFAULT 'new',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS weddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'draft',
    plan TEXT DEFAULT 'prestige',
    price INTEGER DEFAULT 50000,
    paid INTEGER DEFAULT 0,
    partner TEXT,
    partner_commission INTEGER DEFAULT 0,
    event_type TEXT DEFAULT 'mariage',
    bride TEXT NOT NULL, groom TEXT NOT NULL,
    headline TEXT, story TEXT, hashtag TEXT,
    event_date TEXT,
    venue_name TEXT, venue_address TEXT, city TEXT, maps_query TEXT,
    program TEXT DEFAULT '[]',
    dress_code TEXT, theme TEXT DEFAULT 'royal', custom_bg TEXT DEFAULT '#faf6f0', custom_accent TEXT DEFAULT '#b8913f', music_url TEXT, cover_photo TEXT,
    rsvp_deadline TEXT, couple_phone TEXT, couple_email TEXT,
    cagnotte_enabled INTEGER DEFAULT 1, cagnotte_goal INTEGER DEFAULT 0, cagnotte_text TEXT,
    momo_number TEXT, momo_name TEXT, om_number TEXT, om_name TEXT,
    payout_done INTEGER DEFAULT 0,
    max_guests INTEGER DEFAULT 200,
    strict_rsvp INTEGER DEFAULT 1,
    access_key TEXT NOT NULL,
    lead_id INTEGER,
    views INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS wedding_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wedding_id INTEGER NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    capacity INTEGER DEFAULT 10,
    category TEXT DEFAULT 'famille_mariee',
    position INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tables_wedding ON wedding_tables(wedding_id);
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wedding_id INTEGER NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, position INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wedding_id INTEGER NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
    name TEXT NOT NULL, phone TEXT, seats INTEGER DEFAULT 1,
    category TEXT DEFAULT 'famille_mariee',
    table_id INTEGER REFERENCES wedding_tables(id) ON DELETE SET NULL,
    table_name TEXT,
    seat_numbers TEXT,
    token TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending',
    attending_count INTEGER DEFAULT 0,
    message TEXT, source TEXT DEFAULT 'list',
    invited_at TEXT, responded_at TEXT, checked_in_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_guests_wedding ON guests(wedding_id);
  CREATE TABLE IF NOT EXISTS contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wedding_id INTEGER NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
    name TEXT, phone TEXT, amount INTEGER NOT NULL, message TEXT,
    reference TEXT UNIQUE NOT NULL, provider_ref TEXT,
    status TEXT DEFAULT 'pending',
    provider TEXT DEFAULT 'notchpay',
    created_at TEXT DEFAULT (datetime('now')), paid_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_contrib_wedding ON contributions(wedding_id);
  `);

  function ensureColumn(table, col, def) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  ensureColumn('weddings', 'max_guests', 'INTEGER DEFAULT 200');
  ensureColumn('weddings', 'strict_rsvp', 'INTEGER DEFAULT 1');
  ensureColumn('weddings', 'custom_bg', "TEXT DEFAULT '#faf6f0'");
  ensureColumn('weddings', 'custom_accent', "TEXT DEFAULT '#b8913f'");
  ensureColumn('guests', 'category', "TEXT DEFAULT 'famille_mariee'");
  ensureColumn('guests', 'table_id', 'INTEGER REFERENCES wedding_tables(id) ON DELETE SET NULL');
  ensureColumn('guests', 'table_name', 'TEXT');
  ensureColumn('guests', 'seat_numbers', 'TEXT');
  ensureColumn('contributions', 'provider_ref', 'TEXT');

  return db;
}

function createSqliteStore(db) {
  const clean = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  const get = (sql, ...p) => db.prepare(sql).get(...clean(p)) || null;
  const all = (sql, ...p) => db.prepare(sql).all(...clean(p));
  const run = (sql, ...p) => db.prepare(sql).run(...clean(p));

  const insertRow = (table, row) => {
    const data = cleanPatch(row);
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const r = run(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`, ...keys.map((k) => data[k]));
    return get(`SELECT * FROM ${table} WHERE id = ?`, Number(r.lastInsertRowid));
  };

  const updateRow = (table, id, patch) => {
    const data = cleanPatch(patch);
    const keys = Object.keys(data);
    if (!keys.length) return get(`SELECT * FROM ${table} WHERE id = ?`, Number(id));
    const assigns = keys.map((k) => `${k} = ?`).join(', ');
    run(`UPDATE ${table} SET ${assigns} WHERE id = ?`, ...keys.map((k) => data[k]), Number(id));
    return get(`SELECT * FROM ${table} WHERE id = ?`, Number(id));
  };

  return {
    mode: 'sqlite',

    async getWeddingById(id) { return get('SELECT * FROM weddings WHERE id = ?', Number(id)); },
    async getWeddingBySlug(slug) { return get('SELECT * FROM weddings WHERE slug = ?', String(slug)); },
    async findWeddingBySlugExceptId(slug, excludeId) {
      return get('SELECT id FROM weddings WHERE slug = ? AND id <> ?', String(slug), Number(excludeId));
    },
    async getFirstPublishedWedding() {
      return get("SELECT id, slug FROM weddings WHERE status='published' ORDER BY (slug='demo') DESC, id LIMIT 1");
    },
    async listWeddings() { return sortWeddings(all('SELECT * FROM weddings')); },
    async insertWedding(row) { return insertRow('weddings', { ...row, created_at: nowStr(), updated_at: nowStr() }); },
    async updateWedding(id, patch) { return updateRow('weddings', id, { ...patch, updated_at: nowStr() }); },
    async incrementWeddingViews(id) { run('UPDATE weddings SET views = views + 1 WHERE id = ?', Number(id)); },
    async deleteWedding(id) { run('DELETE FROM weddings WHERE id = ?', Number(id)); },

    async listLeads(limit = 50) { return all('SELECT * FROM leads ORDER BY id DESC LIMIT ?', Number(limit)); },
    async getLeadById(id) { return get('SELECT * FROM leads WHERE id = ?', Number(id)); },
    async insertLead(row) { return insertRow('leads', { ...row, created_at: nowStr() }); },
    async updateLead(id, patch) { updateRow('leads', id, patch); },

    async listTablesByWedding(weddingId) {
      return all('SELECT * FROM wedding_tables WHERE wedding_id = ? ORDER BY position ASC, id ASC', Number(weddingId));
    },
    async getTableById(id) { return get('SELECT * FROM wedding_tables WHERE id = ?', Number(id)); },
    async insertTable(row) { return insertRow('wedding_tables', { ...row, created_at: nowStr() }); },
    async deleteTableRow(weddingId, tableId) {
      run('DELETE FROM wedding_tables WHERE id = ? AND wedding_id = ?', Number(tableId), Number(weddingId));
    },

    async listPhotosByWedding(weddingId) {
      return all('SELECT * FROM photos WHERE wedding_id = ? ORDER BY position ASC, id ASC', Number(weddingId));
    },
    async getPhotoById(id, weddingId) {
      return weddingId != null
        ? get('SELECT * FROM photos WHERE id = ? AND wedding_id = ?', Number(id), Number(weddingId))
        : get('SELECT * FROM photos WHERE id = ?', Number(id));
    },
    async insertPhoto(row) { return insertRow('photos', { ...row, created_at: nowStr() }); },
    async deletePhoto(id) { run('DELETE FROM photos WHERE id = ?', Number(id)); },

    async listGuestsByWedding(weddingId) {
      return all('SELECT * FROM guests WHERE wedding_id = ? ORDER BY id ASC', Number(weddingId));
    },
    async getGuestById(id, weddingId) {
      return weddingId != null
        ? get('SELECT * FROM guests WHERE id = ? AND wedding_id = ?', Number(id), Number(weddingId))
        : get('SELECT * FROM guests WHERE id = ?', Number(id));
    },
    async getGuestByToken(token, weddingId) {
      return weddingId != null
        ? get('SELECT * FROM guests WHERE token = ? AND wedding_id = ?', String(token), Number(weddingId))
        : get('SELECT * FROM guests WHERE token = ?', String(token));
    },
    async findGuestForRsvp(weddingId, { token, phone, name }) {
      const wid = Number(weddingId);
      if (token) {
        const g = get('SELECT * FROM guests WHERE token = ? AND wedding_id = ?', String(token), wid);
        if (g) return g;
      }
      if (phone) {
        const g = get('SELECT * FROM guests WHERE phone = ? AND wedding_id = ?', String(phone), wid);
        if (g) return g;
      }
      if (name) {
        const needle = String(name).trim().toLowerCase();
        const found = all('SELECT * FROM guests WHERE wedding_id = ?', wid)
          .find((g) => String(g.name || '').trim().toLowerCase() === needle);
        if (found) return found;
      }
      return null;
    },
    async insertGuest(row) { return insertRow('guests', { ...row, created_at: nowStr() }); },
    async updateGuest(id, patch) { updateRow('guests', id, patch); },
    async clearTableGuests(tableId, { onlyDeclined = false, weddingId = null } = {}) {
      let sql = 'UPDATE guests SET table_id = NULL, table_name = NULL, seat_numbers = NULL WHERE table_id = ?';
      const params = [Number(tableId)];
      if (onlyDeclined) sql += " AND status = 'no'";
      if (weddingId != null) { sql += ' AND wedding_id = ?'; params.push(Number(weddingId)); }
      run(sql, ...params);
    },
    async checkinGuest(token, weddingId) {
      run(
        'UPDATE guests SET checked_in_at = ? WHERE token = ? AND wedding_id = ? AND checked_in_at IS NULL',
        nowStr(), String(token), Number(weddingId)
      );
    },
    async deleteGuest(id, weddingId) {
      if (weddingId != null) run('DELETE FROM guests WHERE id = ? AND wedding_id = ?', Number(id), Number(weddingId));
      else run('DELETE FROM guests WHERE id = ?', Number(id));
    },
    async deleteGuestByToken(token) { run('DELETE FROM guests WHERE token = ?', String(token)); },

    async listContributionsByWedding(weddingId) {
      return sortContributions(all('SELECT * FROM contributions WHERE wedding_id = ?', Number(weddingId)));
    },
    async listAllCompletedContributions() {
      return all("SELECT id, wedding_id, amount FROM contributions WHERE status = 'complete'");
    },
    async getContributionById(id) { return get('SELECT * FROM contributions WHERE id = ?', Number(id)); },
    async getContributionByRef(reference, weddingId) {
      return weddingId != null
        ? get('SELECT * FROM contributions WHERE reference = ? AND wedding_id = ?', String(reference), Number(weddingId))
        : get('SELECT * FROM contributions WHERE reference = ?', String(reference));
    },
    async findContributionByRefs(refs) {
      for (const r of (refs || []).filter(Boolean)) {
        const c = get('SELECT * FROM contributions WHERE reference = ? OR provider_ref = ?', String(r), String(r));
        if (c) return c;
      }
      return null;
    },
    async insertContribution(row) { return insertRow('contributions', { ...row, created_at: row.created_at || nowStr() }); },
    async updateContribution(id, patch) { updateRow('contributions', id, patch); },
    async deleteContribution(id, weddingId) {
      if (weddingId != null) run('DELETE FROM contributions WHERE id = ? AND wedding_id = ?', Number(id), Number(weddingId));
      else run('DELETE FROM contributions WHERE id = ?', Number(id));
    },
  };
}

let activeStore = null;
function getStore() {
  if (!activeStore) {
    if (isSupabaseEnabled()) {
      activeStore = createSupabaseStore(getSupabase());
    } else {
      activeStore = createSqliteStore(initSqliteDb());
    }
  }
  return activeStore;
}

// Proxy paresseux pour que `store.xxx(...)` choisisse dynamiquement Supabase ou SQLite
const store = new Proxy({}, {
  get(_, prop) {
    const s = getStore();
    const val = s[prop];
    return typeof val === 'function' ? val.bind(s) : val;
  },
});

module.exports = {
  store,
  getStore,
  createSupabaseStore,
  createSqliteStore,
  nowStr,
  DATA_DIR,
  UPLOAD_DIR,
};
