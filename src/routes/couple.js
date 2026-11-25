// Espace des mariés : suivi RSVP, tables & places par intimité, envoi WhatsApp, cagnotte, contrôle des entrées.
const express = require('express');
const { store, nowStr } = require('../db');
const U = require('../utils');
const {
  importGuests, addGuest, stats,
  addTable, deleteTable, getTablesWithOccupancy, assignGuestToTable, autoAssignTables, recomputeTableSeats,
} = require('../weddings');
const { hasCoupleAccess, cookieOpts } = require('../auth');
const { createRateLimiter } = require('../security');

const router = express.Router();
const { asyncRoute } = U;
const coupleLoginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'couple_login', message: 'Trop de tentatives de connexion. Merci de patienter 15 minutes.' });

router.param('slug', (req, res, next, slug) => {
  store.getWeddingBySlug(slug)
    .then((w) => {
      if (!w) return res.status(404).render('error', { title: 'Espace introuvable', message: 'Vérifie le lien reçu.' });
      if (req.query.k && req.query.k === w.access_key) res.cookie(`c${w.id}`, w.access_key, cookieOpts(120));
      req.w = w;
      req.owner = hasCoupleAccess(req, w) || req.query.k === w.access_key;
      next();
    })
    .catch(next);
});

const guard = (req, res, next) => (req.owner ? next() : res.render('couple/login', { w: req.w, error: null, next: req.originalUrl }));

router.post('/:slug/login', coupleLoginLimiter, (req, res) => {
  if (String(req.body.key || '').trim() !== req.w.access_key) {
    return res.render('couple/login', { w: req.w, error: 'Code incorrect.', next: req.body.next });
  }
  res.cookie(`c${req.w.id}`, req.w.access_key, cookieOpts(120));
  const next = String(req.body.next || '');
  res.redirect(next.startsWith(`/espace/${req.w.slug}`) ? next : `/espace/${req.w.slug}`);
});

router.get('/:slug', guard, asyncRoute(async (req, res) => {
  const w = req.w;
  const filter = ['yes', 'no', 'pending', 'unseated'].includes(req.query.f) ? req.query.f : null;
  const [allGuests, tables, contributions, s] = await Promise.all([
    store.listGuestsByWedding(w.id),
    getTablesWithOccupancy(w.id),
    store.listContributionsByWedding(w.id),
    stats(w.id),
  ]);

  let guests = allGuests;
  if (filter === 'unseated') {
    guests = guests.filter((g) => g.status !== 'no' && g.table_id == null);
  } else if (filter) {
    guests = guests.filter((g) => g.status === filter);
  }
  const rank = { yes: 0, pending: 1, no: 2 };
  guests = [...guests].sort((a, b) => {
    const rA = rank[a.status] ?? 2;
    const rB = rank[b.status] ?? 2;
    if (rA !== rB) return rA - rB;
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  });

  const daysLeft = w.event_date ? Math.ceil((U.parseLocal(w.event_date) - new Date()) / 86400000) : null;
  res.render('couple/dashboard', { w, guests, tables, contributions, s, filter, daysLeft, query: req.query });
}));

// Quota maximum d'invités & mode liste fermée
router.post('/:slug/settings', guard, asyncRoute(async (req, res) => {
  const maxGuests = Math.max(10, Math.min(5000, parseInt(req.body.max_guests, 10) || 200));
  const strictRsvp = req.body.strict_rsvp === '0' ? 0 : 1;
  await store.updateWedding(req.w.id, { max_guests: maxGuests, strict_rsvp: strictRsvp });
  res.redirect(`/espace/${req.w.slug}?ok=${encodeURIComponent(` Capacité fixée à ${maxGuests} places max`)}#tables`);
}));

// Création de table(s) personnalisée(s) par les mariés
router.post('/:slug/tables', guard, asyncRoute(async (req, res) => {
  const w = req.w;
  let created = 0;
  if (req.body.name) {
    if (await addTable(w.id, { name: req.body.name, capacity: req.body.capacity, category: req.body.category })) created++;
  }
  if (req.body.bulk_tables) {
    for (const line of String(req.body.bulk_tables).split(/\r?\n/)) {
      const parts = line.split(/[;,]/).map((s) => s.trim());
      if (!parts[0]) continue;
      if (await addTable(w.id, { name: parts[0], capacity: parts[1] || req.body.default_capacity || 10, category: parts[2] || req.body.default_category || 'famille_mariee' })) {
        created++;
      }
    }
  }
  res.redirect(`/espace/${w.slug}?ok=${encodeURIComponent(`${created} table(s) créée(s)`)}#tables`);
}));

