const { q } = require('../db');
const { notify, fmtMoney, coupleNames } = require('../utils');

// Idempotent : ne notifie qu'au premier passage à "complete"
async function markContribution(contrib, status) {
  if (contrib.status === status || contrib.status === 'complete') return;
  q.run(`UPDATE contributions SET status = ?, paid_at = CASE WHEN ? = 'complete' THEN datetime('now') ELSE paid_at END WHERE id = ?`,
    status, status, contrib.id);
  if (status === 'complete') {
    const w = q.get('SELECT * FROM weddings WHERE id = ?', contrib.wedding_id);
    await notify(`💰 Cagnotte ${coupleNames(w)} : ${fmtMoney(contrib.amount)} de ${contrib.name || 'un invité'}${contrib.message ? `\n« ${contrib.message} »` : ''}`);
  }
}

module.exports = { markContribution };
