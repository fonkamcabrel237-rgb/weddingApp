// Espace des mariés : suivi RSVP, tables & places par intimité, envoi WhatsApp, cagnotte, contrôle des entrées.
const express = require('express');
const { q } = require('../db');
const U = require('../utils');
const {
  importGuests, addGuest, stats,
  addTable, deleteTable, getTablesWithOccupancy, assignGuestToTable, autoAssignTables, recomputeTableSeats,
} = require('../weddings');
const { hasCoupleAccess, cookieOpts } = require('../auth');

const router = express.Router();

router.param('slug', (req, res, next, slug) => {
  const w = q.get('SELECT * FROM weddings WHERE slug = ?', slug);
  if (!w) return res.status(404).render('error', { title: 'Espace introuvable', message: 'Vérifie le lien reçu.' });
  if (req.query.k && req.query.k === w.access_key) res.cookie(`c${w.id}`, w.access_key, cookieOpts(120));
  req.w = w;
  req.owner = hasCoupleAccess(req, w) || req.query.k === w.access_key;
  next();
});

const guard = (req, res, next) => (req.owner ? next() : res.render('couple/login', { w: req.w, error: null, next: req.originalUrl }));

router.post('/:slug/login', (req, res) => {
  if (String(req.body.key || '').trim() !== req.w.access_key) {
    return res.render('couple/login', { w: req.w, error: 'Code incorrect.', next: req.body.next });
  }
  res.cookie(`c${req.w.id}`, req.w.access_key, cookieOpts(120));
  const next = String(req.body.next || '');
  res.redirect(next.startsWith(`/espace/${req.w.slug}`) ? next : `/espace/${req.w.slug}`);
});

router.get('/:slug', guard, (req, res) => {
  const w = req.w;
  const filter = ['yes', 'no', 'pending', 'unseated'].includes(req.query.f) ? req.query.f : null;
  let where = 'WHERE wedding_id = ?';
  const params = [w.id];
  if (filter === 'unseated') {
    where += " AND status <> 'no' AND table_id IS NULL";
  } else if (filter) {
    where += ' AND status = ?';
    params.push(filter);
  }
  const guests = q.all(
    `SELECT * FROM guests ${where} ORDER BY CASE status WHEN 'yes' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, name`,
    ...params
  );
  const tables = getTablesWithOccupancy(w.id);
  const contributions = q.all("SELECT * FROM contributions WHERE wedding_id = ? AND status='complete' ORDER BY paid_at DESC", w.id);
  const daysLeft = w.event_date ? Math.ceil((U.parseLocal(w.event_date) - new Date()) / 86400000) : null;
  res.render('couple/dashboard', { w, guests, tables, contributions, s: stats(w.id), filter, daysLeft, query: req.query });
});

// Quota maximum d'invités & mode liste fermée
router.post('/:slug/settings', guard, (req, res) => {
  const maxGuests = Math.max(10, Math.min(5000, parseInt(req.body.max_guests, 10) || 200));
  const strictRsvp = req.body.strict_rsvp === '0' ? 0 : 1;
  q.run('UPDATE weddings SET max_guests = ?, strict_rsvp = ? WHERE id = ?', maxGuests, strictRsvp, req.w.id);
  res.redirect(`/espace/${req.w.slug}?ok=${encodeURIComponent(` Capacité fixée à ${maxGuests} places max`)}#tables`);
});

// Création de table(s) personnalisée(s) par les mariés
router.post('/:slug/tables', guard, (req, res) => {
  const w = req.w;
  let created = 0;
  if (req.body.name) {
    if (addTable(w.id, { name: req.body.name, capacity: req.body.capacity, category: req.body.category })) created++;
  }
  if (req.body.bulk_tables) {
    for (const line of String(req.body.bulk_tables).split(/\r?\n/)) {
      const parts = line.split(/[;,]/).map((s) => s.trim());
      if (!parts[0]) continue;
      if (addTable(w.id, { name: parts[0], capacity: parts[1] || req.body.default_capacity || 10, category: parts[2] || req.body.default_category || 'famille_mariee' })) {
        created++;
      }
    }
  }
  res.redirect(`/espace/${w.slug}?ok=${encodeURIComponent(`${created} table(s) créée(s)`)}#tables`);
});

router.post('/:slug/tables/auto-assign', guard, (req, res) => {
  const { placed, unplaced } = autoAssignTables(req.w.id);
  const msg = unplaced > 0
    ? `${placed} invité(s) placé(s) automatiquement (${unplaced} sans place : créez une table supplémentaire).`
    : `${placed} invité(s) placé(s) automatiquement selon leur intimité !`;
  res.redirect(`/espace/${req.w.slug}?ok=${encodeURIComponent(msg)}#tables`);
});

router.post('/:slug/tables/:tableId/delete', guard, (req, res) => {
  deleteTable(req.w.id, Number(req.params.tableId));
  res.redirect(`/espace/${req.w.slug}?ok=${encodeURIComponent('Table supprimée')}#tables`);
});

