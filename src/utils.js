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
};

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
  const hello = guest ? `Bonjour ${guest.name} 🌸` : 'Bonjour 🌸';
  const when = w.event_date ? ` le ${fmtDate(w.event_date)}` : '';
  const where = w.city ? ` à ${w.city}` : '';
  const seatInfo = guest
    ? `\n🪑 Réservation : ${guest.seats} place(s)${guest.table_name ? ` — ${guest.table_name}` : ''}.`
    : '';
  return `${hello}\n\n${coupleNames(w)} ont la joie de vous inviter à ${eventLabel(w)}${when}${where}. 💍${seatInfo}\n\n` +
    `Découvrez votre faire-part, l'itinéraire et confirmez votre présence pour obtenir votre Pass QR ici 👉 ${inviteUrl(w, guest)}`;
}

function reminderMessage(w, guest, kind) {
  const name = guest ? guest.name : '';
  if (kind === 'j1') {
    return `Bonjour ${name} ✨\nC'est demain ! ${coupleNames(w)} ont hâte de vous voir.\n📍 ${w.venue_name || ''} ${w.city ? '— ' + w.city : ''}\n🗺️ Itinéraire et programme : ${inviteUrl(w, guest)}`;
  }
  if (kind === 'pending') {
    return `Bonjour ${name} 🙏\n${coupleNames(w)} n'ont pas encore reçu votre réponse pour ${eventLabel(w)}.\nMerci de confirmer en 10 secondes ici 👉 ${inviteUrl(w, guest)}`;
  }
  return `Bonjour ${name} 💐\nPlus qu'une semaine avant le grand jour de ${coupleNames(w)} (${fmtDate(w.event_date)}).\nProgramme, plan d'accès et cagnotte : ${inviteUrl(w, guest)}`;
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
  TZ, BASE_URL, PLANS, THEMES, GUEST_CATEGORIES, slugify, token, normalizePhone, prettyPhone, waLink, parseLocal,
  fmtDate, fmtTime, fmtMoney, coupleNames, eventLabel, inviteUrl, inviteMessage, reminderMessage,
  parseProgram, mapsEmbed, mapsDirections, notify, csvEscape,
};
