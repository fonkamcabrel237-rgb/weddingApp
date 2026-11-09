const express = require('express');
const QRCode = require('qrcode');
const { q } = require('../db');
const U = require('../utils');
const payments = require('../payments');
const { upload, saveImage } = require('../uploads');
const { createWedding, addGuest, stats, assignGuestToTable, recomputeTableSeats } = require('../weddings');
const { hasCoupleAccess, cookieOpts } = require('../auth');
const { markContribution } = require('./public-helpers');

const router = express.Router();

// ---------- Site vitrine ----------
router.get('/', (req, res) => {
  const demo = q.get("SELECT slug FROM weddings WHERE status='published' ORDER BY (slug='demo') DESC, id LIMIT 1");
  res.render('landing', { demo, PLANS: U.PLANS, ref: req.query.ref || '' });
});

// Formulaire de commande -> crée automatiquement un brouillon de faire-part
router.post('/commande', upload.array('photos', 30), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.bride || !b.groom || !b.phone) {
      return res.status(400).render('error', { title: 'Informations manquantes', message: 'Merci de renseigner les prénoms des mariés et un numéro WhatsApp.' });
    }
    const lead = q.run(`INSERT INTO leads (bride, groom, phone, email, city, event_date, event_type, plan, partner, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, b.bride, b.groom, U.normalizePhone(b.phone), b.email, b.city, b.event_date,
      b.event_type, b.plan, b.partner, b.notes);
    const leadId = Number(lead.lastInsertRowid);

    const w = createWedding({
      bride: b.bride, groom: b.groom, plan: b.plan, partner: b.partner, event_type: b.event_type,
      event_date: b.event_date, city: b.city, venue_name: b.venue_name, venue_address: b.venue_address,
      maps_query: b.venue_address ? `${b.venue_name || ''} ${b.venue_address} ${b.city || ''}`.trim() : null,
      couple_phone: b.phone, couple_email: b.email, lead_id: leadId,
      theme: U.THEMES[b.theme] ? b.theme : 'royal',
      custom_bg: b.custom_bg,
      custom_accent: b.custom_accent,
    });
    q.run('UPDATE leads SET wedding_id = ? WHERE id = ?', w.id, leadId);

    let pos = 0;
    for (const f of req.files || []) {
      const name = await saveImage(f);
      q.run('INSERT INTO photos (wedding_id, filename, position) VALUES (?,?,?)', w.id, name, pos++);
      if (pos === 1) q.run('UPDATE weddings SET cover_photo = ? WHERE id = ?', name, w.id);
    }

    await U.notify(`🆕 Nouvelle commande ${U.PLANS[w.plan].name} : ${U.coupleNames(w)}\n📅 ${b.event_date || '?'} — ${b.city || '?'}\n📞 ${U.prettyPhone(b.phone)}${b.partner ? `\n🤝 Partenaire : ${b.partner}` : ''}\n✏️ ${U.BASE_URL()}/admin/mariages/${w.id}`);

    res.cookie(`c${w.id}`, w.access_key, cookieOpts(120));
    res.render('merci', { w, plan: U.PLANS[w.plan] });
  } catch (e) { next(e); }
});

// ---------- Faire-part ----------
function loadWedding(req, res, next) {
  const w = q.get('SELECT * FROM weddings WHERE slug = ?', req.params.slug);
  if (!w || w.status === 'archived') return res.status(404).render('error', { title: 'Invitation introuvable', message: "Ce faire-part n'existe pas ou n'est plus en ligne." });
  if (req.query.k && req.query.k === w.access_key) res.cookie(`c${w.id}`, w.access_key, cookieOpts(120));
  const owner = hasCoupleAccess(req, w) || (req.query.k && req.query.k === w.access_key);
  if (w.status !== 'published' && !owner) {
    return res.status(404).render('error', { title: 'Bientôt disponible', message: 'Ce faire-part est en cours de préparation. Revenez très vite !' });
  }
  req.w = w; req.owner = owner;
  next();
}

router.get('/i/:slug', loadWedding, (req, res) => {
  const w = req.w;
  const guest = req.query.g ? q.get('SELECT * FROM guests WHERE token = ? AND wedding_id = ?', req.query.g, w.id) : null;
  if (!req.owner) q.run('UPDATE weddings SET views = views + 1 WHERE id = ?', w.id);
  const photos = q.all('SELECT * FROM photos WHERE wedding_id = ? ORDER BY position, id', w.id);
  const wishes = q.all("SELECT name, message, responded_at FROM guests WHERE wedding_id = ? AND message IS NOT NULL AND message <> '' AND status='yes' ORDER BY responded_at DESC LIMIT 30", w.id);
  const deadlinePassed = w.rsvp_deadline && U.parseLocal(w.rsvp_deadline) < new Date();
  res.render('invitation', {
    w, guest, photos, wishes, program: U.parseProgram(w), s: stats(w.id), deadlinePassed,
    isDraft: w.status !== 'published', error: req.query.err || null,
  });
});

router.post('/i/:slug/rsvp', loadWedding, async (req, res) => {
  const w = req.w;
  if (w.status !== 'published') return res.redirect(`/i/${w.slug}?err=draft#rsvp`);
  const b = req.body;
  const name = String(b.name || '').trim().slice(0, 120);
  const attending = b.attending === 'yes' ? 'yes' : 'no';
  const phone = U.normalizePhone(b.phone);
  if (!name && !b.token && !phone) return res.redirect(`/i/${w.slug}?err=name#rsvp`);

  let guest = b.token ? q.get('SELECT * FROM guests WHERE token = ? AND wedding_id = ?', b.token, w.id) : null;
  if (!guest && phone) guest = q.get('SELECT * FROM guests WHERE phone = ? AND wedding_id = ?', phone, w.id);
  if (!guest && name) guest = q.get('SELECT * FROM guests WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND wedding_id = ?', name, w.id);

  if (!guest) {
    if (w.strict_rsvp) {
      return res.redirect(`/i/${w.slug}?err=not_on_list#rsvp`);
    }
    const currentStats = stats(w.id);
    const reqSeats = Math.max(1, Math.min(10, parseInt(b.count, 10) || 1));
    if (attending === 'yes' && currentStats.guests.activeSeats + reqSeats > (w.max_guests || 200)) {
      return res.redirect(`/i/${w.slug}?err=quota_full#rsvp`);
    }
    if (!name) return res.redirect(`/i/${w.slug}?err=name#rsvp`);
    guest = addGuest(w.id, { name, phone, seats: reqSeats, source: 'public' });
  }

  const max = guest.source === 'list' ? guest.seats : 10;
  const count = attending === 'yes' ? Math.max(1, Math.min(max, parseInt(b.count, 10) || 1)) : 0;
  const oldTableId = guest.table_id;

  q.run(`UPDATE guests SET status = ?, attending_count = ?, message = ?, phone = COALESCE(?, phone),
    name = CASE WHEN source='public' AND ? <> '' THEN ? ELSE name END, responded_at = datetime('now') WHERE id = ?`,
    attending, count, String(b.message || '').trim().slice(0, 500) || null, phone || null, name, name, guest.id);

  // Mise à jour automatique de la table et des sièges selon la réponse
  if (attending === 'no') {
    q.run('UPDATE guests SET table_id = NULL, table_name = NULL, seat_numbers = NULL WHERE id = ?', guest.id);
    if (oldTableId) recomputeTableSeats(oldTableId);
  } else if (oldTableId) {
    recomputeTableSeats(oldTableId);
  } else {
    assignGuestToTable(w.id, guest.id, 'auto');
  }

  const updatedGuest = q.get('SELECT * FROM guests WHERE id = ?', guest.id);
  await U.notify(`${attending === 'yes' ? '✅' : '❌'} RSVP ${U.coupleNames(w)} : ${updatedGuest.name} ${attending === 'yes' ? `vient (${count} pers.)${updatedGuest.table_name ? ' · ' + updatedGuest.table_name : ''}` : 'ne vient pas (place libérée)'}`);
  res.redirect(`/i/${w.slug}/merci?g=${guest.token}`);
});

