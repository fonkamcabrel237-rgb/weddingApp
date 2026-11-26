const express = require('express');
const QRCode = require('qrcode');
const { store, nowStr } = require('../db');
const U = require('../utils');
const payments = require('../payments');
const { upload, saveImage } = require('../uploads');
const { createWedding, addGuest, stats, assignGuestToTable, recomputeTableSeats, ensureDemoSeeded } = require('../weddings');
const { hasCoupleAccess, cookieOpts } = require('../auth');
const { markContribution } = require('./public-helpers');
const { checkHoneypot, createRateLimiter } = require('../security');

const router = express.Router();
const { asyncRoute } = U;

const orderLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'order', message: 'Trop de demandes de commande envoyées. Merci de patienter 15 minutes.' });
const rsvpLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 15, keyPrefix: 'rsvp', message: 'Trop de réponses envoyées coup sur coup. Merci de patienter quelques minutes.' });
const cagnotteLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 15, keyPrefix: 'cagnotte', message: 'Trop de déclarations rapprochées. Merci de patienter quelques minutes.' });

// ---------- Site vitrine ----------
router.get('/', asyncRoute(async (req, res) => {
  await ensureDemoSeeded();
  const demo = await store.getFirstPublishedWedding();
  res.render('landing', { demo, PLANS: U.PLANS, ref: req.query.ref || '' });
}));

router.get('/confidentialite', (req, res) => {
  res.render('privacy');
});

// Formulaire de commande -> crée automatiquement un brouillon de faire-part
router.post('/commande', orderLimiter, upload.array('photos', 30), checkHoneypot, asyncRoute(async (req, res) => {
  const b = req.body;
  if (!b.bride || !b.groom || !b.phone) {
    return res.status(400).render('error', { title: 'Informations manquantes', message: 'Merci de renseigner les prénoms des mariés et un numéro WhatsApp.' });
  }
  const lead = await store.insertLead({
    bride: b.bride,
    groom: b.groom,
    phone: U.normalizePhone(b.phone),
    email: b.email || null,
    city: b.city || null,
    event_date: b.event_date || null,
    event_type: b.event_type || null,
    plan: b.plan || null,
    partner: b.partner || null,
    notes: b.notes || null,
  });

  const w = await createWedding({
    bride: b.bride, groom: b.groom, plan: b.plan, partner: b.partner, event_type: b.event_type,
    event_date: b.event_date, city: b.city, venue_name: b.venue_name, venue_address: b.venue_address,
    maps_query: b.venue_address ? `${b.venue_name || ''} ${b.venue_address} ${b.city || ''}`.trim() : null,
    couple_phone: b.phone, couple_email: b.email, lead_id: lead.id,
    theme: U.THEMES[b.theme] ? b.theme : 'royal',
    custom_bg: b.custom_bg,
    custom_accent: b.custom_accent,
  });
  await store.updateLead(lead.id, { wedding_id: w.id });

  let pos = 0;
  for (const f of req.files || []) {
    const name = await saveImage(f);
    await store.insertPhoto({ wedding_id: w.id, filename: name, position: pos++ });
    if (pos === 1) await store.updateWedding(w.id, { cover_photo: name });
  }

  await U.notify(`🆕 Nouvelle commande ${U.getPlan(w.plan).name} : ${U.coupleNames(w)}\n📅 ${b.event_date || '?'} — ${b.city || '?'}\n📞 ${U.prettyPhone(b.phone)}${b.partner ? `\n🤝 Partenaire : ${b.partner}` : ''}\n✏️ ${U.BASE_URL()}/admin/mariages/${w.id}`);

  res.cookie(`c${w.id}`, w.access_key, cookieOpts(120));
  res.render('merci', { w, plan: U.getPlan(w.plan) });
}));

// ---------- Faire-part ----------
const loadWedding = asyncRoute(async (req, res, next) => {
  if (req.params.slug === 'demo') await ensureDemoSeeded();
  const w = await store.getWeddingBySlug(req.params.slug);
  if (!w || w.status === 'archived') return res.status(404).render('error', { title: 'Invitation introuvable', message: "Ce faire-part n'existe pas ou n'est plus en ligne." });
  if (req.query.k && req.query.k === w.access_key) res.cookie(`c${w.id}`, w.access_key, cookieOpts(120));
  const owner = hasCoupleAccess(req, w) || (req.query.k && req.query.k === w.access_key);
  if (w.status !== 'published' && !owner) {
    return res.status(404).render('error', { title: 'Bientôt disponible', message: 'Ce faire-part est en cours de préparation. Revenez très vite !' });
  }
  req.w = w; req.owner = owner;
  next();
});

