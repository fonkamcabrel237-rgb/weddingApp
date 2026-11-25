// Script d'initialisation avec un exemple complet et réaliste (Douala, Cameroun)
require('dotenv').config();
const { store } = require('../src/db');
const { ensureDemoSeeded } = require('../src/weddings');

async function main() {
  console.log('🌱 Création / vérification des données de démonstration...');
  await ensureDemoSeeded();
  const w = await store.getWeddingBySlug('demo');
  if (w) {
    console.log('✅ Démo prête avec succès !');
    console.log('👉 Faire-part public : http://localhost:3000/i/demo');
    console.log('👉 Espace mariés     : http://localhost:3000/espace/demo?k=' + w.access_key);
    console.log('👉 Espace Admin      : http://localhost:3000/admin');
  }
}

main().catch((e) => {
  console.error('❌ Erreur seed :', e);
  process.exit(1);
});
