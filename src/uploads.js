// Upload des photos : redimensionnement automatique (léger pour la 3G/4G) si sharp est disponible.
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { UPLOAD_DIR } = require('./db');
const { token } = require('./utils');

let sharp = null;
try { sharp = require('sharp'); } catch { console.warn('sharp indisponible : les photos ne seront pas compressées.'); }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 40 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpe?g|png|webp|heic|heif)$/i.test(file.mimetype)),
});

async function saveImage(file) {
  if (sharp) {
    const name = `${Date.now()}-${token(6)}.webp`;
    await sharp(file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 }).toFile(path.join(UPLOAD_DIR, name));
    return name;
  }
  const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const name = `${Date.now()}-${token(6)}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return name;
}

function deleteImage(name) {
  if (!name || name.includes('/') || name.includes('\\')) return;
  fs.rm(path.join(UPLOAD_DIR, name), { force: true }, () => {});
}

module.exports = { upload, saveImage, deleteImage };