router.get('/i/:slug', loadWedding, asyncRoute(async (req, res) => {
  const w = req.w;
  const consentGiven = req.cookies && req.cookies.ndolo_consent === 'accepted';
  if (!req.owner && consentGiven) {
    await store.incrementWeddingViews(w.id, w.views);
  }
  const [guest, photos, allGuests, s, contribSuccess] = await Promise.all([
    req.query.g ? store.getGuestByToken(req.query.g, w.id) : Promise.resolve(null),
    store.listPhotosByWedding(w.id),
    store.listGuestsByWedding(w.id),
    stats(w.id),
    req.query.ok === 'cagnotte_merci' && req.query.c
      ? store.getContributionByRef(req.query.c, w.id)
      : Promise.resolve(null),
  ]);

  const wishes = allGuests
    .filter((g) => g.status === 'yes' && g.message && String(g.message).trim() !== '')
    .sort((a, b) => String(b.responded_at || '').localeCompare(String(a.responded_at || '')))
    .slice(0, 30)
    .map((g) => ({ name: g.name, message: g.message, responded_at: g.responded_at }));

  const deadlinePassed = w.rsvp_deadline && U.parseLocal(w.rsvp_deadline) < new Date();
  res.render('invitation', {
    w, guest, photos, wishes, program: U.parseProgram(w), s, deadlinePassed,
    contribSuccess, isDraft: w.status !== 'published', error: req.query.err || null,
  });
}));

router.post('/i/:slug/rsvp', rsvpLimiter, checkHoneypot, loadWedding, asyncRoute(async (req, res) => {
  const w = req.w;
  if (w.status !== 'published') return res.redirect(`/i/${w.slug}?err=draft#rsvp`);
  const b = req.body;
  const name = String(b.name || '').trim().slice(0, 120);
  const attending = b.attending === 'yes' ? 'yes' : 'no';
  const phone = U.normalizePhone(b.phone);
  if (!name && !b.token && !phone) return res.redirect(`/i/${w.slug}?err=name#rsvp`);

  const prestige = U.isPrestige(w);
  let guest = await store.findGuestForRsvp(w.id, { token: b.token, phone, name });

  if (!guest) {
    if (prestige && w.strict_rsvp) {
      return res.redirect(`/i/${w.slug}?err=not_on_list#rsvp`);
    }
    const currentStats = await stats(w.id);
    const reqSeats = Math.max(1, Math.min(10, parseInt(b.count, 10) || 1));
    if (prestige && attending === 'yes' && currentStats.guests.activeSeats + reqSeats > (w.max_guests || 200)) {
      return res.redirect(`/i/${w.slug}?err=quota_full#rsvp`);
    }
    if (!name) return res.redirect(`/i/${w.slug}?err=name#rsvp`);
    guest = await addGuest(w.id, { name, phone, seats: reqSeats, source: 'public' });
  }

  const max = prestige && guest.source === 'list' ? guest.seats : 10;
  const count = attending === 'yes' ? Math.max(1, Math.min(max, parseInt(b.count, 10) || 1)) : 0;
  const oldTableId = guest.table_id;

  const patch = {
    status: attending,
    attending_count: count,
    message: String(b.message || '').trim().slice(0, 500) || null,
    responded_at: nowStr(),
  };
  if (phone) patch.phone = phone;
  if (guest.source === 'public' && name) patch.name = name;
  await store.updateGuest(guest.id, patch);

  // Mise à jour automatique de la table et des sièges (uniquement pour Prestige VIP)
  if (prestige) {
    if (attending === 'no') {
      await store.updateGuest(guest.id, { table_id: null, table_name: null, seat_numbers: null });
      if (oldTableId) await recomputeTableSeats(oldTableId);
    } else if (oldTableId) {
      await recomputeTableSeats(oldTableId);
    } else {
      await assignGuestToTable(w.id, guest.id, 'auto');
    }
  }

  const updatedGuest = await store.getGuestById(guest.id);
  await U.notify(`${attending === 'yes' ? '✅' : '❌'} RSVP ${U.coupleNames(w)} : ${updatedGuest.name} ${attending === 'yes' ? `vient (${count} pers.)${updatedGuest.table_name ? ' · ' + updatedGuest.table_name : ''}` : 'ne vient pas (place libérée)'}`);
  res.redirect(`/i/${w.slug}/merci?g=${guest.token}`);
}));

router.get('/i/:slug/merci', loadWedding, asyncRoute(async (req, res) => {
  const guest = await store.getGuestByToken(req.query.g || '', req.w.id);
  if (!guest) return res.redirect(`/i/${req.w.slug}`);
  res.render('rsvp-merci', { w: req.w, guest });
}));

// Pass d'entrée (QR) pour le contrôle à l'entrée de la salle (exclusivité Prestige VIP)
router.get('/i/:slug/pass/:token', loadWedding, asyncRoute(async (req, res) => {
  if (!U.isPrestige(req.w)) return res.redirect(`/i/${req.w.slug}`);
  const guest = await store.getGuestByToken(req.params.token, req.w.id);
  if (!guest || guest.status !== 'yes') return res.redirect(`/i/${req.w.slug}`);
  const qr = await QRCode.toDataURL(`${U.BASE_URL()}/espace/${req.w.slug}/checkin/${guest.token}`, { margin: 1, width: 600 });
  res.render('pass', { w: req.w, guest, qr });
}));

