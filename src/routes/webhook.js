// Webhook Notch Pay : confirme automatiquement les dons de la cagnotte.
const { q } = require('../db');
const payments = require('../payments');
const { markContribution } = require('./public-helpers');

module.exports = async function notchpayWebhook(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!payments.verifyWebhookSignature(raw, req.get('x-notch-signature'))) {
    return res.status(401).json({ error: 'invalid signature' });
  }
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'bad json' }); }

  const data = event.data || {};
  const refs = [data.merchant_reference, data.reference, data.trxref].filter(Boolean);
  const contrib = refs.map((r) => q.get('SELECT * FROM contributions WHERE reference = ? OR provider_ref = ?', r, r)).find(Boolean);
  if (!contrib) return res.json({ ok: true, ignored: true });

  if (event.type === 'payment.complete' || data.status === 'complete') await markContribution(contrib, 'complete');
  else if (/failed|canceled|expired/.test(event.type || '') || /failed|canceled|expired/.test(data.status || '')) await markContribution(contrib, 'failed');

  res.json({ ok: true });
};