router.get('/i/:slug/merci', loadWedding, (req, res) => {
  const guest = q.get('SELECT * FROM guests WHERE token = ? AND wedding_id = ?', req.query.g || '', req.w.id);
  if (!guest) return res.redirect(`/i/${req.w.slug}`);
  res.render('rsvp-merci', { w: req.w, guest });
});

// Pass d'entrée (QR) pour le contrôle à l'entrée de la salle
router.get('/i/:slug/pass/:token', loadWedding, async (req, res) => {
  const guest = q.get('SELECT * FROM guests WHERE token = ? AND wedding_id = ?', req.params.token, req.w.id);
  if (!guest || guest.status !== 'yes') return res.redirect(`/i/${req.w.slug}`);
  const qr = await QRCode.toDataURL(`${U.BASE_URL()}/espace/${req.w.slug}/checkin/${guest.token}`, { margin: 1, width: 600 });
  res.render('pass', { w: req.w, guest, qr });
});

// Billet QR téléchargeable (SVG haute définition intégrant QR + Nom de l'invité + Nom de la Table)
router.get('/i/:slug/pass/:token/ticket.svg', loadWedding, async (req, res) => {
  const guest = q.get('SELECT * FROM guests WHERE token = ? AND wedding_id = ?', req.params.token, req.w.id);
  if (!guest || guest.status !== 'yes') return res.redirect(`/i/${req.w.slug}`);
  const qrSvg = await QRCode.toString(`${U.BASE_URL()}/espace/${req.w.slug}/checkin/${guest.token}`, {
    type: 'svg', margin: 1, width: 280,
    color: { dark: '#1a1408', light: '#ffffff' },
  });
  const innerQr = qrSvg.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
  const viewBoxMatch = qrSvg.match(/viewBox="([^"]+)"/i);
  const vb = viewBoxMatch ? viewBoxMatch[1] : '0 0 33 33';
  const escXml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const tableLabel = guest.table_name ? guest.table_name.toUpperCase() : 'TABLE ATTRIBUÉE À L\'ACCUEIL';
  const seatsLabel = guest.seat_numbers ? `Siège(s) n° ${guest.seat_numbers}` : `${guest.attending_count} place(s) assise(s)`;
  const catLabel = U.GUEST_CATEGORIES[guest.category]?.short || '';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="820" viewBox="0 0 600 820">
  <rect width="600" height="820" rx="28" fill="#18130d"/>
  <rect x="16" y="16" width="568" height="788" rx="20" fill="#fbf8f2" stroke="#c89d3c" stroke-width="3"/>
  <rect x="16" y="16" width="568" height="120" rx="20" fill="#18130d"/>
  <text x="300" y="54" text-anchor="middle" fill="#c89d3c" font-family="Georgia, serif" font-size="14" letter-spacing="4">PASS D'ENTRÉE OFFICIEL</text>
  <text x="300" y="96" text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="32" font-weight="bold">${escXml(U.coupleNames(req.w))}</text>
  <text x="300" y="122" text-anchor="middle" fill="#d9c398" font-family="Arial, sans-serif" font-size="14">${escXml(U.fmtDate(req.w.event_date))} · ${escXml([req.w.venue_name, req.w.city].filter(Boolean).join(', '))}</text>

  <rect x="150" y="162" width="300" height="300" rx="18" fill="#ffffff" stroke="#e5dccb" stroke-width="2"/>
  <svg x="165" y="177" width="270" height="270" viewBox="${vb}">${innerQr}</svg>

  <text x="300" y="492" text-anchor="middle" fill="#7c7265" font-family="Arial, sans-serif" font-size="13" letter-spacing="2">INVITÉ(E) CONFIRMÉ(E)</text>
  <text x="300" y="528" text-anchor="middle" fill="#18130d" font-family="Georgia, serif" font-size="30" font-weight="bold">${escXml(guest.name)}</text>
  <text x="300" y="556" text-anchor="middle" fill="#5a5043" font-family="Arial, sans-serif" font-size="16" font-weight="bold">Valable pour ${guest.attending_count} personne(s)${catLabel ? ' · ' + escXml(catLabel) : ''}</text>

  <rect x="48" y="582" width="504" height="128" rx="16" fill="#18130d" stroke="#c89d3c" stroke-width="2"/>
  <text x="300" y="616" text-anchor="middle" fill="#c89d3c" font-family="Arial, sans-serif" font-size="13" font-weight="bold" letter-spacing="3">VOTRE TABLE &amp; PLACE ASSISE</text>
  <text x="300" y="656" text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="28" font-weight="bold">${escXml(tableLabel)}</text>
  <text x="300" y="690" text-anchor="middle" fill="#f3d486" font-family="Arial, sans-serif" font-size="18" font-weight="bold">${escXml(seatsLabel)}</text>

  <text x="300" y="750" text-anchor="middle" fill="#5a5043" font-family="Arial, sans-serif" font-size="14">Code Pass : ${escXml(guest.token.toUpperCase())} — Présentez ce QR code à l'entrée</text>
  <text x="300" y="778" text-anchor="middle" fill="#9a8f7f" font-family="Arial, sans-serif" font-size="12">Ndolo Invitations</text>
</svg>`;
  res.type('image/svg+xml');
  if (req.query.dl) res.attachment(`pass-${req.w.slug}-${U.slugify(guest.name)}.svg`);
  res.send(svg);
});

router.get('/i/:slug/qr.png', loadWedding, async (req, res) => {
  res.type('png');
  QRCode.toFileStream(res, U.inviteUrl(req.w), { width: Math.min(1200, parseInt(req.query.size, 10) || 600), margin: 2 });
});

router.get('/i/:slug/calendar.ics', loadWedding, (req, res) => {
  const w = req.w;
  const start = U.parseLocal(w.event_date) || new Date();
  const end = new Date(start.getTime() + 6 * 3600 * 1000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  res.type('text/calendar').attachment(`${w.slug}.ics`).send([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ndolo//Invitations//FR', 'BEGIN:VEVENT',
    `UID:${w.slug}@ndolo`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`,
    `SUMMARY:${esc('Mariage ' + U.coupleNames(w))}`,
    `LOCATION:${esc([w.venue_name, w.venue_address, w.city].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${esc(U.inviteUrl(w))}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n'));
});

// ---------- Cagnotte ----------
router.post('/i/:slug/cagnotte', loadWedding, async (req, res) => {
  const w = req.w;
  const amount = parseInt(String(req.body.amount || '').replace(/\D/g, ''), 10);
  if (!w.cagnotte_enabled || w.status !== 'published') return res.redirect(`/i/${w.slug}#cagnotte`);
  if (!amount || amount < 500 || amount > 5000000) return res.redirect(`/i/${w.slug}?err=amount#cagnotte`);

  const reference = `ndl-${w.id}-${Date.now()}-${U.token(4)}`;
  const name = String(req.body.name || '').trim().slice(0, 100) || 'Anonyme';
  const phone = U.normalizePhone(req.body.phone);
  q.run('INSERT INTO contributions (wedding_id, name, phone, amount, message, reference, provider) VALUES (?,?,?,?,?,?,?)',
    w.id, name, phone || null, amount, String(req.body.message || '').trim().slice(0, 300) || null, reference, payments.mode());
  try {
    const r = await payments.initPayment({
      amount, reference,
      description: `Cagnotte mariage ${U.coupleNames(w)}`,
      callback: `${U.BASE_URL()}/paiement/retour`,
      customer: { name, phone, email: req.body.email },
    });
    if (r.providerRef) q.run('UPDATE contributions SET provider_ref = ? WHERE reference = ?', r.providerRef, reference);
    res.redirect(r.url);
  } catch (e) {
    console.error('Init paiement:', e.message);
    q.run("UPDATE contributions SET status='failed' WHERE reference = ?", reference);
    res.redirect(`/i/${w.slug}?err=payment#cagnotte`);
  }
});

