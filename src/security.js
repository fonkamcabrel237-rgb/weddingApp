// Protection anti-spam & anti-robots respectueuse de la vie privée (Honeypot + Rate Limiting par IP).
const buckets = new Map();

// Nettoyage périodique des compteurs expirés (évite toute fuite mémoire)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets.entries()) {
    if (now > v.resetAt) buckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

/**
 * Champ piège invisible (Honeypot) :
 * Les humains ne voient jamais le champ `website_url` (masqué en CSS + aria-hidden + tabindex=-1).
 * Les robots de spam remplissent automatiquement tous les champs : s'il est rempli, on bloque.
 */
function checkHoneypot(req, res, next) {
  const trap = req.body && (req.body.website_url || req.body.fax_number);
  if (trap && String(trap).trim().length > 0) {
    return res.status(400).render('error', {
      title: 'Envoi bloqué',
      message: 'Comportement automatisé détecté (protection anti-spam).',
    });
  }
  next();
}

/**
 * Limiteur du nombre d'envois par adresse IP (Rate Limiter).
 */
function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 10, keyPrefix = 'global', message = 'Trop d\'envois rapprochés. Merci de patienter quelques minutes avant de réessayer.' } = {}) {
  return function rateLimiter(req, res, next) {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let record = buckets.get(key);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
    }

    record.count += 1;
    buckets.set(key, record);

    const remaining = Math.max(0, max - record.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (record.count > max) {
      const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).render('error', {
        title: 'Trop de tentatives',
        message,
      });
    }

    next();
  };
}

function resetRateLimits() {
  buckets.clear();
}

module.exports = {
  checkHoneypot,
  createRateLimiter,
  resetRateLimits,
};
