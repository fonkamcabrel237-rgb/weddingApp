// Espace des mariés : suivi RSVP, envoi WhatsApp, relances, cagnotte, contrôle des entrées.
const express = require('express');
const { q } = require('../db');
const U = require('../utils');
const { importGuests, addGuest, stats } = require('../weddings');
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
  const filter = ['yes', 'no', 'pending'].includes(req.query.f) ? req.query.f : null;
  const guests = q.all(`SELECT * FROM guests WHERE wedding_id = ? ${filter ? 'AND status = ?' : ''} ORDER BY
    CASE status WHEN 'yes' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, name`, ...(filter ? [w.id, filter] : [w.id]));
  const contributions = q.all("SELECT * FROM contributions WHERE wedding_id = ? AND status='complete' ORDER BY paid_at DESC", w.id);
  const daysLeft = w.event_date ? Math.ceil((U.parseLocal(w.event_date) - new Date()) / 86400000) : null;
  res.render('couple/dashboard', { w, guests, contributions, s: stats(w.id), filter, daysLeft, query: req.query });
});

router.post('/:slug/invites', guard, (req, res) => {
  let n = 0;
  if (req.body.bulk) n = importGuests(req.w.id, req.body.bulk);
  else if (req.body.name) { addGuest(req.w.id, req.body); n = 1; }
  res.redirect(`/espace/${req.w.slug}?ok=${encodeURIComponent(n + ' invité(s) ajouté(s)')}#invites`);
});

router.post('/:slug/invites/:id/delete', guard, (req, res) => {
  q.run('DELETE FROM guests WHERE id = ? AND wedding_id = ?', req.params.id, req.w.id);
  res.redirect(`/espace/${req.w.slug}#invites`);
});

// Appelé en arrière-plan quand on clique sur "Envoyer WhatsApp"
router.post('/:slug/invites/:id/sent', guard, (req, res) => {
  q.run("UPDATE guests SET invited_at = datetime('now') WHERE id = ? AND wedding_id = ?", req.params.id, req.w.id);
  res.json({ ok: true });
});

router.get('/:slug/export.csv', guard, (req, res) => {
  const rows = q.all('SELECT * FROM guests WHERE wedding_id = ? ORDER BY name', req.w.id);
  const label = { yes: 'Présent', no: 'Absent', pending: 'Sans réponse' };
  const lines = [['Nom', 'Téléphone', 'Places prévues', 'Réponse', 'Nombre confirmé', 'Message', 'Date réponse', 'Arrivé à'].join(';')];
  for (const g of rows) {
    lines.push([g.name, U.prettyPhone(g.phone), g.seats, label[g.status], g.attending_count, g.message, g.responded_at, g.checked_in_at].map(U.csvEscape).join(';'));
  }
  res.type('text/csv').attachment(`invites-${req.w.slug}.csv`).send('\ufeff' + lines.join('\r\n'));
});

// ---------- Contrôle des entrées le jour J ----------
router.get('/:slug/accueil', guard, (req, res) => {
  const search = String(req.query.s || '').trim();
  const guests = search
    ? q.all("SELECT * FROM guests WHERE wedding_id = ? AND status='yes' AND name LIKE ? ORDER BY name LIMIT 50", req.w.id, `%${search}%`)
    : q.all("SELECT * FROM guests WHERE wedding_id = ? AND status='yes' ORDER BY checked_in_at IS NOT NULL, name LIMIT 300", req.w.id);
  res.render('couple/accueil', { w: req.w, guests, search, s: stats(req.w.id) });
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
