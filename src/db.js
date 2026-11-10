// Base de données SQLite intégrée à Node (node:sqlite) — aucun serveur à installer.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'ndolo.db'));
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
  status TEXT DEFAULT 'draft',          -- draft | published | archived
  plan TEXT DEFAULT 'prestige',         -- essentiel | prestige | royal
  price INTEGER DEFAULT 50000,
  paid INTEGER DEFAULT 0,
  partner TEXT,                          -- wedding planner / photographe apporteur
  partner_commission INTEGER DEFAULT 0,
  event_type TEXT DEFAULT 'mariage',     -- mariage | dot | mariage_dot
  bride TEXT NOT NULL, groom TEXT NOT NULL,
  headline TEXT, story TEXT, hashtag TEXT,
  event_date TEXT,                       -- 'YYYY-MM-DDTHH:mm' heure de Douala
  venue_name TEXT, venue_address TEXT, city TEXT, maps_query TEXT,
  program TEXT DEFAULT '[]',             -- JSON [{title,date,place,address}]
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
  status TEXT DEFAULT 'pending',         -- pending | yes | no
  attending_count INTEGER DEFAULT 0,
  message TEXT, source TEXT DEFAULT 'list', -- list | public
  invited_at TEXT, responded_at TEXT, checked_in_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guests_wedding ON guests(wedding_id);

CREATE TABLE IF NOT EXISTS contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wedding_id INTEGER NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  name TEXT, phone TEXT, amount INTEGER NOT NULL, message TEXT,
  reference TEXT UNIQUE NOT NULL, provider_ref TEXT,
  status TEXT DEFAULT 'pending',          -- pending | complete | failed
  provider TEXT DEFAULT 'notchpay',
  created_at TEXT DEFAULT (datetime('now')), paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contrib_wedding ON contributions(wedding_id);
`);

// Migrations non-destructives pour les bases existantes
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

// node:sqlite refuse `undefined` : on convertit en NULL.
const clean = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const q = {
  get: (sql, ...p) => db.prepare(sql).get(...clean(p)),
  all: (sql, ...p) => db.prepare(sql).all(...clean(p)),
  run: (sql, ...p) => db.prepare(sql).run(...clean(p)),
};

module.exports = { db, q, DATA_DIR, UPLOAD_DIR };
