// Intégration Supabase (Base PostgreSQL + Supabase Storage pour photos & musiques).
const { createClient } = require('@supabase/supabase-js');

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
}

function getSupabaseKey() {
  return String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_KEY ||
    ''
  ).trim();
}

function isSupabaseEnabled() {
  return Boolean(getSupabaseUrl() && getSupabaseKey());
}

let cachedClient = null;
function getSupabase() {
  if (!isSupabaseEnabled()) return null;
  if (!cachedClient) {
    cachedClient = createClient(getSupabaseUrl(), getSupabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

let bucketReady = false;
async function ensureStorageBucket(client = getSupabase()) {
  if (!client || bucketReady) return;
  try {
    const { data, error } = await client.storage.getBucket(STORAGE_BUCKET);
    if (error || !data) {
      await client.storage.createBucket(STORAGE_BUCKET, { public: true });
    } else if (!data.public) {
      await client.storage.updateBucket(STORAGE_BUCKET, { public: true });
    }
    bucketReady = true;
  } catch (e) {
    console.warn('[supabase-storage] Vérification du bucket ignorée :', e.message);
  }
}

function getPublicMediaUrl(filename, baseUrl = '') {
  if (!filename) return '';
  const raw = String(filename).trim();
  if (/^https?:\/\//i.test(raw)) return raw;

  const supaUrl = getSupabaseUrl();
  if (raw.startsWith('/uploads/')) {
    const bare = raw.slice('/uploads/'.length);
    if (supaUrl && isSupabaseEnabled()) {
      return `${supaUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURIComponent(bare)}`;
    }
    return baseUrl ? `${baseUrl.replace(/\/$/, '')}${raw}` : raw;
  }
  if (raw.startsWith('/')) {
    return baseUrl ? `${baseUrl.replace(/\/$/, '')}${raw}` : raw;
  }

  if (supaUrl && isSupabaseEnabled()) {
    return `${supaUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURIComponent(raw)}`;
  }
  const prefix = baseUrl ? baseUrl.replace(/\/$/, '') : '';
  return `${prefix}/uploads/${encodeURIComponent(raw)}`;
}

async function uploadToSupabaseStorage(filename, buffer, contentType = 'application/octet-stream', client = getSupabase()) {
  if (!client) throw new Error('Supabase non configuré');
  await ensureStorageBucket(client);
  const { error } = await client.storage.from(STORAGE_BUCKET).upload(filename, buffer, {
    contentType,
    cacheControl: '31536000',
    upsert: true,
  });
  if (error) throw new Error(`Échec upload Supabase Storage : ${error.message}`);
  return getPublicMediaUrl(filename);
}

async function createSignedUpload(filename, client = getSupabase()) {
  if (!client) throw new Error('Supabase non configuré');
  await ensureStorageBucket(client);
  const { data, error } = await client.storage.from(STORAGE_BUCKET).createSignedUploadUrl(filename);
  if (error || !data) throw new Error(`Échec URL signée Supabase : ${error ? error.message : 'inconnu'}`);
  return {
    signedUrl: data.signedUrl,
    token: data.token,
    path: data.path,
    publicUrl: getPublicMediaUrl(filename),
  };
}

async function deleteFromSupabaseStorage(filenameOrUrl, client = getSupabase()) {
  if (!client || !filenameOrUrl) return;
  let name = String(filenameOrUrl).trim();
  const marker = `/object/public/${STORAGE_BUCKET}/`;
  const idx = name.indexOf(marker);
  if (idx !== -1) name = decodeURIComponent(name.slice(idx + marker.length));
  else if (name.startsWith('/uploads/')) name = decodeURIComponent(name.slice('/uploads/'.length));
  if (!name || name.includes('/') || name.includes('\\')) return;
  try {
    await client.storage.from(STORAGE_BUCKET).remove([name]);
  } catch (e) {
    console.warn('[supabase-storage] Suppression ignorée :', e.message);
  }
}

module.exports = {
  STORAGE_BUCKET,
  getSupabaseUrl,
  isSupabaseEnabled,
  getSupabase,
  ensureStorageBucket,
  getPublicMediaUrl,
  uploadToSupabaseStorage,
  createSignedUpload,
  deleteFromSupabaseStorage,
};
