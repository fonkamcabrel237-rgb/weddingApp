// Synchronisation automatique Cloud (Cloudinary) pour rendre SQLite et les photos 100% persistants sur Render Free.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function getCloudConfig() {
  const url = String(process.env.CLOUDINARY_URL || '').trim();
  if (url.startsWith('cloudinary://')) {
    try {
      const parsed = new URL(url);
      return {
        cloudName: parsed.hostname,
        apiKey: decodeURIComponent(parsed.username),
        apiSecret: decodeURIComponent(parsed.password),
      };
    } catch (e) {
      console.warn('[cloud-sync] CLOUDINARY_URL invalide :', e.message);
    }
  }
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();
  if (cloudName && apiKey && apiSecret) {
    return { cloudName, apiKey, apiSecret };
  }
  return null;
}

function isCloudEnabled() {
  return Boolean(getCloudConfig());
}

// Chiffrement AES-256-GCM pour protéger la sauvegarde de la base de données dans le cloud
function encryptBuffer(plainBuf, secret) {
  const key = crypto.scryptSync(secret, 'ndolo-cloud-vault-v1', 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('NDL1'), iv, tag, encrypted]);
}

function decryptBuffer(encBuf, secret) {
  if (!encBuf || encBuf.length < 32 || encBuf.subarray(0, 4).toString('utf8') !== 'NDL1') {
    throw new Error('Format de sauvegarde chiffrée invalide');
  }
  const key = crypto.scryptSync(secret, 'ndolo-cloud-vault-v1', 32);
  const iv = encBuf.subarray(4, 16);
  const tag = encBuf.subarray(16, 32);
  const data = encBuf.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function signCloudinaryParams(params, apiSecret) {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
}

async function uploadRawBuffer(buffer, publicId, filename = 'file.bin') {
  const cfg = getCloudConfig();
  if (!cfg) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    invalidate: 'true',
    overwrite: 'true',
    public_id: publicId,
    timestamp: String(timestamp),
  };
  const signature = signCloudinaryParams(params, cfg.apiSecret);

  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('api_key', cfg.apiKey);
  form.append('timestamp', params.timestamp);
  form.append('public_id', params.public_id);
  form.append('overwrite', params.overwrite);
  form.append('invalidate', params.invalidate);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/raw/upload`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Échec upload Cloudinary (${res.status}): ${errText}`);
  }
  return res.json();
}

async function deleteRawResource(publicId) {
  const cfg = getCloudConfig();
  if (!cfg) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    invalidate: 'true',
    public_id: publicId,
    timestamp: String(timestamp),
  };
  const signature = signCloudinaryParams(params, cfg.apiSecret);

  const body = new URLSearchParams({
    api_key: cfg.apiKey,
    timestamp: params.timestamp,
    public_id: params.public_id,
    invalidate: params.invalidate,
    signature,
  });

  await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/raw/destroy`, {
    method: 'POST',
    body,
  }).catch(() => {});
}

// Sauvegarde atomique et chiffrée de SQLite vers Cloudinary
let backupTimer = null;
let backupInProgress = false;
let backupPending = false;

async function performDbBackup(db, dataDir) {
  const cfg = getCloudConfig();
  if (!cfg || !db) return;
  if (backupInProgress) {
    backupPending = true;
    return;
  }
  backupInProgress = true;
  const tmpSnap = path.join(dataDir, `ndolo-snap-${Date.now()}.db`);

  try {
    const escapedPath = tmpSnap.replace(/\\/g, '/').replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedPath}'`);
    const rawBuf = fs.readFileSync(tmpSnap);
    const encrypted = encryptBuffer(rawBuf, cfg.apiSecret);
    await uploadRawBuffer(encrypted, 'ndolo_db/ndolo_vault.enc', 'ndolo_vault.enc');
  } catch (e) {
    console.warn('[cloud-sync] Avertissement sauvegarde DB :', e.message);
  } finally {
    try { fs.rmSync(tmpSnap, { force: true }); } catch {}
    backupInProgress = false;
    if (backupPending) {
      backupPending = false;
      scheduleDbBackup(db, dataDir);
    }
  }
}

function scheduleDbBackup(db, dataDir, delayMs = 2000) {
  if (!isCloudEnabled()) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupTimer = null;
    performDbBackup(db, dataDir);
  }, delayMs);
  if (backupTimer.unref) backupTimer.unref();
}

// Restauration de la base SQLite depuis Cloudinary au démarrage
async function restoreDatabaseFromCloud(dbPath) {
  const cfg = getCloudConfig();
  if (!cfg) return false;

  try {
    const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64');
    const apiUrl = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/resources/raw/upload?prefix=${encodeURIComponent('ndolo_db/ndolo_vault.enc')}&max_results=1`;
    const listRes = await fetch(apiUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!listRes.ok) return false;
    const data = await listRes.json();
    const resource = (data.resources || []).find((r) => r.public_id === 'ndolo_db/ndolo_vault.enc');
    if (!resource || !resource.secure_url) return false;

    const fileRes = await fetch(resource.secure_url);
    if (!fileRes.ok) return false;

    const encBuf = Buffer.from(await fileRes.arrayBuffer());
    const plainBuf = decryptBuffer(encBuf, cfg.apiSecret);

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, plainBuf);
    console.log('[cloud-sync] Base de données restaurée avec succès depuis Cloudinary (' + plainBuf.length + ' octets).');
    return true;
  } catch (e) {
    console.warn('[cloud-sync] Aucune sauvegarde distante restaurée :', e.message);
    return false;
  }
}

// Sauvegarde et restauration à la volée des fichiers médias (photos .webp & musiques .mp3)
async function uploadMediaToCloud(filename, buffer) {
  if (!isCloudEnabled() || !filename || !buffer) return;
  try {
    await uploadRawBuffer(buffer, `ndolo_uploads/${filename}`, filename);
  } catch (e) {
    console.warn(`[cloud-sync] Échec sauvegarde média ${filename} :`, e.message);
  }
}

async function deleteMediaFromCloud(filename) {
  if (!isCloudEnabled() || !filename) return;
  await deleteRawResource(`ndolo_uploads/${filename}`);
}

async function restoreMediaIfMissing(filename, uploadDir) {
  const cfg = getCloudConfig();
  if (!cfg || !filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return false;
  }
  const localPath = path.join(uploadDir, filename);
  if (fs.existsSync(localPath)) return true;

  try {
    const url = `https://res.cloudinary.com/${cfg.cloudName}/raw/upload/ndolo_uploads/${encodeURIComponent(filename)}`;
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(localPath, buf);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  isCloudEnabled,
  encryptBuffer,
  decryptBuffer,
  scheduleDbBackup,
  performDbBackup,
  restoreDatabaseFromCloud,
  uploadMediaToCloud,
  deleteMediaFromCloud,
  restoreMediaIfMissing,
};
