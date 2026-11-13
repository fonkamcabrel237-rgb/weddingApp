const sharp = require('sharp');
const path = require('path');

const width = 1200;
const height = 630;

const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Dégradé de fond luxueux sombre -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0e0b08"/>
      <stop offset="50%" stop-color="#19140e"/>
      <stop offset="100%" stop-color="#0b0906"/>
    </linearGradient>

    <!-- Dégradé or royal -->
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#cfab55"/>
      <stop offset="35%" stop-color="#fdf0cd"/>
      <stop offset="70%" stop-color="#d4af37"/>
      <stop offset="100%" stop-color="#9a7428"/>
    </linearGradient>

    <!-- Dégradé or pour bordures -->
    <linearGradient id="goldBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e0be68" stop-opacity="0.85"/>
      <stop offset="50%" stop-color="#9d7429" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#fdf0cd" stop-opacity="0.85"/>
    </linearGradient>

    <!-- Glow effet -->
    <radialGradient id="goldGlow" cx="50%" cy="30%" r="50%">
      <stop offset="0%" stop-color="#d4af37" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#0e0b08" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <style>
    .brand-title { font-family: 'Georgia', 'Playfair Display', serif; font-size: 76px; font-weight: 700; fill: url(#goldGrad); letter-spacing: 2px; }
    .brand-sub { font-family: 'Georgia', serif; font-size: 30px; font-style: italic; fill: #d5c8b5; letter-spacing: 4px; }
    .pill-text { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 600; fill: #ffffff; }
    .footer-text { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 20px; font-weight: 500; fill: #a5957d; letter-spacing: 3px; }
    .tagline { font-family: 'Georgia', serif; font-size: 32px; fill: #f3ece0; font-weight: 500; }
  </style>

  <!-- Fond -->
  <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
  <rect width="${width}" height="${height}" fill="url(#goldGlow)"/>

  <!-- Cadre double doré luxueux -->
  <rect x="36" y="36" width="${width - 72}" height="${height - 72}" fill="none" stroke="url(#goldBorder)" stroke-width="2" rx="16"/>
  <rect x="48" y="48" width="${width - 96}" height="${height - 96}" fill="none" stroke="url(#goldBorder)" stroke-width="1" stroke-dasharray="8 6" rx="12" opacity="0.6"/>

  <!-- Coins d'ornements -->
  <g fill="url(#goldGrad)">
    <circle cx="48" cy="48" r="5"/>
    <circle cx="${width - 48}" cy="48" r="5"/>
    <circle cx="48" cy="${height - 48}" r="5"/>
    <circle cx="${width - 48}" cy="${height - 48}" r="5"/>
  </g>

  <!-- Alliances Dorées stylisées (Logo Rings) -->
  <g transform="translate(600, 145)" stroke="url(#goldGrad)" stroke-width="7" fill="none">
    <ellipse cx="-26" cy="0" rx="36" ry="24" transform="rotate(-18 -26 0)"/>
    <ellipse cx="26" cy="0" rx="36" ry="24" transform="rotate(18 26 0)"/>
    <!-- Diamant scintillant -->
    <polygon points="-42,-22 -34,-32 -26,-22 -34,-12" fill="url(#goldGrad)" stroke="none"/>
  </g>

  <!-- Titre de la marque -->
  <text x="600" y="245" text-anchor="middle" class="brand-title">Ndolo Invitations</text>
  <text x="600" y="295" text-anchor="middle" class="brand-sub">L'Art du Faire-Part Digital d'Exception</text>

  <!-- Séparateur ornemental -->
  <g transform="translate(600, 325)">
    <line x1="-180" y1="0" x2="-25" y2="0" stroke="url(#goldGrad)" stroke-width="1.5" opacity="0.7"/>
    <polygon points="0,-6 6,0 0,6 -6,0" fill="url(#goldGrad)"/>
    <line x1="25" y1="0" x2="180" y2="0" stroke="url(#goldGrad)" stroke-width="1.5" opacity="0.7"/>
  </g>

  <!-- Phrase d'accroche -->
  <text x="600" y="380" text-anchor="middle" class="tagline">Votre mariage, directement dans le WhatsApp de vos invités</text>

  <!-- 3 Piliers clés / Badges -->
  <g transform="translate(140, 430)">
    <!-- Badge 1 -->
    <g transform="translate(0, 0)">
      <rect width="280" height="60" rx="30" fill="#241d15" stroke="url(#goldBorder)" stroke-width="1.5"/>
      <text x="140" y="38" text-anchor="middle" class="pill-text">✨ RSVP en ligne</text>
    </g>
    <!-- Badge 2 -->
    <g transform="translate(320, 0)">
      <rect width="280" height="60" rx="30" fill="#241d15" stroke="url(#goldBorder)" stroke-width="1.5"/>
      <text x="140" y="38" text-anchor="middle" class="pill-text">🎟️ Pass VIP &amp; Table</text>
    </g>
    <!-- Badge 3 -->
    <g transform="translate(640, 0)">
      <rect width="280" height="60" rx="30" fill="#241d15" stroke="url(#goldBorder)" stroke-width="1.5"/>
      <text x="140" y="38" text-anchor="middle" class="pill-text">💰 Cagnotte MoMo / OM</text>
    </g>
  </g>

  <!-- Footer URL & Villes -->
  <text x="600" y="555" text-anchor="middle" class="footer-text">WWW.NDOLOS.SITE · CAMEROUN &amp; DIASPORA</text>
</svg>
`;

async function generate() {
  const outputPath = path.join(__dirname, '..', 'public', 'img', 'og-cover.jpg');
  await sharp(Buffer.from(svg))
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toFile(outputPath);
  console.log('OG image generated successfully at', outputPath);

  // Favicon 128x128
  const favSvg = `
  <svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="favBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#18130e"/>
        <stop offset="100%" stop-color="#0a0806"/>
      </linearGradient>
      <linearGradient id="favGold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#f5d376"/>
        <stop offset="50%" stop-color="#b8913f"/>
        <stop offset="100%" stop-color="#805d1d"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="28" fill="url(#favBg)"/>
    <rect x="2" y="2" width="124" height="124" rx="26" fill="none" stroke="url(#favGold)" stroke-width="2.5" opacity="0.6"/>
    <g transform="translate(64, 64)" stroke="url(#favGold)" stroke-width="6.5" fill="none">
      <ellipse cx="-16" cy="2" rx="24" ry="17" transform="rotate(-18 -16 2)"/>
      <ellipse cx="16" cy="2" rx="24" ry="17" transform="rotate(18 16 2)"/>
      <polygon points="-28,-14 -22,-22 -16,-14 -22,-6" fill="url(#favGold)" stroke="none"/>
    </g>
  </svg>
  `;
  const favPath = path.join(__dirname, '..', 'public', 'img', 'favicon.png');
  await sharp(Buffer.from(favSvg)).png().toFile(favPath);
  console.log('Favicon generated at', favPath);
}

generate().catch(console.error);
