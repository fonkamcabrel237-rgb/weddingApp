-- =====================================================================
-- NDOLO INVITATIONS — Schéma PostgreSQL complet pour Supabase
-- À coller une seule fois dans : Supabase Dashboard > SQL Editor > Run
-- =====================================================================

-- 1. Table des demandes de devis / commandes entrantes
CREATE TABLE IF NOT EXISTS public.leads (
  id SERIAL PRIMARY KEY,
  bride TEXT,
  groom TEXT,
  phone TEXT,
  email TEXT,
  city TEXT,
  event_date TEXT,
  event_type TEXT,
  plan TEXT,
  partner TEXT,
  notes TEXT,
  wedding_id INTEGER,
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- 2. Table des mariages / faire-part
CREATE TABLE IF NOT EXISTS public.weddings (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'draft',          -- draft | published | archived
  plan TEXT DEFAULT 'prestige',         -- essentiel | prestige | royal
  price INTEGER DEFAULT 50000,
  paid INTEGER DEFAULT 0,
  partner TEXT,
  partner_commission INTEGER DEFAULT 0,
  event_type TEXT DEFAULT 'mariage',    -- mariage | dot | mariage_dot
  bride TEXT NOT NULL,
  groom TEXT NOT NULL,
  headline TEXT,
  story TEXT,
  hashtag TEXT,
  event_date TEXT,
  venue_name TEXT,
  venue_address TEXT,
  city TEXT,
  maps_query TEXT,
  program TEXT DEFAULT '[]',
  dress_code TEXT,
  theme TEXT DEFAULT 'royal',
  custom_bg TEXT DEFAULT '#faf6f0',
  custom_accent TEXT DEFAULT '#b8913f',
  music_url TEXT,
  cover_photo TEXT,
  rsvp_deadline TEXT,
  couple_phone TEXT,
  couple_email TEXT,
  cagnotte_enabled INTEGER DEFAULT 1,
  cagnotte_goal INTEGER DEFAULT 0,
  cagnotte_text TEXT,
  momo_number TEXT,
  momo_name TEXT,
  om_number TEXT,
  om_name TEXT,
  payout_done INTEGER DEFAULT 0,
  max_guests INTEGER DEFAULT 200,
  strict_rsvp INTEGER DEFAULT 1,
  access_key TEXT NOT NULL,
  lead_id INTEGER,
  views INTEGER DEFAULT 0,
  created_at TEXT DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- 3. Table du plan de salle (tables par intimité)
CREATE TABLE IF NOT EXISTS public.wedding_tables (
  id SERIAL PRIMARY KEY,
  wedding_id INTEGER NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER DEFAULT 10,
  category TEXT DEFAULT 'famille_mariee',
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_tables_wedding ON public.wedding_tables(wedding_id);

-- 4. Table de la galerie photos
CREATE TABLE IF NOT EXISTS public.photos (
  id SERIAL PRIMARY KEY,
  wedding_id INTEGER NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_photos_wedding ON public.photos(wedding_id);

-- 5. Table des invités & RSVP
CREATE TABLE IF NOT EXISTS public.guests (
  id SERIAL PRIMARY KEY,
  wedding_id INTEGER NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  seats INTEGER DEFAULT 1,
  category TEXT DEFAULT 'famille_mariee',
  table_id INTEGER REFERENCES public.wedding_tables(id) ON DELETE SET NULL,
  table_name TEXT,
  seat_numbers TEXT,
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending',         -- pending | yes | no
  attending_count INTEGER DEFAULT 0,
  message TEXT,
  source TEXT DEFAULT 'list',            -- list | public
  invited_at TEXT,
  responded_at TEXT,
  checked_in_at TEXT,
  created_at TEXT DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_guests_wedding ON public.guests(wedding_id);

-- 6. Table de la cagnotte MoMo / Orange Money
CREATE TABLE IF NOT EXISTS public.contributions (
  id SERIAL PRIMARY KEY,
  wedding_id INTEGER NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  amount INTEGER NOT NULL,
  message TEXT,
  reference TEXT UNIQUE NOT NULL,
  provider_ref TEXT,
  status TEXT DEFAULT 'pending',         -- pending | complete | failed
  provider TEXT DEFAULT 'notchpay',
  created_at TEXT DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contrib_wedding ON public.contributions(wedding_id);

-- 7. Sécurité Row Level Security (RLS activé : seul le serveur avec SUPABASE_SERVICE_ROLE_KEY accède aux tables)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;

-- 8. Bucket Supabase Storage public pour les photos et musiques MP3
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public read uploads'
  ) THEN
    CREATE POLICY "Public read uploads" ON storage.objects
      FOR SELECT USING (bucket_id = 'uploads');
  END IF;
END $$;