// Ajout / import d'invités avec contrôle du quota max et placement à table
router.post('/:slug/invites', guard, (req, res) => {
  const w = req.w;
  const currentStats = stats(w.id);

  if (req.body.bulk) {
    if (currentStats.guests.remainingQuota <= 0) {
      return res.redirect(`/espace/${w.slug}?err=${encodeURIComponent(`Quota maximum de ${w.max_guests} places atteint ! Augmentez votre quota dans l'onglet Tables.`)}#ajouter`);
    }
    const n = importGuests(w.id, req.body.bulk, req.body.default_category || 'famille_mariee');
    return res.redirect(`/espace/${w.slug}?ok=${encodeURIComponent(n + ' invité(s) importé(s)')}#invites`);
  }

  if (req.body.name) {
    const reqSeats = Math.max(1, Math.min(20, parseInt(req.body.seats, 10) || 1));
    if (currentStats.guests.activeSeats + reqSeats > (w.max_guests || 200)) {
      return res.redirect(
        `/espace/${w.slug}?err=${encodeURIComponent(`Impossible d'ajouter ${reqSeats} place(s) : il ne reste que ${currentStats.guests.remainingQuota} place(s) sur votre quota max de ${w.max_guests}.`)}#ajouter`
      );
    }
    const g = addGuest(w.id, {
      name: req.body.name,
      phone: req.body.phone,
      seats: reqSeats,
      category: req.body.category,
      table_id: req.body.table_id || 'auto',
    });
    const suffix = g.table_name ? ` → ${g.table_name} (Siège ${g.seat_numbers})` : ' (en attente d\'une table)';
    return res.redirect(`/espace/${w.slug}?ok=${encodeURIComponent(`Invité ajouté${suffix}`)}#invites`);
  }

  res.redirect(`/espace/${w.slug}#invites`);
});

// Attribution / changement de table ou d'intimité d'un invité
router.post('/:slug/invites/:id/assign', guard, (req, res) => {
  const w = req.w;
  const guest = q.get('SELECT * FROM guests WHERE id = ? AND wedding_id = ?', req.params.id, w.id);
  if (!guest) return res.redirect(`/espace/${w.slug}#invites`);

  if (req.body.category && U.GUEST_CATEGORIES[req.body.category]) {
    q.run('UPDATE guests SET category = ? WHERE id = ?', req.body.category, guest.id);
  }
  const result = assignGuestToTable(w.id, guest.id, req.body.table_id);
  if (!result.ok) {
    return res.redirect(`/espace/${w.slug}?err=${encodeURIComponent(result.error)}#invites`);
  }
  const updated = q.get('SELECT * FROM guests WHERE id = ?', guest.id);
  const msg = updated.table_name
    ? `${updated.name} placé(e) sur ${updated.table_name} (Siège ${updated.seat_numbers})`
    : `${updated.name} retiré(e) de sa table`;
  res.redirect(`/espace/${w.slug}?ok=${encodeURIComponent(msg)}#invites`);
});

router.post('/:slug/invites/:id/delete', guard, (req, res) => {
  const guest = q.get('SELECT * FROM guests WHERE id = ? AND wedding_id = ?', req.params.id, req.w.id);
  q.run('DELETE FROM guests WHERE id = ? AND wedding_id = ?', req.params.id, req.w.id);
  if (guest && guest.table_id) recomputeTableSeats(guest.table_id);
  res.redirect(`/espace/${req.w.slug}#invites`);
});

// Appelé en arrière-plan quand on clique sur "Envoyer WhatsApp"
router.post('/:slug/invites/:id/sent', guard, (req, res) => {
  q.run("UPDATE guests SET invited_at = datetime('now') WHERE id = ? AND wedding_id = ?", req.params.id, req.w.id);
  res.json({ ok: true });
});

router.get('/:slug/export.csv', guard, (req, res) => {
  const rows = q.all('SELECT * FROM guests WHERE wedding_id = ? ORDER BY table_name IS NULL, table_name, seat_numbers, name', req.w.id);
  const label = { yes: 'Présent', no: 'Absent', pending: 'Sans réponse' };
  const lines = [['Nom', 'Téléphone', 'Intimité', 'Table', 'Sièges', 'Places prévues', 'Réponse', 'Nombre confirmé', 'Message', 'Date réponse', 'Arrivé à'].join(';')];
  for (const g of rows) {
    const catLabel = U.GUEST_CATEGORIES[g.category]?.short || g.category || '';
    lines.push([
      g.name, U.prettyPhone(g.phone), catLabel, g.table_name || 'Non attribuée', g.seat_numbers || '',
      g.seats, label[g.status], g.attending_count, g.message, g.responded_at, g.checked_in_at,
    ].map(U.csvEscape).join(';'));
  }
  res.type('text/csv').attachment(`invites-${req.w.slug}.csv`).send('\ufeff' + lines.join('\r\n'));
});

// ---------- Contrôle des entrées le jour J ----------
router.get('/:slug/accueil', guard, (req, res) => {
  const search = String(req.query.s || '').trim();
  const guests = search
    ? q.all(
        "SELECT * FROM guests WHERE wedding_id = ? AND status='yes' AND (name LIKE ? OR table_name LIKE ? OR token LIKE ?) ORDER BY name LIMIT 80",
        req.w.id, `%${search}%`, `%${search}%`, `%${search}%`
      )
    : q.all("SELECT * FROM guests WHERE wedding_id = ? AND status='yes' ORDER BY checked_in_at IS NOT NULL, table_name IS NULL, table_name, name LIMIT 300", req.w.id);
  const tables = getTablesWithOccupancy(req.w.id);
  res.render('couple/accueil', { w: req.w, guests, tables, search, s: stats(req.w.id) });
});

router.get('/:slug/checkin/:token', guard, (req, res) => {
  const guest = q.get('SELECT * FROM guests WHERE token = ? AND wedding_id = ?', req.params.token, req.w.id);
  res.render('couple/checkin', { w: req.w, guest, done: req.query.done === '1' });
});

router.post('/:slug/checkin/:token', guard, (req, res) => {
  q.run("UPDATE guests SET checked_in_at = datetime('now') WHERE token = ? AND wedding_id = ? AND checked_in_at IS NULL", req.params.token, req.w.id);
  if (req.body.back === 'accueil') return res.redirect(`/espace/${req.w.slug}/accueil`);
  res.redirect(`/espace/${req.w.slug}/checkin/${req.params.token}?done=1`);
});

module.exports = router;
