// Back-office : commandes, faire-part, encaissements, partenaires.
const express = require('express');
const crypto = require('crypto');
const { store } = require('../db');
const U = require('../utils');
const { upload, uploadAudio, saveImage, saveAudio, createAudioUploadSession, resolveMusicUrl, deleteImage } = require('../uploads');
const { createWedding, stats, ensureDemoSeeded } = require('../weddings');
const {
  requireAdmin,
  cookieOpts,
  hasAdminDevice,
  isAdmin,
  adminDeviceToken,
  adminSessionToken,
  verifyAdminAccessKey,
  verifyAdminPassword,
  renderStealth404,
} = require('../auth');
const { createRateLimiter } = require('../security');

const router = express.Router();
const { asyncRoute } = U;

const adminLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyPrefix: 'admin_login',
  message: 'Trop de tentatives, réessayez dans 15 minutes.',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failDelayMs = () => (process.env.NODE_ENV === 'test' ? 25 : 900);

// En-têtes de sécurité systématiques sur tout le périmètre /admin
router.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store, private');
  next();
});

// Déverrouillage d'appareil via le favori secret (?key=ADMIN_ACCESS_KEY) sur /admin ou /admin/login
router.use(asyncRoute(async (req, res, next) => {
  if (req.method === 'GET' && typeof req.query.key === 'string' && (req.path === '/' || req.path === '/login')) {
    if (!verifyAdminAccessKey(req.query.key)) {
      await sleep(failDelayMs());
      return renderStealth404(res);
    }
    res.cookie('adm_dev', adminDeviceToken(), cookieOpts(90, req));
    return res.redirect(isAdmin(req) ? '/admin' : '/admin/login');
  }
  next();
}));

// ---------- Connexion ----------
router.get('/login', (req, res) => {
  if (!hasAdminDevice(req)) return renderStealth404(res);
  if (isAdmin(req)) return res.redirect('/admin');
  const rawNext = String(req.query.next || '/admin');
  const safeNext = rawNext.startsWith('/admin') && !rawNext.startsWith('//') ? rawNext : '/admin';
  res.render('admin/login', { error: null, next: safeNext });
});

router.post('/login', adminLoginLimiter, asyncRoute(async (req, res) => {
  if (!hasAdminDevice(req)) {
    await sleep(failDelayMs());
    return renderStealth404(res);
  }

  const rawNext = String(req.body.next || '/admin');
  const safeNext = rawNext.startsWith('/admin') && !rawNext.startsWith('//') ? rawNext : '/admin';

  if (!verifyAdminPassword(req.body.password)) {
    await sleep(failDelayMs());
    return res.status(401).render('admin/login', { error: 'Mot de passe incorrect.', next: safeNext });
  }

  const devTok = adminDeviceToken();
  if (devTok) res.cookie('adm_dev', devTok, cookieOpts(90, req));
  res.cookie('adm', adminSessionToken(), cookieOpts(30, req));
  res.redirect(safeNext);
}));

router.get('/logout', (req, res) => {
  if (!hasAdminDevice(req) && !isAdmin(req)) return renderStealth404(res);
  res.clearCookie('adm', { path: '/' });
  if (req.query.lock === '1') {
    res.clearCookie('adm_dev', { path: '/' });
  }
  res.redirect('/');
});

router.use(requireAdmin);

// ---------- Tableau de bord ----------
router.get('/', asyncRoute(async (req, res) => {
  await ensureDemoSeeded();
  const [weddings, leads, completedContribs] = await Promise.all([
    store.listWeddings(),
    store.listLeads(50),
    store.listAllCompletedContributions(),
  ]);
  const fee = Number(process.env.CAGNOTTE_FEE_PERCENT || 0);

  let cashed = 0;
  let pending = 0;
  let commissions = 0;
  let published = 0;
  const unpaidPayoutWeddingIds = new Set();
  const partnerMap = new Map();

  for (const w of weddings) {
    if (w.paid) {
      cashed += Number(w.price) || 0;
      commissions += Number(w.partner_commission) || 0;
    } else if (w.status !== 'archived') {
      pending += Number(w.price) || 0;
    }
    if (w.status === 'published') published++;
    if (!w.payout_done) unpaidPayoutWeddingIds.add(w.id);

    if (w.partner && String(w.partner).trim()) {
      const key = String(w.partner).trim();
      const cur = partnerMap.get(key) || { partner: key, n: 0, paid: 0, due: 0 };
      cur.n += 1;
      cur.paid += w.paid ? 1 : 0;
      cur.due += w.paid ? (Number(w.partner_commission) || 0) : 0;
      partnerMap.set(key, cur);
    }
  }

  const partners = [...partnerMap.values()].sort((a, b) => b.n - a.n);
  const cagTotal = completedContribs.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  const toPayTotal = completedContribs
    .filter((c) => unpaidPayoutWeddingIds.has(c.wedding_id))
    .reduce((acc, c) => acc + (Number(c.amount) || 0), 0);

  const rows = await Promise.all(weddings.map(async (w) => ({ ...w, s: await stats(w.id) })));

  res.render('admin/dashboard', {
    weddings: rows,
    leads,
    partners,
    kpi: {
      cashed,
      pending,
      commissions,
      published,
      total: weddings.length,
      cagnotte: cagTotal,
      cagFees: Math.round((cagTotal * fee) / 100),
      toPay: Math.round((toPayTotal * (100 - fee)) / 100),
    },
  });
}));

