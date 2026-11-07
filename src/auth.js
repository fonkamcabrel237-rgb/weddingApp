const cookieOpts = (days) => ({
  signed: true, httpOnly: true, sameSite: 'lax',
  secure: String(process.env.BASE_URL || '').startsWith('https'),
  maxAge: days * 24 * 3600 * 1000,
});

const isAdmin = (req) => req.signedCookies && req.signedCookies.adm === 'ok';
const hasCoupleAccess = (req, w) => isAdmin(req) || (req.signedCookies && req.signedCookies[`c${w.id}`] === w.access_key);

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
}

module.exports = { cookieOpts, isAdmin, hasCoupleAccess, requireAdmin };
