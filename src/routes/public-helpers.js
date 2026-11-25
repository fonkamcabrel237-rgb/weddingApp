const { store, nowStr } = require('../db');
const { notify, fmtMoney, coupleNames } = require('../utils');

// Idempotent : ne notifie qu'au premier passage à "complete"
async function markContribution(contrib, status) {
  if (contrib.status === status || contrib.status === 'complete') return;
  const patch = { status };
  if (status === 'complete') patch.paid_at = nowStr();
  await store.updateContribution(contrib.id, patch);

  if (status === 'complete') {
    const w = await store.getWeddingById(contrib.wedding_id);
    if (w) {
      await notify(`💰 Cagnotte ${coupleNames(w)} : ${fmtMoney(contrib.amount)} de ${contrib.name || 'un invité'}${contrib.message ? `\n« ${contrib.message} »` : ''}`);
    }
  }
}

module.exports = { markContribution };
