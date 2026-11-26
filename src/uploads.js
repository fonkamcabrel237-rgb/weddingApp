// Upload des photos & musiques :
// - En production (Supabase) : stockage permanent dans le bucket public Supabase Storage ("uploads").
// - En développement local sans Supabase : stockage dans ./data/uploads.
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { UPLOAD_DIR } = require('./db');
const { token } = require('./utils');
const {
  isSupabaseEnabled,
  uploadToSupabaseStorage,
  createSignedUpload,
  deleteFromSupabaseStorage,
} = require('./supabase');

let sharp = null;
try { sharp = require('sharp'); } catch { /* optionnel sur Vercel Serverless (compression WebP aussi côté navigateur) */ }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 40 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpe?g|png|webp|heic|heif)$/i.test(file.mimetype)),
});

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const okMime = /^audio\//i.test(file.mimetype) || file.mimetype === 'application/octet-stream';
    const okExt = /\.(mp3|m4a|aac|wav|ogg|flac|webm)$/i.test(file.originalname || '');
    cb(null, okMime || okExt);
  },
});

async function persistBuffer(name, buffer, contentType) {
  if (isSupabaseEnabled()) {
    const publicUrl = await uploadToSupabaseStorage(name, buffer, contentType);
    return { name, publicUrl };
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return { name, publicUrl: `/uploads/${name}` };
}

async function saveImage(file) {
  if (sharp) {
    try {
      const name = `${Date.now()}-${token(6)}.jpg`;
      const outBuf = await sharp(file.buffer)
        .rotate()
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toBuffer();
      await persistBuffer(name, outBuf, 'image/jpeg');
      return name;
    } catch (e) {
      console.warn('[uploads] Fallback sans sharp :', e.message);
    }
  }
  const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
  const name = `${Date.now()}-${token(6)}${ext}`;
  await persistBuffer(name, file.buffer, file.mimetype || 'image/jpeg');
  return name;
}

async function saveAudio(file) {
  const ext = (path.extname(file.originalname) || '.mp3').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.mp3';
  const name = `music-${Date.now()}-${token(6)}${ext}`;
  const { publicUrl } = await persistBuffer(name, file.buffer, file.mimetype || 'audio/mpeg');
  return publicUrl;
}

async function createAudioUploadSession(originalName) {
  const ext = (path.extname(originalName || '') || '.mp3').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.mp3';
  const name = `music-${Date.now()}-${token(6)}${ext}`;
  if (!isSupabaseEnabled()) return null;
  return createSignedUpload(name);
}

// Convertit les liens de pages musicales (Epidemic Sound, Google Drive, Dropbox) en flux audio .mp3 direct
async function resolveMusicUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return null;
  if (url.startsWith('/uploads/') || url.includes('/storage/v1/object/public/')) return url;

  // 1. Lien de page Epidemic Sound -> extraction et sauvegarde permanente du .mp3
  if (/epidemicsound\.com\/.*\/tracks\//i.test(url)) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await resp.text();
      const match = html.match(/https:\/\/audiocdn\.epidemicsound\.com\/[^\s"'\\]+\.mp3/i);
      if (match && match[0]) {
        const mp3Res = await fetch(match[0]);
        if (mp3Res.ok) {
          const buf = Buffer.from(await mp3Res.arrayBuffer());
          const name = `music-${Date.now()}-${token(6)}.mp3`;
          const { publicUrl } = await persistBuffer(name, buf, 'audio/mpeg');
          return publicUrl;
        }
        return match[0];
      }
    } catch (e) {
      console.warn('Impossible de résoudre le lien Epidemic Sound :', e.message);
    }
  }

  // 2. Lien Google Drive partagé -> lien de flux direct
  const gdrive = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (gdrive && gdrive[1]) {
    return `https://drive.google.com/uc?export=download&id=${gdrive[1]}`;
  }

  // 3. Lien Dropbox partagé -> flux direct
  if (/dropbox\.com\//i.test(url)) {
    return url.replace(/[?&]dl=0\b/, '?raw=1').replace('www.dropbox.com', 'dl.dropboxusercontent.com');
  }

  return url;
}

async function deleteImage(name) {
  if (!name) return;
  if (isSupabaseEnabled()) {
    await deleteFromSupabaseStorage(name);
    return;
  }
  if (name.includes('/') || name.includes('\\')) return;
  fs.rm(path.join(UPLOAD_DIR, name), { force: true }, () => {});
}

module.exports = {
  upload,
  uploadAudio,
  saveImage,
  saveAudio,
  createAudioUploadSession,
  resolveMusicUrl,
  deleteImage,
};