router.get('/paiement/retour', async (req, res) => {
  const refs = [req.query.reference, req.query.trxref, req.query.notchpay_trxref].filter(Boolean).map(String);
  let contrib = refs.map((r) => q.get('SELECT * FROM contributions WHERE reference = ? OR provider_ref = ?', r, r)).find(Boolean);
  if (!contrib) return res.status(404).render('error', { title: 'Paiement introuvable', message: 'Référence de paiement inconnue.' });

  if (contrib.status === 'pending') {
    for (const r of [contrib.reference, contrib.provider_ref, ...refs].filter(Boolean)) {
      const trx = await payments.verifyPayment(r).catch(() => null);
      if (!trx) continue;
      if (trx.status === 'complete') await markContribution(contrib, 'complete');
      else if (['failed', 'canceled', 'expired'].includes(trx.status)) await markContribution(contrib, 'failed');
      break;
    }
    contrib = q.get('SELECT * FROM contributions WHERE id = ?', contrib.id);
  }
  const w = q.get('SELECT * FROM weddings WHERE id = ?', contrib.wedding_id);
  res.render('paiement-retour', { w, contrib });
});

// Mode démo : simule l'écran de paiement MoMo/OM (aucune vraie transaction)
router.get('/paiement/demo', (req, res) => {
  if (payments.mode() !== 'demo') return res.redirect('/');
  const contrib = q.get('SELECT * FROM contributions WHERE reference = ?', req.query.reference || '');
  if (!contrib) return res.redirect('/');
  res.render('paiement-demo', { contrib, w: q.get('SELECT * FROM weddings WHERE id = ?', contrib.wedding_id) });
});
router.post('/paiement/demo', async (req, res) => {
  if (payments.mode() !== 'demo') return res.redirect('/');
  const contrib = q.get('SELECT * FROM contributions WHERE reference = ?', req.body.reference || '');
  if (!contrib) return res.redirect('/');
  await markContribution(contrib, req.body.result === 'ok' ? 'complete' : 'failed');
  res.redirect(`/paiement/retour?reference=${encodeURIComponent(contrib.reference)}`);
});

module.exports = router;