router.post('/leads/:id/status', asyncRoute(async (req, res) => {
  await store.updateLead(req.params.id, { status: req.body.status });
  res.redirect(`/admin?ok=${encodeURIComponent('Statut de la commande mis à jour')}#leads`);
}));

// ---------- Faire-part ----------
router.get('/mariages/new', (req, res) => res.render('admin/wedding-form', { w: null, photos: [], program: [] }));

router.post('/mariages', asyncRoute(async (req, res) => {
  if (!req.body.bride || !req.body.groom) return res.redirect('/admin/mariages/new');
  req.body.music_url = await resolveMusicUrl(req.body.music_url);
  const w = await createWedding({ ...req.body, program: cleanProgram(req.body.program) });
  await applyUpdate(w.id, req.body);
  res.redirect(`/admin/mariages/${w.id}?ok=Faire-part%20cr%C3%A9%C3%A9`);
}));

// URL signée Supabase Storage pour uploader des MP3 > 4.5 Mo directement depuis le navigateur (contourne la limite Vercel)
router.post('/upload-audio-url', asyncRoute(async (req, res) => {
  const session = await createAudioUploadSession(req.body.filename || 'musique.mp3');
  if (!session) return res.json({ ok: true, mode: 'local' });
  res.json({ ok: true, mode: 'supabase', ...session });
}));

router.post('/save-audio-url', asyncRoute(async (req, res) => {
  const url = String(req.body.url || '').trim();
  if (!url) return res.status(400).json({ ok: false, error: 'URL audio manquante.' });
  if (req.body.wedding_id) {
    await store.updateWedding(req.body.wedding_id, { music_url: url });
  }
  res.json({ ok: true, url });
}));

// Upload direct d'un fichier audio (petits fichiers MP3 ou développement local)
router.post('/upload-audio', uploadAudio.single('audio'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Aucun fichier audio valide reçu.' });
  const url = await saveAudio(req.file);
  if (req.body.wedding_id) {
    await store.updateWedding(req.body.wedding_id, { music_url: url });
  }
  res.json({ ok: true, url });
}));

router.param('id', (req, res, next, id) => {
  store.getWeddingById(id)
    .then((w) => {
      if (!w) return res.redirect('/admin');
      req.w = w;
      next();
    })
    .catch(next);
});

router.get('/mariages/:id', asyncRoute(async (req, res) => {
  const w = req.w;
  const [photos, s, lead] = await Promise.all([
    store.listPhotosByWedding(w.id),
    stats(w.id),
    w.lead_id ? store.getLeadById(w.lead_id) : Promise.resolve(null),
  ]);
  res.render('admin/wedding-form', {
    w,
    photos,
    program: U.parseProgram(w),
    s,
    lead,
  });
}));

router.post('/mariages/:id', asyncRoute(async (req, res) => {
  req.body.music_url = await resolveMusicUrl(req.body.music_url);
  await applyUpdate(req.w.id, req.body);
  res.redirect(`/admin/mariages/${req.w.id}?ok=Enregistr%C3%A9`);
}));

router.post('/mariages/:id/action', asyncRoute(async (req, res) => {
  const w = req.w;
  const a = req.body.action;
  if (a === 'publish') await store.updateWedding(w.id, { status: 'published' });
  if (a === 'draft') await store.updateWedding(w.id, { status: 'draft' });
  if (a === 'archive') await store.updateWedding(w.id, { status: 'archived' });
  if (a === 'paid') await store.updateWedding(w.id, { paid: w.paid ? 0 : 1 });
  if (a === 'payout') await store.updateWedding(w.id, { payout_done: w.payout_done ? 0 : 1 });
  if (a === 'newkey') await store.updateWedding(w.id, { access_key: U.token(12) });
  if (a === 'publish' && w.lead_id) await store.updateLead(w.lead_id, { status: 'won' });
  if (a === 'delete') {
    const photos = await store.listPhotosByWedding(w.id);
    await Promise.all(photos.map((p) => deleteImage(p.filename)));
    await store.deleteWedding(w.id);
    return res.redirect('/admin?ok=Supprim%C3%A9');
  }
  res.redirect(`/admin/mariages/${w.id}?ok=OK`);
}));

