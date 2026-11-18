// Script de restauration automatique de la base SQLite depuis Cloudinary au démarrage du conteneur Render.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { isCloudEnabled, restoreDatabaseFromCloud } = require('../src/cloud-sync');

async function main() {
  if (!isCloudEnabled()) return;
  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  const dbPath = path.join(dataDir, 'ndolo.db');

  // Si la base locale n'existe pas (ex: redémarrage du serveur Render Free), on la restaure depuis Cloudinary
  if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) {
    await restoreDatabaseFromCloud(dbPath);
  }
}

main().catch((e) => console.warn('[restore-db]', e.message));
