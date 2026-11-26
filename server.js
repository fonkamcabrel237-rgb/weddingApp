require('dotenv').config();
const express = require('express');
const ejs = require('ejs');
const path = require('path');
const cookieParser = require('cookie-parser');
const { UPLOAD_DIR, store } = require('./src/db');
const utils = require('./src/utils');
const payments = require('./src/payments');
const { isSupabaseEnabled, getPublicMediaUrl } = require('./src/supabase');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.startsWith('remplace')) {
  console.warn('⚠️  SESSION_SECRET non défini : définis-le dans les variables d’environnement en production.');
}

const app = express();
app.engine('ejs', ejs.__express);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Webhook Notch Pay : corps brut nécessaire pour vérifier la signature -> avant les parsers
app.post('/webhooks/notchpay', express.raw({ type: '*/*', limit: '1mb' }), require('./src/routes/webhook'));

app.use(express.urlencoded({ extended: true, limit: '4mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-secret'));

app.use('/static', express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
}));
app.use('/img', express.static(path.join(__dirname, 'public', 'img'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
}));

// Médias : en mode Supabase, redirection transparente vers le CDN public Supabase Storage
app.get('/uploads/:filename', (req, res, next) => {
  if (isSupabaseEnabled()) {
    return res.redirect(302, getPublicMediaUrl(req.params.filename));
  }
  next();
});
if (!isSupabaseEnabled()) {
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
}

app.get('/google77ad2c934068be32.html', (req, res) => {
  res.type('text/html').send('google-site-verification: google77ad2c934068be32.html');
});

app.get('/robots.txt', (req, res) => {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'www.ndolos.site').split(',')[0].trim();
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /espace\nSitemap: ${proto}://${host}/sitemap.xml\n`
  );
});

app.get('/sitemap.xml', (req, res) => {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'www.ndolos.site').split(',')[0].trim();
  const base = `${proto}://${host}`;
  const today = new Date().toISOString().slice(0, 10);
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${base}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n` +
    `  <url><loc>${base}/i/demo</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n` +
    `  <url><loc>${base}/confidentialite</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.3</priority></url>\n` +
    `</urlset>`
  );
});

app.get('/healthz', (req, res) => {
  res.status(200).json({
    ok: true,
    storage: isSupabaseEnabled() ? 'supabase' : 'local',
    db: store.mode,
  });
});

// Variables disponibles dans toutes les vues EJS
app.use((req, res, next) => {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  const reqBaseUrl = host ? `${proto}://${host}` : utils.BASE_URL();

  Object.assign(res.locals, utils, {
    brand: process.env.BRAND_NAME || 'Ndolo Invitations',
    businessWhatsapp: process.env.BUSINESS_WHATSAPP || '',
    businessEmail: process.env.BUSINESS_EMAIL || 'contact@ndolos.site',
    baseUrl: reqBaseUrl,
    paymentMode: payments.mode(),
    path: req.path,
    flash: req.query.ok || null,
    flashError: req.query.err || null,
  });
  next();
});

app.use('/admin', require('./src/routes/admin'));
app.use('/espace', require('./src/routes/couple'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => res.status(404).render('error', {
  title: 'Page introuvable',
  message: "Cette page n'existe pas ou a été déplacée.",
}));

app.use((err, req, res, next) => {
  console.error('[server-error]', err);
  res.status(500).render('error', {
    title: 'Oups…',
    message: 'Une erreur est survenue. Réessaie dans un instant.',
  });
});

// Démarrage HTTP classique en local uniquement (sur Vercel, `api/index.js` exporte `app` en Serverless)
if (require.main === module && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  const IP = process.env.IP || '0.0.0.0';
  app.listen(PORT, IP, () => {
    console.log(`💍 ${process.env.BRAND_NAME || 'Ndolo Invitations'} en ligne sur http://${IP}:${PORT} (Base : ${isSupabaseEnabled() ? 'Supabase ☁️' : 'SQLite local'})`);
  });
}

module.exports = app;
