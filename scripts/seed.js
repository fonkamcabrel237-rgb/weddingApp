// Script d'initialisation avec un exemple complet et réaliste (Douala, Cameroun)
require('dotenv').config();
const { q } = require('../src/db');
const { createWedding, addGuest, addTable, autoAssignTables, recomputeTableSeats } = require('../src/weddings');

console.log('🌱 Création / mise à jour des données de démonstration...');

function ensureDemoTables(weddingId) {
  const existingTables = q.all('SELECT * FROM wedding_tables WHERE wedding_id = ?', weddingId);
  if (!existingTables.length) {
    addTable(weddingId, { name: "Table d'Honneur — Ndolo", capacity: 8, category: 'honneur' });
    addTable(weddingId, { name: 'Table Mont Cameroun', capacity: 10, category: 'vip_mariee' });
    addTable(weddingId, { name: 'Table Wouri', capacity: 10, category: 'famille_marie' });
    addTable(weddingId, { name: 'Table Sanaga', capacity: 10, category: 'amis' });
  }
  autoAssignTables(weddingId);
  for (const t of q.all('SELECT id FROM wedding_tables WHERE wedding_id = ?', weddingId)) {
    recomputeTableSeats(t.id);
  }
}

const existing = q.get("SELECT * FROM weddings WHERE slug = 'demo'");
if (existing) {
  q.run("UPDATE weddings SET max_guests = COALESCE(max_guests, 150), strict_rsvp = COALESCE(strict_rsvp, 1) WHERE id = ?", existing.id);
  ensureDemoTables(existing.id);
  console.log('✅ Mariage de démo mis à jour avec tables et places (/i/demo)');
  process.exit(0);
}

const w = createWedding({
  slug: 'demo',
  status: 'published',
  plan: 'royal',
  price: 75000,
  paid: 1,
  partner: 'Prestige Events Douala',
  partner_commission: 10000,
  event_type: 'mariage_dot',
  bride: 'Grâce',
  groom: 'Junior',
  headline: 'Deux cœurs, une seule destinée 💍',
  story: `Tout a commencé un après-midi de décembre à Bonapriso.\nCe qui n'était qu'un simple café partagé s'est transformé en une complicité évidente, guidée par la foi et l'amour.\n\nAprès 4 belles années à grandir ensemble, nous avons choisi de sceller notre union devant Dieu, nos familles et ceux qui nous sont chers.`,
  hashtag: 'GraceJunior2026',
  event_date: '2026-12-19T14:00',
  venue_name: 'Hôtel Akwa Palace',
  venue_address: 'Boulevard de la Liberté, Akwa',
  city: 'Douala',
  maps_query: 'Hotel Akwa Palace Douala',
  program: [
    { title: 'Dot traditionnelle', date: '2026-12-18T10:00', place: 'Résidence familiale (Bonamoussadi)', address: 'Face Collège George Fox, Douala' },
    { title: 'Bénédiction nuptiale', date: '2026-12-19T14:00', place: 'Paroisse EPC Bonapriso', address: 'Rue Njo-Njo, Douala' },
    { title: 'Vin d\'honneur & Cocktail', date: '2026-12-19T17:00', place: 'Jardins Akwa Palace', address: 'Boulevard de la Liberté, Douala' },
    { title: 'Grande Réception & Soirée dansante', date: '2026-12-19T19:30', place: 'Salle des Fêtes Akwa Palace', address: 'Boulevard de la Liberté, Douala' }
  ],
  dress_code: 'Blanc & Or impérial / Tenue traditionnelle de prestige',
  theme: 'royal',
  rsvp_deadline: '2026-12-10',
  couple_phone: '237690123456',
  couple_email: 'graceetjunior@gmail.com',
  cagnotte_enabled: 1,
  cagnotte_goal: 1500000,
  cagnotte_text: 'Votre présence est le plus précieux des cadeaux. Si vous souhaitez participer à notre voyage de noces et à notre installation, une cagnotte est ouverte.',
  momo_number: '237670123456',
  momo_name: 'Junior Manga',
  om_number: '237690123456',
  om_name: 'Grâce Ngo',
  max_guests: 150,
  strict_rsvp: 1,
});

// Créer les tables personnalisées par les mariés
addTable(w.id, { name: "Table d'Honneur — Ndolo", capacity: 8, category: 'honneur' });
addTable(w.id, { name: 'Table Mont Cameroun', capacity: 10, category: 'vip_mariee' });
addTable(w.id, { name: 'Table Wouri', capacity: 10, category: 'famille_marie' });
addTable(w.id, { name: 'Table Sanaga', capacity: 10, category: 'amis' });

// Ajouter quelques invités types avec leur cercle d'intimité
const g1 = addGuest(w.id, { name: 'Tonton Paul & Famille', phone: '237677112233', seats: 4, category: 'vip_mariee', table_id: 'auto', source: 'list' });
const g2 = addGuest(w.id, { name: 'Maman Jacqueline', phone: '237699445566', seats: 2, category: 'vip_mariee', table_id: 'auto', source: 'list' });
const g3 = addGuest(w.id, { name: 'Boris Kamga (Témoin)', phone: '237655889900', seats: 1, category: 'honneur', table_id: 'auto', source: 'list' });
const g4 = addGuest(w.id, { name: 'Famille Eboa', phone: '237670001122', seats: 3, category: 'famille_marie', table_id: 'auto', source: 'list' });

// Confirmer certains RSVP avec des requêtes paramétrées sécurisées
q.run("UPDATE guests SET status = 'yes', attending_count = 4, message = ?, responded_at = datetime('now') WHERE id = ?", "Que Dieu bénisse abondamment votre foyer ! Très honorés.", g1.id);
q.run("UPDATE guests SET status = 'yes', attending_count = 2, message = ?, responded_at = datetime('now') WHERE id = ?", "Toutes nos félicitations aux futurs mariés ! Hâte d'y être.", g2.id);
q.run("UPDATE guests SET status = 'yes', attending_count = 1, message = ?, responded_at = datetime('now') WHERE id = ?", "Présent mon frère, on va célébrer ça comme il se doit ! 🔥", g3.id);

ensureDemoTables(w.id);

// Ajouter quelques contributions de cagnotte
q.run(`INSERT INTO contributions (wedding_id, name, phone, amount, message, reference, status, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, 'complete', datetime('now'))`,
  w.id, 'Tonton Paul', '237677112233', 100000, 'Un modeste geste pour vos débuts. Bénédictions !', 'demo-ref-001');

q.run(`INSERT INTO contributions (wedding_id, name, phone, amount, message, reference, status, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, 'complete', datetime('now'))`,
  w.id, 'Sandrine & Marc (Paris)', '33612345678', 50000, 'De tout cœur avec vous depuis la France ! Félicitations !', 'demo-ref-002');

console.log('✅ Démo initialisée avec succès !');
console.log('👉 Faire-part public : http://localhost:3000/i/demo');
console.log('👉 Espace mariés     : http://localhost:3000/espace/demo?k=' + w.access_key);
console.log('👉 Espace Admin      : http://localhost:3000/admin (mdp défini dans .env)');
