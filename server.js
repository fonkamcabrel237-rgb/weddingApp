require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { UPLOAD_DIR } = require('./src/db');
const utils = require('./src/utils');
const payments = require('./src/payments');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.startsWith('remplace')) {
  console.warn('⚠️  SESSION_SECRET non défini : définis-le dans .env avant la mise en production.');
}

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Webhook Notch Pay : corps brut nécessaire pour vérifier la signature -> avant les parsers
app.post('/webhooks/notchpay', express.raw({ type: '*/*', limit: '1mb' }), require('./src/routes/webhook'));

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-secret'));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

// Variables disponibles dans toutes les vues
app.use((req, res, next) => {
  Object.assign(res.locals, utils, {
    brand: process.env.BRAND_NAME || 'Ndolo Invitations',
    businessWhatsapp: process.env.BUSINESS_WHATSAPP || '',
    businessEmail: process.env.BUSINESS_EMAIL || '',
    baseUrl: utils.BASE_URL(),
    paymentMode: payments.mode(),
    path: req.path,
    flash: req.query.ok || null,
  });
  next();
});

app.use('/admin', require('./src/routes/admin'));
app.use('/espace', require('./src/routes/couple'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => res.status(404).render('error', { title: 'Page introuvable', message: "Cette page n'existe pas ou a été déplacée." }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Oups…', message: 'Une erreur est survenue. Réessaie dans un instant.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`💍 ${process.env.BRAND_NAME || 'Ndolo Invitations'} en ligne sur http://localhost:${PORT}`));
