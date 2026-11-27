const crypto = require('crypto');

function isHttpsRequest(req) {
  if (req) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '').split(',')[0].trim();
    return proto === 'https';
  }
  return Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
}

const cookieOpts = (days, req) => ({
  path: '/',
  signed: true,
  httpOnly: true,
  sameSite: 'lax',
  secure: isHttpsRequest(req),
  maxAge: days * 24 * 3600 * 1000,
});

function secretSeed() {
  return String(process.env.SESSION_SECRET || 'dev-secret');
}

// Comparaison cryptographique en temps constant via SHA-256 (ne divulgue pas la longueur du secret)
function safeEqual(given, expected) {
  const a = String(given || '');
  const b = String(expected || '');
  if (!a || !b) return false;
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function getAdminPassword() {
  const envPass = String(process.env.ADMIN_PASSWORD || '').trim();
  if (envPass) return envPass;
  if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') return 'change-moi';
  return '';
}

function getAdminAccessKey() {
  return String(process.env.ADMIN_ACCESS_KEY || '').trim();
}

// En production / Vercel, ou dès que ADMIN_ACCESS_KEY est défini, le mode furtif 404 est obligatoire (fail-closed)
function isStealthEnforced() {
  return Boolean(getAdminAccessKey() || process.env.VERCEL || process.env.NODE_ENV === 'production');
}

function adminDeviceToken() {
  const key = getAdminAccessKey();
  if (!key) return '';
  return crypto.createHmac('sha256', secretSeed()).update(`adm-dev:v1:${key}`).digest('hex').slice(0, 32);
}

function adminSessionToken() {
  const pass = getAdminPassword();
  if (!pass) return '';
  const key = getAdminAccessKey();
  return crypto.createHmac('sha256', secretSeed()).update(`adm-sess:v1:${pass}:${key}`).digest('hex').slice(0, 32);
}

function verifyAdminAccessKey(candidate) {
  const key = getAdminAccessKey();
  return Boolean(key) && safeEqual(String(candidate || '').trim(), key);
}

function verifyAdminPassword(candidate) {
  const pass = getAdminPassword();
  return Boolean(pass) && safeEqual(String(candidate || '').trim(), pass);
}

function hasAdminDevice(req) {
  if (!isStealthEnforced()) return true;
  const expected = adminDeviceToken();
  if (!expected) return false;
  return safeEqual(req.signedCookies && req.signedCookies.adm_dev, expected);
}

function isAdmin(req) {
  const expected = adminSessionToken();
  if (!expected) return false;
  if (isStealthEnforced() && !hasAdminDevice(req)) return false;
  return safeEqual(req.signedCookies && req.signedCookies.adm, expected);
}

const hasCoupleAccess = (req, w) => isAdmin(req) || Boolean(
  w && w.access_key && safeEqual(req.signedCookies && req.signedCookies[`c${w.id}`], w.access_key)
);

function renderStealth404(res) {
  return res.status(404).render('error', {
    title: 'Page introuvable',
    message: "Cette page n'existe pas ou a été déplacée.",
  });
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  if (!hasAdminDevice(req)) return renderStealth404(res);
  res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
}

module.exports = {
  cookieOpts,
  safeEqual,
  isStealthEnforced,
  adminDeviceToken,
  adminSessionToken,
  verifyAdminAccessKey,
  verifyAdminPassword,
  hasAdminDevice,
  isAdmin,
  hasCoupleAccess,
  renderStealth404,
  requireAdmin,
};