router.post('/mariages/:id/photos', upload.array('photos', 40), asyncRoute(async (req, res) => {
  const existing = await store.listPhotosByWedding(req.w.id);
  let pos = existing.reduce((m, p) => Math.max(m, p.position || 0), 0) + 1;
  for (const f of req.files || []) {
    const name = await saveImage(f);
    await store.insertPhoto({ wedding_id: req.w.id, filename: name, position: pos++ });
    if (!req.w.cover_photo) {
      await store.updateWedding(req.w.id, { cover_photo: name });
      req.w.cover_photo = name;
    }
  }
  res.redirect(`/admin/mariages/${req.w.id}?ok=Photos%20ajout%C3%A9es#photos`);
}));

router.post('/mariages/:id/photos/:pid', asyncRoute(async (req, res) => {
  const p = await store.getPhotoById(req.params.pid, req.w.id);
  if (p && req.body.action === 'cover') {
    await store.updateWedding(req.w.id, { cover_photo: p.filename });
  }
  if (p && req.body.action === 'delete') {
    await store.deletePhoto(p.id);
    if (req.w.cover_photo === p.filename) {
      await store.updateWedding(req.w.id, { cover_photo: null });
    }
    await deleteImage(p.filename);
  }
  res.redirect(`/admin/mariages/${req.w.id}#photos`);
}));

// ---------- Helpers ----------
function cleanProgram(program) {
  const arr = Array.isArray(program) ? program : Object.values(program || {});
  return arr.map((p) => ({
    title: String(p.title || '').trim(),
    date: String(p.date || '').trim(),
    place: String(p.place || '').trim(),
    address: String(p.address || '').trim(),
  })).filter((p) => p.title);
}

async function applyUpdate(id, b) {
  const plan = U.normalizePlan(b.plan);
  const prestige = U.isPrestige(plan);
  const nextSlug = await uniqueSlugFor(id, b.slug);
  const wantedTheme = U.THEMES[b.theme] ? b.theme : 'royal';
  const patch = {
    plan,
    price: parseInt(b.price, 10) || U.PLANS[plan].price,
    partner: b.partner || null,
    partner_commission: parseInt(b.partner_commission, 10) || 0,
    event_type: b.event_type || 'mariage',
    bride: String(b.bride || '').trim(),
    groom: String(b.groom || '').trim(),
    headline: b.headline || null,
    story: b.story || null,
    hashtag: b.hashtag || null,
    event_date: b.event_date || null,
    venue_name: b.venue_name || null,
    venue_address: b.venue_address || null,
    city: b.city || null,
    maps_query: b.maps_query || [b.venue_name, b.venue_address, b.city].filter(Boolean).join(', ') || null,
    program: JSON.stringify(cleanProgram(b.program)),
    dress_code: b.dress_code || null,
    theme: !prestige && wantedTheme === 'custom' ? 'royal' : wantedTheme,
    custom_bg: U.sanitizeHex(b.custom_bg, '#faf6f0'),
    custom_accent: U.sanitizeHex(b.custom_accent, '#b8913f'),
    music_url: b.music_url || null,
    rsvp_deadline: b.rsvp_deadline || null,
    couple_phone: U.normalizePhone(b.couple_phone) || null,
    couple_email: b.couple_email || null,
    cagnotte_enabled: b.cagnotte_enabled ? 1 : 0,
    cagnotte_goal: parseInt(String(b.cagnotte_goal || '').replace(/\D/g, ''), 10) || 0,
    cagnotte_text: b.cagnotte_text || null,
    momo_number: U.normalizePhone(b.momo_number) || null,
    momo_name: b.momo_name || null,
    om_number: U.normalizePhone(b.om_number) || null,
    om_name: b.om_name || null,
  };
  if (!prestige) patch.strict_rsvp = 0;
  if (nextSlug) patch.slug = nextSlug;
  await store.updateWedding(id, patch);
}

async function uniqueSlugFor(id, wanted) {
  const s = U.slugify(wanted);
  if (!s) return '';
  const other = await store.findWeddingBySlugExceptId(s, id);
  return other ? '' : s;
}

module.exports = router;
