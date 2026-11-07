// Intégration Notch Pay (MTN MoMo + Orange Money) — https://developer.notchpay.co
const crypto = require('crypto');

const API = 'https://api.notchpay.co';

function mode() {
  if (process.env.NOTCHPAY_PUBLIC_KEY) return 'live';
  if (String(process.env.DEMO_PAYMENTS || 'true') !== 'false') return 'demo';
  return 'off';
}

async function initPayment({ amount, reference, description, callback, customer }) {
  if (mode() === 'demo') return { url: `/paiement/demo?reference=${encodeURIComponent(reference)}` };
  if (mode() === 'off') throw new Error('Paiement en ligne non configuré');

  const cust = { name: customer.name || 'Invité' };
  if (customer.email) cust.email = customer.email;
  if (customer.phone) cust.phone = '+' + customer.phone;

  const res = await fetch(`${API}/payments`, {
    method: 'POST',
    headers: { Authorization: process.env.NOTCHPAY_PUBLIC_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ amount, currency: 'XAF', reference, description, callback, customer: cust }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authorization_url) {
    throw new Error(data.message || `Notch Pay a répondu ${res.status}`);
  }
  return { url: data.authorization_url, providerRef: data.transaction && data.transaction.reference };
}

// Vérification côté serveur (ne jamais faire confiance à la redirection seule)
async function verifyPayment(reference) {
  if (mode() !== 'live') return null;
  const res = await fetch(`${API}/payments/${encodeURIComponent(reference)}`, {
    headers: { Authorization: process.env.NOTCHPAY_PUBLIC_KEY, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.transaction || null; // .status: pending | complete | failed | canceled | expired
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.NOTCHPAY_WEBHOOK_HASH;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { mode, initPayment, verifyPayment, verifyWebhookSignature };