router.post('/:slug/tables/auto-assign', guard, asyncRoute(async (req, res) => {
  const { placed, unplaced } = await autoAssignTables(req.w.id);
  const msg = unplaced > 0
    ? `${placed} invité(s) placé(s) automatiquement (${unplaced} sans place : créez une table supplémentaire).`
    : `${placed} invité(s) placé(s) automatiquement selon leur intimité !`;
  res.redirect(`/espace/${req.w.slug}?ok=${encodeURIComponent(msg)}#tables`);
}));

router.post('/:slug/tables/:tableId/delete', guard, asyncRoute(async (req, res) => {
  await deleteTable(req.w.id, Number(req.params.tableId));
  res.redirect(`/espace/${req.w.slug}?ok=${encodeURIComponent('Table supprimée')}#tables`);
}));

// Ajout / import d'invités avec contrôle du quota max et placement à table
router.post('/:slug/invites', guard, asyncRoute(async (req, res) => {
  const w = req.w;
  const currentStats = await stats(w.id);

  if (req.body.bulk) {
    if (currentStats.guests.remainingQuota <= 0) {
      return res.redirect(`/espace/${w.slug}?err=${encodeURIComponent(`Quota maximum de ${w.max_guests} places atteint ! Augmentez votre quota dans l'onglet Tables.`)}#ajouter`);
    }
    const n = await importGuests(w.id, req.body.bulk, req.body.default_category || 'famille_mariee');
    return res.redirect(`/espace/${w.slug}?ok=${encodeURIComponent(n + ' invité(s) importé(s)')}#invites`);
  }

  if (req.body.name) {
    const reqSeats = Math.max(1, Math.min(20, parseInt(req.body.seats, 10) || 1));
    if (currentStats.guests.activeSeats + reqSeats > (w.max_guests || 200)) {
      return res.redirect(
        `/espace/${w.slug}?err=${encodeURIComponent(`Impossible d'ajouter ${reqSeats} place(s) : il ne reste que ${currentStats.guests.remainingQuota} place(s) sur votre quota max de ${w.max_guests}.`)}#ajouter`
      );
    }
    const g = await addGuest(w.id, {
      name: req.body.name,
      phone: req.body.phone,
      seats: reqSeats,
      category: req.body.category,
      table_id: req.body.table_id || 'auto',
    });
    const suffix = g.table_name ? ` → ${g.table_name} (Siège ${g.seat_numbers})` : " (en attente d'une table)";
    return res.redirect(`/espace/${w.slug}?ok=${encodeURIComponent(`Invité ajouté${suffix}`)}#invites`);
  }

  res.redirect(`/espace/${w.slug}#invites`);
}));

// Attribution / changement de table ou d'intimité d'un invité
router.post('/:slug/invites/:id/assign', guard, asyncRoute(async (req, res) => {
  const w = req.w;
  const guest = await store.getGuestById(req.params.id, w.id);
  if (!guest) return res.redirect(`/espace/${w.slug}#invites`);

  if (req.body.category && U.GUEST_CATEGORIES[req.body.category]) {
    await store.updateGuest(guest.id, { category: req.body.category });
  }
  const result = await assignGuestToTable(w.id, guest.id, req.body.table_id);
  if (!result.ok) {
    return res.redirect(`/espace/${w.slug}?err=${encodeURIComponent(result.error)}#invites`);
  }
  const updated = await store.getGuestById(guest.id);
  const msg = updated.table_name
    ? `${updated.name} placé(e) sur ${updated.table_name} (Siège ${updated.seat_numbers})`
    : `${updated.name} retiré(e) de sa table`;
  res.redirect(`/espace/${w.slug}?ok=${encodeURIComponent(msg)}#invites`);
}));

// Modification des informations d'un invité (Nom, Téléphone, Places)
router.post('/:slug/invites/:id/update', guard, asyncRoute(async (req, res) => {
  const w = req.w;
  const guest = await store.getGuestById(req.params.id, w.id);
  if (!guest) return res.redirect(`/espace/${w.slug}#invites`);

  const name = String(req.body.name || '').trim().slice(0, 120);
  if (!name) {
    return res.redirect(`/espace/${w.slug}?err=${encodeURIComponent("Le nom de l'invité ne peut pas être vide.")}#invites`);
  }

  const phone = U.normalizePhone(req.body.phone) || null;
  const newSeats = Math.max(1, Math.min(20, parseInt(req.body.seats, 10) || 1));
  const currentStats = await stats(w.id);

  const oldActiveSeats = guest.status === 'no' ? 0 : (guest.status === 'yes' && guest.attending_count ? guest.attending_count : guest.seats);
  const newActiveSeats = guest.status === 'no' ? 0 : (guest.status === 'yes' && guest.attending_count ? guest.attending_count : newSeats);
  const diffSeats = newActiveSeats - oldActiveSeats;

  if (diffSeats > 0 && currentStats.guests.activeSeats + diffSeats > (w.max_guests || 200)) {
    return res.redirect(
      `/espace/${w.slug}?err=${encodeURIComponent(`Impossible d'attribuer ${newSeats} places : dépassement du quota maximum de ${w.max_guests} places.`)}#invites`
    );
  }

  await store.updateGuest(guest.id, { name, phone, seats: newSeats });

  if (guest.table_id) {
    await recomputeTableSeats(guest.table_id);
  }

  res.redirect(`/espace/${w.slug}?ok=${encodeURIComponent(`Invité « ${name} » modifié avec succès`)}#invites`);
}));

router.post('/:slug/invites/:id/delete', guard, asyncRoute(async (req, res) => {
  const guest = await store.getGuestById(req.params.id, req.w.id);
  await store.deleteGuest(req.params.id, req.w.id);
  if (guest && guest.table_id) await recomputeTableSeats(guest.table_id);
  res.redirect(`/espace/${req.w.slug}?ok=${encodeURIComponent('Invité supprimé')}#invites`);
}));

// Validation / Suppression d'un don de la cagnotte
router.post('/:slug/cagnotte/:id/confirm', guard, asyncRoute(async (req, res) => {
  const contrib = await store.getContributionById(req.params.id);
  if (contrib && contrib.wedding_id === req.w.id) {
    await store.updateContribution(contrib.id, { status: 'complete', paid_at: nowStr() });
  }
  res.redirect(`/espace/${req.w.slug}?ok=${encodeURIComponent('Don validé et ajouté à la cagnotte')}#cagnotte`);
}));

router.post('/:slug/cagnotte/:id/delete', guard, asyncRoute(async (req, res) => {
  await store.deleteContribution(req.params.id, req.w.id);
  res.redirect(`/espace/${req.w.slug}?ok=${encodeURIComponent('Contribution supprimée')}#cagnotte`);
}));

// Appelé en arrière-plan quand on clique sur "Envoyer WhatsApp"
router.post('/:slug/invites/:id/sent', guard, asyncRoute(async (req, res) => {
  const guest = await store.getGuestById(req.params.id, req.w.id);
  if (guest) await store.updateGuest(guest.id, { invited_at: nowStr() });
  res.json({ ok: true });
}));

router.get('/:slug/export.csv', guard, asyncRoute(async (req, res) => {
  const allRows = await store.listGuestsByWedding(req.w.id);
  const rows = [...allRows].sort((a, b) => {
    const nA = a.table_name ? 0 : 1;
    const nB = b.table_name ? 0 : 1;
    if (nA !== nB) return nA - nB;
    const tCmp = String(a.table_name || '').localeCompare(String(b.table_name || ''), 'fr');
    if (tCmp !== 0) return tCmp;
    const sCmp = String(a.seat_numbers || '').localeCompare(String(b.seat_numbers || ''), 'fr');
    if (sCmp !== 0) return sCmp;
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  });
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
}));

// ---------- Contrôle des entrées le jour J ----------
router.get('/:slug/accueil', guard, asyncRoute(async (req, res) => {
  const search = String(req.query.s || '').trim();
  const [allGuests, tables, s] = await Promise.all([
    store.listGuestsByWedding(req.w.id),
    getTablesWithOccupancy(req.w.id),
    stats(req.w.id),
  ]);
  const confirmed = allGuests.filter((g) => g.status === 'yes');
  let guests;
  if (search) {
    const q = search.toLowerCase();
    guests = confirmed
      .filter((g) =>
        String(g.name || '').toLowerCase().includes(q) ||
        String(g.table_name || '').toLowerCase().includes(q) ||
        String(g.token || '').toLowerCase().includes(q)
      )
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'))
      .slice(0, 80);
  } else {
    guests = confirmed
      .sort((a, b) => {
        const cA = a.checked_in_at ? 1 : 0;
        const cB = b.checked_in_at ? 1 : 0;
        if (cA !== cB) return cA - cB;
        const tA = a.table_name ? 0 : 1;
        const tB = b.table_name ? 0 : 1;
        if (tA !== tB) return tA - tB;
        const tCmp = String(a.table_name || '').localeCompare(String(b.table_name || ''), 'fr');
        if (tCmp !== 0) return tCmp;
        return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
      })
      .slice(0, 300);
  }
  res.render('couple/accueil', { w: req.w, guests, tables, search, s });
}));

router.get('/:slug/checkin/:token', guard, asyncRoute(async (req, res) => {
  const guest = await store.getGuestByToken(req.params.token, req.w.id);
  res.render('couple/checkin', { w: req.w, guest, done: req.query.done === '1' });
}));

router.post('/:slug/checkin/:token', guard, asyncRoute(async (req, res) => {
  await store.checkinGuest(req.params.token, req.w.id);
  if (req.body.back === 'accueil') return res.redirect(`/espace/${req.w.slug}/accueil?ok=${encodeURIComponent('Entrée validée ✓')}`);
  res.redirect(`/espace/${req.w.slug}/checkin/${req.params.token}?done=1`);
}));

module.exports = router;
