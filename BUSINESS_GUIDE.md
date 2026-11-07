# Guide Opérationnel & Plan d'Automatisation Business

## 💍 Ndolo Invitations — Faire-part digitaux interactifs & Cagnottes MoMo/OM (Cameroun)

---

### 1. Présentation de la Plateforme Conçue

L'application est **100% fonctionnelle, autonome et optimisée pour l'écosystème camerounais** (Node.js natif + base SQLite WAL sans maintenance + mobile first + intégration WhatsApp & MoMo/OM).

#### Fonctionnalités clés développées :
1. **Site Vitrine & Tunnel de Commande Client (`/`)** :
   - Présentation de la valeur (comparatif face aux cartons papier, 48h chrono).
   - Formulaire de commande en ligne : noms des mariés, date, lieu, photos, choix du thème visuel.
   - Création automatique du brouillon dès la commande.
2. **Page d'Invitation Interactive Haute Définition (`/i/:slug`)** :
   - Enveloppe virtuelle immersive animée avec sceau de cire.
   - Compte à rebours temps réel jusqu'au jour J.
   - Timeline dynamique : Dot traditionnelle, Mairie, Église, Réception.
   - Intégration Google Maps & Waze en 1 clic (supprime les 50 appels d'invités égarés).
   - Confirmation RSVP instantanée avec message pour le livre d'or.
   - Cagnotte de mariage intégrée (MTN Mobile Money + Orange Money via Notch Pay ou transfert direct).
   - Pass d'accès avec QR code individuel infalsifiable pour chaque invité confirmé.
3. **Espace Dédié pour les Mariés (`/espace/:slug`)** :
   - Tableau de bord en direct : décompte des présences, adultes, absents, cagnotte collectée.
   - Ajout d'invités (individuel ou import copier-coller depuis Excel).
   - Générateur de liens d'invitation personnalisés WhatsApp (« *Cher Tonton Paul...* »).
   - Bouton d'envoi en série WhatsApp (« Suivant ») pour distribuer 200 invitations en quelques minutes.
   - Export CSV / Excel pour le traiteur et le gestionnaire de salle.
   - Page d'émargement / scan QR code pour l'accueil le jour J (`/espace/:slug/accueil`).
4. **Espace Administrateur Back-Office (`/admin`)** :
   - Suivi du pipe commercial (leads, statut des paiements à 35k / 50k / 75k FCFA).
   - Éditeur visuel complet du faire-part : upload de photos, personnalisation du thème, programme, cagnotte.
   - Suivi des commissions pour les apporteurs d'affaires (wedding planners, photographes).

---

### 2. Le Modèle Économique & Objectif « 20 à 30 mariages d'ici fin décembre »

#### Tarification client :
* **Formule Essentiel (35 000 FCFA)** : Invitation web responsive, compte à rebours, localisation GPS, RSVP web + WhatsApp, QR code carton.
* **Formule Prestige (50 000 FCFA — Recommandée)** : Tout Essentiel + Envoi WhatsApp personnalisé 1-clic + Cagnotte MoMo/OM intégrée + Livre d'or + Musique de fond.
* **Formule Royale (75 000 FCFA)** : Tout Prestige + Multi-étapes (Dot + Mariage) + Rappels J-7/J-1 + Scanner d'entrée QR code le jour J + Thème sur mesure.

#### Projection financière (Novembre - Décembre) :
* 25 mariages au panier moyen de **50 000 FCFA** = **1 250 000 FCFA** de CA direct.
* Frais de cagnotte (5% optionnels sur les dons reçus via MoMo/OM) : ~**150 000 à 250 000 FCFA** additionnels.
* Rétrocession partenaires (10 000 FCFA par recommandation) : 25 × 10 000 = **250 000 FCFA**.
* **Marge nette estimée : ~1 150 000 FCFA** avec des coûts d'infrastructure proches de zéro (< 5 000 FCFA pour le domaine/serveur).

---

### 3. Stratégie d'Automatisation & Prospection Express

Pour atteindre rapidement le quota de mariages sans passer vos journées en démarchage individuel :

#### A. Le Partenariat B2B Clé en Main (La machine à leads)
Les futurs mariés ne cherchent pas un faire-part digital ; ils cherchent leur **wedding planner**, leur **photographe** ou leur **décorateur**.

1. **Constituez une liste de 15 wedding planners / photographes** réputés à Douala (Bonapriso, Akwa, Bonamoussadi) et Yaoundé (Bastos, Omnisports).
2. **Envoyez-leur le lien de démonstration déjà configuré** (`http://ton-domaine.cm/i/demo`) directement sur WhatsApp :
   > *« Bonjour [Nom], nous lançons une solution pour éliminer les retards et les pique-assiettes aux réceptions de vos mariés : faire-part digital avec GPS direct, RSVP en temps réel et cagnotte MoMo/OM. Pour chaque couple que vous nous recommandez ou que vous intégrez dans votre package, vous touchez 10 000 FCFA cash. Voici la démo en direct : [Lien Démo] »*
3. Vous leur fournissez leur lien de recommandation tracké : `/?ref=NomDuPartenaire`.

#### B. Automatisation Opérationnelle
* **Dès qu'un client remplit le formulaire** sur la page d'accueil :
  - Le faire-part brouillon est instantanément généré en base.
  - Vous recevez une alerte Telegram ou WhatsApp sur votre téléphone.
  - Le couple reçoit immédiatement son lien de prévisualisation et peut valider en direct.
* **Encaissement de la prestation** :
  - Directement par Mobile Money ou Orange Money avant passage du statut en `Publié`.

---

### 4. Démarrage Rapide

1. **Lancer le serveur en local** :
   ```bash
   npm run dev
   ```
2. **Accès pré-configurés** :
   - **Démo client** : `http://localhost:3000/i/demo`
   - **Espace mariés (Grâce & Junior)** : `http://localhost:3000/espace/demo?k=y8x9wqfmzbeq`
   - **Espace Administrateur** : `http://localhost:3000/admin` (Mot de passe défini dans `.env` : `change-moi`)
3. **Mise en production** :
   - Déployable en 5 minutes sur Render, Railway, VPS Ubuntu ou Fly.io (Node.js v22).
   - Renseigner `NOTCHPAY_PUBLIC_KEY` et `NOTCHPAY_WEBHOOK_HASH` dans `.env` pour activer les paiements MoMo/OM réels.