// Billet QR téléchargeable (SVG haute définition intégrant QR + Nom de l'invité + Nom de la Table)
router.get('/i/:slug/pass/:token/ticket.svg', loadWedding, asyncRoute(async (req, res) => {
  if (!U.isPrestige(req.w)) return res.redirect(`/i/${req.w.slug}`);
  const guest = await store.getGuestByToken(req.params.token, req.w.id);
  if (!guest || guest.status !== 'yes') return res.redirect(`/i/${req.w.slug}`);
  const qrSvg = await QRCode.toString(`${U.BASE_URL()}/espace/${req.w.slug}/checkin/${guest.token}`, {
    type: 'svg', margin: 1, width: 280,
    color: { dark: '#1a1408', light: '#ffffff' },
  });
  const innerQr = qrSvg.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
  const viewBoxMatch = qrSvg.match(/viewBox="([^"]+)"/i);
  const vb = viewBoxMatch ? viewBoxMatch[1] : '0 0 33 33';
  const escXml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const tableLabel = guest.table_name ? guest.table_name.toUpperCase() : "TABLE ATTRIBUÉE À L'ACCUEIL";
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
}));

router.get('/i/:slug/qr.png', loadWedding, asyncRoute(async (req, res) => {
  const buf = await QRCode.toBuffer(U.inviteUrl(req.w), {
    width: Math.min(1200, parseInt(req.query.size, 10) || 600),
    margin: 2,
  });
  res.type('png').send(buf);
}));

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

// ---------- Cagnotte Directe USSD (MoMo & Orange Money) ----------
router.post('/i/:slug/cagnotte', cagnotteLimiter, checkHoneypot, loadWedding, asyncRoute(async (req, res) => {
  const w = req.w;
  const amount = parseInt(String(req.body.amount || '').replace(/\D/g, ''), 10);
  if (!w.cagnotte_enabled || w.status !== 'published') return res.redirect(`/i/${w.slug}#cagnotte`);
  if (!amount || amount < 500 || amount > 5000000) return res.redirect(`/i/${w.slug}?err=amount#cagnotte`);

  const reference = `ndl-${w.id}-${Date.now()}-${U.token(4)}`;
  const name = String(req.body.name || '').trim().slice(0, 100) || 'Anonyme';
  const phone = U.normalizePhone(req.body.phone);
  const operator = req.body.operator === 'om' ? 'om' : 'momo';
  const message = String(req.body.message || '').trim().slice(0, 300) || null;
  const trxRef = String(req.body.trx_ref || req.body.provider_ref || '').trim().slice(0, 60) || null;

  await store.insertContribution({
    wedding_id: w.id,
    name,
    phone: phone || null,
    amount,
    message,
    reference,
    provider_ref: trxRef,
    provider: operator,
    status: 'pending',
    paid_at: nowStr(),
  });

  await U.notify(
    `💰 Cagnotte ${U.coupleNames(w)} : ${U.fmtMoney(amount)} de ${name} (${operator === 'om' ? 'Orange Money' : 'MTN MoMo'})${trxRef ? ' [Réf: ' + trxRef + ']' : ''}${message ? ' | « ' + message + ' »' : ''}`
  );

  res.redirect(`/i/${w.slug}?ok=cagnotte_merci&c=${reference}#cagnotte`);
}));

router.get('/paiement/retour', asyncRoute(async (req, res) => {
  const refs = [req.query.reference, req.query.trxref, req.query.notchpay_trxref].filter(Boolean).map(String);
  let contrib = await store.findContributionByRefs(refs);
  if (!contrib) return res.status(404).render('error', { title: 'Paiement introuvable', message: 'Référence de paiement inconnue.' });

  if (contrib.status === 'pending') {
    for (const r of [contrib.reference, contrib.provider_ref, ...refs].filter(Boolean)) {
      const trx = await payments.verifyPayment(r).catch(() => null);
      if (!trx) continue;
      if (trx.status === 'complete') await markContribution(contrib, 'complete');
      else if (['failed', 'canceled', 'expired'].includes(trx.status)) await markContribution(contrib, 'failed');
      break;
    }
    contrib = await store.getContributionById(contrib.id);
  }
  const w = await store.getWeddingById(contrib.wedding_id);
  res.render('paiement-retour', { w, contrib });
}));

// Mode démo : simule l'écran de paiement MoMo/OM (aucune vraie transaction)
router.get('/paiement/demo', asyncRoute(async (req, res) => {
  if (payments.mode() !== 'demo') return res.redirect('/');
  const contrib = await store.getContributionByRef(req.query.reference || '');
  if (!contrib) return res.redirect('/');
  const w = await store.getWeddingById(contrib.wedding_id);
  res.render('paiement-demo', { contrib, w });
}));
router.post('/paiement/demo', asyncRoute(async (req, res) => {
  if (payments.mode() !== 'demo') return res.redirect('/');
  const contrib = await store.getContributionByRef(req.body.reference || '');
  if (!contrib) return res.redirect('/');
  await markContribution(contrib, req.body.result === 'ok' ? 'complete' : 'failed');
  res.redirect(`/paiement/retour?reference=${encodeURIComponent(contrib.reference)}`);
}));

module.exports = router;
