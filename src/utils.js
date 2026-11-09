const crypto = require('crypto');

const TZ = 'Africa/Douala';
const BASE_URL = () => (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const PLANS = {
  essentiel: {
    name: 'Essentiel', price: 35000,
    features: ['Page invitation personnalisée', 'Compte à rebours', 'Localisation GPS + itinéraire', 'RSVP en ligne + WhatsApp', 'Galerie 10 photos', 'QR code pour cartes imprimées'],
  },
  prestige: {
    name: 'Prestige', price: 50000,
    features: ['Tout Essentiel', 'Liste d\'invités avec liens personnalisés', 'Envoi WhatsApp en 1 clic', 'Cagnotte MoMo / OM intégrée', 'Livre d\'or', 'Galerie 30 photos', 'Musique de fond'],
  },
  royal: {
    name: 'Royal', price: 75000,
    features: ['Tout Prestige', 'Dot + mariage civil + religieux + réception', 'Relances automatisées J-7 / J-1', 'Contrôle des entrées (QR invités)', 'Galerie illimitée', 'Thème sur mesure', 'Accompagnement prioritaire'],
  },
};

const THEMES = {
  royal: 'Royal — noir & or',
  ndop: 'Ndop — bleu indigo & blanc (tradition Grassfields)',
  kaba: 'Wax — couleurs chaudes',
  ivoire: 'Ivoire — blanc & rose poudré',
  emeraude: 'Émeraude — vert & or',
  custom: 'Sur-mesure — Palette personnalisée des mariés',
};

const CUSTOM_PALETTES = [
  { id: 'terracotta', name: 'Terracotta & Ivoire', bg: '#fdf8f4', accent: '#c85a32' },
  { id: 'bordeaux', name: 'Bordeaux & Or', bg: '#fbf6f4', accent: '#7b1e26' },
  { id: 'sauge', name: 'Vert Sauge & Crème', bg: '#f5f8f5', accent: '#4a6b53' },
  { id: 'bleu_roi', name: 'Bleu Roi & Blanc', bg: '#f4f7ff', accent: '#1e3a8a' },
  { id: 'rose_gold', name: 'Or Rose & Champagne', bg: '#fff8f6', accent: '#b76e79' },
  { id: 'nuit_or', name: 'Bleu Nuit & Or Impérial', bg: '#0c1629', accent: '#d4af37' },
];

function sanitizeHex(val, fallback = '#b8913f') {
  const s = String(val || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback;
}

function hexToRgb(hex) {
  const h = sanitizeHex(hex, '#000000').slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mixHex(h1, h2, weight = 0.5) {
  const [r1, g1, b1] = hexToRgb(h1);
  const [r2, g2, b2] = hexToRgb(h2);
  return rgbToHex(r1 + (r2 - r1) * weight, g1 + (g2 - g1) * weight, b1 + (b2 - b1) * weight);
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Génère automatiquement toutes les variables CSS du faire-part à partir des 2 couleurs des mariés
function customThemeStyle(w) {
  if (!w || w.theme !== 'custom') return '';
  const bg = sanitizeHex(w.custom_bg, '#faf6f0');
  const accent = sanitizeHex(w.custom_accent, '#b8913f');
  const isDark = luminance(bg) < 0.35;
  const bg2 = isDark ? mixHex(bg, '#ffffff', 0.06) : mixHex(bg, accent, 0.08);
  const card = isDark ? mixHex(bg, '#ffffff', 0.1) : '#ffffff';
  const text = isDark ? '#f5f0e6' : '#221b16';
  const muted = isDark ? mixHex(text, bg, 0.35) : mixHex(text, bg, 0.42);
  const accent2 = mixHex(accent, '#ffffff', 0.28);
  const [ar, ag, ab] = hexToRgb(accent);
  const line = `rgba(${ar},${ag},${ab},0.32)`;
  const btnText = luminance(accent) > 0.42 ? '#18130d' : '#ffffff';
  return `--bg:${bg};--bg2:${bg2};--card:${card};--text:${text};--muted:${muted};--accent:${accent};--accent2:${accent2};--line:${line};--btn-text:${btnText};`;
}

const GUEST_CATEGORIES = {
  honneur: { label: "Table d'Honneur / Cortège", short: 'Honneur', icon: 'fa-crown' },
  vip_mariee: { label: 'VIP & Parents proches (Mariée)', short: 'VIP Mariée', icon: 'fa-star' },
  vip_marie: { label: 'VIP & Parents proches (Marié)', short: 'VIP Marié', icon: 'fa-star' },
  famille_mariee: { label: 'Famille élargie (Mariée)', short: 'Famille Mariée', icon: 'fa-people-roof' },
  famille_marie: { label: 'Famille élargie (Marié)', short: 'Famille Marié', icon: 'fa-people-roof' },
  amis: { label: 'Amis proches des mariés', short: 'Amis', icon: 'fa-champagne-glasses' },
  collegues: { label: 'Collègues & Relations pro', short: 'Collègues', icon: 'fa-briefcase' },
  association: { label: 'Réunion / Tontine / Église', short: 'Réunion / Église', icon: 'fa-users-rectangle' },
};

function slugify(str) {
  return String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function token(len = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Normalise un numéro camerounais en format international sans "+" (ex: 237690000000)
function normalizePhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && d.startsWith('6')) d = '237' + d;
  if (d.length === 8 && /^[2-9]/.test(d)) d = '2376' + d; // anciens numéros à 8 chiffres
  return d;
}

function prettyPhone(d) {
  d = normalizePhone(d);
  if (d.startsWith('237') && d.length === 12) {
    const n = d.slice(3);
    return `+237 ${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  }
  return d ? '+' + d : '';
}

function waLink(phone, text) {
  const p = normalizePhone(phone);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

// Dates saisies "YYYY-MM-DDTHH:mm" = heure de Douala (UTC+1, pas d'heure d'été)
function parseLocal(str) {
  if (!str) return null;
  const s = String(str).trim().replace(' ', 'T');
  const d = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? new Date(s) : new Date((s.length === 10 ? s + 'T00:00' : s.slice(0, 16)) + ':00+01:00');
  return isNaN(d) ? null : d;
}

function fmtDate(str, opts = {}) {
  const d = str instanceof Date ? str : parseLocal(str);
  if (!d) return '';
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ, ...opts }).format(d);
}
function fmtTime(str) {
  const d = str instanceof Date ? str : parseLocal(str);
  if (!d) return '';
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d).replace(':', 'h');
}
function fmtMoney(n) {
  return new Intl.NumberFormat('fr-FR').format(Number(n) || 0).replace(/\u202f|\u00a0/g, ' ') + ' FCFA';
}

function coupleNames(w) {
  return `${w.bride} & ${w.groom}`;
}
function eventLabel(w) {
  return { dot: 'notre dot', mariage_dot: 'notre dot et notre mariage', mariage: 'notre mariage' }[w.event_type] || 'notre mariage';
}

function inviteUrl(w, guest) {
  return `${BASE_URL()}/i/${w.slug}${guest ? '?g=' + guest.token : ''}`;
}

function inviteMessage(w, guest) {
  const hello = guest ? `Bonjour *${guest.name}*,` : 'Bonjour,';
  const when = w.event_date ? `, qui aura lieu le *${fmtDate(w.event_date)}*` : '';
  const where = w.city ? ` à *${w.city}*` : '';
  const details = [];
  if (guest) {
    const n = Number(guest.seats) || 1;
    details.push(`• Places réservées : *${n} ${n > 1 ? 'personnes' : 'personne'}*`);
    if (guest.table_name) {
      details.push(`• Table attribuée : *${guest.table_name}*${guest.seat_numbers ? ` (Siège${guest.seat_numbers.includes('-') ? 's' : ''} ${guest.seat_numbers})` : ''}`);
    }
  }
  const reservationBlock = details.length ? `\n\n${details.join('\n')}` : '';
  return `${hello}\n\nNous avons l'immense joie de vous convier à ${eventLabel(w)}${when}${where}.${reservationBlock}\n\n` +
    `Ouvrez votre faire-part personnel pour découvrir le programme, l'itinéraire GPS et confirmer votre présence afin d'obtenir votre Pass d'entrée :\n${inviteUrl(w, guest)}\n\n` +
    `Avec toute notre affection,\n*${coupleNames(w)}*`;
}

function reminderMessage(w, guest, kind) {
  const hello = guest ? `Bonjour *${guest.name}*,` : 'Bonjour,';
  const place = [w.venue_name, w.city].filter(Boolean).join(' — ');
  const tableLine = guest && guest.table_name
    ? `\n• Votre table : *${guest.table_name}*${guest.seat_numbers ? ` (Siège${guest.seat_numbers.includes('-') ? 's' : ''} ${guest.seat_numbers})` : ''}`
    : '';
  if (kind === 'j1') {
    return `${hello}\n\nLe grand jour, c'est demain ! Nous avons hâte de vous accueillir${place ? ` (${place})` : ''}.${tableLine}\n\n` +
      `Retrouvez l'itinéraire GPS et votre Pass QR à présenter à l'entrée :\n${inviteUrl(w, guest)}\n\nÀ demain,\n*${coupleNames(w)}*`;
  }
  if (kind === 'pending') {
    return `${hello}\n\nAfin de finaliser notre plan de table pour ${eventLabel(w)}, nous aimerions savoir si vous pourrez être des nôtres.${tableLine}\n\n` +
      `Merci de confirmer votre présence en quelques secondes via votre lien personnel :\n${inviteUrl(w, guest)}\n\nÀ très vite,\n*${coupleNames(w)}*`;
  }
  return `${hello}\n\nPlus qu'une semaine avant ${eventLabel(w)}${w.event_date ? ` (${fmtDate(w.event_date)})` : ''} ! Nous avons hâte de partager ce moment avec vous.${tableLine}\n\n` +
    `Programme, plan d'accès GPS et Pass d'entrée :\n${inviteUrl(w, guest)}\n\nAffectueusement,\n*${coupleNames(w)}*`;
}

function parseProgram(w) {
  try { return JSON.parse(w.program || '[]').filter((p) => p && p.title); } catch { return []; }
}

function mapsEmbed(query) {
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`;
}
function mapsDirections(query) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

// Notification instantanée sur ton téléphone via un bot Telegram (gratuit)
async function notify(text) {
  const { TELEGRAM_BOT_TOKEN: t, TELEGRAM_CHAT_ID: c } = process.env;
  if (!t || !c) { console.log('[notif]', text.replace(/\n/g, ' | ')); return; }
  try {
    await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: c, text, disable_web_page_preview: true }),
    });
  } catch (e) { console.error('Telegram notify error:', e.message); }
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = {
  TZ, BASE_URL, PLANS, THEMES, CUSTOM_PALETTES, GUEST_CATEGORIES, sanitizeHex, customThemeStyle,
  slugify, token, normalizePhone, prettyPhone, waLink, parseLocal,
  fmtDate, fmtTime, fmtMoney, coupleNames, eventLabel, inviteUrl, inviteMessage, reminderMessage,
  parseProgram, mapsEmbed, mapsDirections, notify, csvEscape,
};
