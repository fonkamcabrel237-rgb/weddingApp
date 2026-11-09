// Back-office : commandes, faire-part, encaissements, partenaires.
const express = require('express');
const crypto = require('crypto');
const { q } = require('../db');
const U = require('../utils');
const { upload, saveImage, deleteImage } = require('../uploads');
const { createWedding, stats } = require('../weddings');
const { requireAdmin, cookieOpts } = require('../auth');

const router = express.Router();

// ---------- Connexion ----------
const attempts = new Map();
router.get('/login', (req, res) => res.render('admin/login', { error: null, next: req.query.next || '/admin' }));
router.post('/login', (req, res) => {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).render('admin/login', { error: 'Trop de tentatives, réessaie dans 15 min.', next: '/admin' });

  const expected = Buffer.from(String(process.env.ADMIN_PASSWORD || ''));
  const given = Buffer.from(String(req.body.password || ''));
  const ok = expected.length > 0 && expected.length === given.length && crypto.timingSafeEqual(expected, given);
  if (!ok) { a.n++; attempts.set(ip, a); return res.render('admin/login', { error: 'Mot de passe incorrect.', next: req.body.next }); }
  attempts.delete(ip);
  res.cookie('adm', 'ok', cookieOpts(30));
  const next = String(req.body.next || '/admin');
  res.redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/admin');
});
router.get('/logout', (req, res) => { res.clearCookie('adm'); res.redirect('/'); });

router.use(requireAdmin);

// ---------- Tableau de bord ----------
router.get('/', (req, res) => {
  const weddings = q.all('SELECT * FROM weddings ORDER BY (status=\'archived\'), event_date IS NULL, event_date');
  const leads = q.all("SELECT * FROM leads ORDER BY id DESC LIMIT 50");
  const fee = Number(process.env.CAGNOTTE_FEE_PERCENT || 0);
  const k = q.get(`SELECT
      COALESCE(SUM(CASE WHEN paid=1 THEN price END),0) AS cashed,
      COALESCE(SUM(CASE WHEN paid=0 AND status<>'archived' THEN price END),0) AS pending,
      COALESCE(SUM(CASE WHEN paid=1 THEN partner_commission END),0) AS commissions,
      SUM(status='published') AS published, COUNT(*) AS total FROM weddings`);
  const cag = q.get("SELECT COALESCE(SUM(amount),0) AS total FROM contributions WHERE status='complete'");
  const toPay = q.get(`SELECT COALESCE(SUM(c.amount),0) AS total FROM contributions c JOIN weddings w ON w.id=c.wedding_id
      WHERE c.status='complete' AND w.payout_done=0`);
  const partners = q.all(`SELECT partner, COUNT(*) AS n, SUM(paid) AS paid, COALESCE(SUM(CASE WHEN paid=1 THEN partner_commission END),0) AS due
      FROM weddings WHERE partner IS NOT NULL AND partner <> '' GROUP BY partner ORDER BY n DESC`);
  const rows = weddings.map((w) => ({ ...w, s: stats(w.id) }));
  res.render('admin/dashboard', {
    weddings: rows, leads, partners,
    kpi: { ...k, cagnotte: cag.total, cagFees: Math.round(cag.total * fee / 100), toPay: Math.round(toPay.total * (100 - fee) / 100) },
  });
});

router.post('/leads/:id/status', (req, res) => {
  q.run('UPDATE leads SET status = ? WHERE id = ?', req.body.status, req.params.id);
  res.redirect(`/admin?ok=${encodeURIComponent('Statut de la commande mis à jour')}#leads`);
});

// ---------- Faire-part ----------
router.get('/mariages/new', (req, res) => res.render('admin/wedding-form', { w: null, photos: [], program: [] }));

router.post('/mariages', (req, res) => {
  if (!req.body.bride || !req.body.groom) return res.redirect('/admin/mariages/new');
  const w = createWedding({ ...req.body, program: cleanProgram(req.body.program) });
  applyUpdate(w.id, req.body);
  res.redirect(`/admin/mariages/${w.id}?ok=Faire-part%20cr%C3%A9%C3%A9`);
});

router.param('id', (req, res, next, id) => {
  req.w = q.get('SELECT * FROM weddings WHERE id = ?', id);
  if (!req.w) return res.redirect('/admin');
  next();
});

router.get('/mariages/:id', (req, res) => {
  const w = req.w;
  res.render('admin/wedding-form', {
    w, photos: q.all('SELECT * FROM photos WHERE wedding_id = ? ORDER BY position, id', w.id),
    program: U.parseProgram(w), s: stats(w.id),
    lead: w.lead_id ? q.get('SELECT * FROM leads WHERE id = ?', w.lead_id) : null,
  });
});

router.post('/mariages/:id', (req, res) => {
  applyUpdate(req.w.id, req.body);
  res.redirect(`/admin/mariages/${req.w.id}?ok=Enregistr%C3%A9`);
});

router.post('/mariages/:id/action', (req, res) => {
  const w = req.w;
  const a = req.body.action;
  if (a === 'publish') q.run("UPDATE weddings SET status='published' WHERE id = ?", w.id);
  if (a === 'draft') q.run("UPDATE weddings SET status='draft' WHERE id = ?", w.id);
  if (a === 'archive') q.run("UPDATE weddings SET status='archived' WHERE id = ?", w.id);
  if (a === 'paid') q.run('UPDATE weddings SET paid = 1 - paid WHERE id = ?', w.id);
  if (a === 'payout') q.run('UPDATE weddings SET payout_done = 1 - payout_done WHERE id = ?', w.id);
  if (a === 'newkey') q.run('UPDATE weddings SET access_key = ? WHERE id = ?', U.token(12), w.id);
  if (a === 'publish' && w.lead_id) q.run("UPDATE leads SET status='won' WHERE id = ?", w.lead_id);
  if (a === 'delete') {
    q.all('SELECT filename FROM photos WHERE wedding_id = ?', w.id).forEach((p) => deleteImage(p.filename));
    q.run('DELETE FROM weddings WHERE id = ?', w.id);
    return res.redirect('/admin?ok=Supprim%C3%A9');
  }
  res.redirect(`/admin/mariages/${w.id}?ok=OK`);
});

router.post('/mariages/:id/photos', upload.array('photos', 40), async (req, res, next) => {
  try {
    let pos = (q.get('SELECT MAX(position) AS m FROM photos WHERE wedding_id = ?', req.w.id).m || 0) + 1;
    for (const f of req.files || []) {
      const name = await saveImage(f);
      q.run('INSERT INTO photos (wedding_id, filename, position) VALUES (?,?,?)', req.w.id, name, pos++);
      if (!req.w.cover_photo) { q.run('UPDATE weddings SET cover_photo = ? WHERE id = ?', name, req.w.id); req.w.cover_photo = name; }
    }
    res.redirect(`/admin/mariages/${req.w.id}?ok=Photos%20ajout%C3%A9es#photos`);
  } catch (e) { next(e); }
});

router.post('/mariages/:id/photos/:pid', (req, res) => {
  const p = q.get('SELECT * FROM photos WHERE id = ? AND wedding_id = ?', req.params.pid, req.w.id);
  if (p && req.body.action === 'cover') q.run('UPDATE weddings SET cover_photo = ? WHERE id = ?', p.filename, req.w.id);
  if (p && req.body.action === 'delete') {
    q.run('DELETE FROM photos WHERE id = ?', p.id);
    if (req.w.cover_photo === p.filename) q.run('UPDATE weddings SET cover_photo = NULL WHERE id = ?', req.w.id);
    deleteImage(p.filename);
  }
  res.redirect(`/admin/mariages/${req.w.id}#photos`);
});

// ---------- Helpers ----------
function cleanProgram(program) {
  const arr = Array.isArray(program) ? program : Object.values(program || {});
  return arr.map((p) => ({
    title: String(p.title || '').trim(), date: String(p.date || '').trim(),
    place: String(p.place || '').trim(), address: String(p.address || '').trim(),
  })).filter((p) => p.title);
}

function applyUpdate(id, b) {
  const plan = U.PLANS[b.plan] ? b.plan : 'prestige';
  q.run(`UPDATE weddings SET
      slug = COALESCE(NULLIF(?, ''), slug), plan = ?, price = ?, partner = ?, partner_commission = ?, event_type = ?,
      bride = ?, groom = ?, headline = ?, story = ?, hashtag = ?, event_date = ?,
      venue_name = ?, venue_address = ?, city = ?, maps_query = ?, program = ?,
      dress_code = ?, theme = ?, custom_bg = ?, custom_accent = ?, music_url = ?, rsvp_deadline = ?, couple_phone = ?, couple_email = ?,
      cagnotte_enabled = ?, cagnotte_goal = ?, cagnotte_text = ?,
      momo_number = ?, momo_name = ?, om_number = ?, om_name = ?, updated_at = datetime('now')
    WHERE id = ?`,
    uniqueSlugFor(id, b.slug), plan, parseInt(b.price, 10) || U.PLANS[plan].price, b.partner || null,
    parseInt(b.partner_commission, 10) || 0, b.event_type || 'mariage',
    String(b.bride || '').trim(), String(b.groom || '').trim(), b.headline || null, b.story || null, b.hashtag || null,
    b.event_date || null, b.venue_name || null, b.venue_address || null, b.city || null,
    b.maps_query || [b.venue_name, b.venue_address, b.city].filter(Boolean).join(', ') || null,
    JSON.stringify(cleanProgram(b.program)), b.dress_code || null, U.THEMES[b.theme] ? b.theme : 'royal',
    U.sanitizeHex(b.custom_bg, '#faf6f0'), U.sanitizeHex(b.custom_accent, '#b8913f'),
    b.music_url || null, b.rsvp_deadline || null, U.normalizePhone(b.couple_phone) || null, b.couple_email || null,
    b.cagnotte_enabled ? 1 : 0, parseInt(String(b.cagnotte_goal || '').replace(/\D/g, ''), 10) || 0, b.cagnotte_text || null,
    U.normalizePhone(b.momo_number) || null, b.momo_name || null, U.normalizePhone(b.om_number) || null, b.om_name || null,
    id);
}

function uniqueSlugFor(id, wanted) {
  const s = U.slugify(wanted);
  if (!s) return '';
  const other = q.get('SELECT id FROM weddings WHERE slug = ? AND id <> ?', s, id);
  return other ? '' : s;
}

module.exports = router;
