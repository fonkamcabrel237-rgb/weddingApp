# Historique des Évolutions (CHANGELOG)

Toutes les modifications notables apportées au projet **Ndolo Invitations** sont consignées dans ce document.

---

## [1.4.0] - 2026-11-09
### Ajouté
* **Moteur de personnalisation de Thème Visuel Sur-Mesure (`customThemeStyle`)** :
  * Sélection de 2 couleurs (`custom_accent` et `custom_bg`) ou de **6 palettes mariage tendances en 1 clic** (*Terracotta & Ivoire*, *Bordeaux & Or*, *Vert Sauge & Crème*, *Bleu Roi & Blanc*, *Or Rose & Champagne*, *Bleu Nuit & Or Impérial*).
  * Calcul automatique par luminance WCAG des 9 variables CSS (`--bg`, `--bg2`, `--card`, `--text`, `--muted`, `--accent`, `--accent2`, `--line`, `--btn-text`) garantissant une lisibilité parfaite.
  * Aperçu en direct dans l'éditeur Admin (`views/admin/wedding-form.ejs`) et sélecteur intégré au formulaire de commande (`views/landing.ejs`).

### Modifié
* **Typographie et impact visuel du Hero (`views/landing.ejs`, `public/css/app.css`)** : passage en *Playfair Display ExtraBold (800)* grand format avec surlignage doré contrasté sur la ligne centrale.
* **Correction responsive des boutons d'enregistrement Admin (`.form-floating-bar`)** et des marges latérales mobiles sur `/admin`.

---

## [1.3.0] - 2026-11-08
### Ajouté
* **Gestion complète des tables et places assises par intimité** (`wedding_tables` dans `src/db.js` et `src/weddings.js`) :
  * Création des tables personnalisées par les mariés (nom choisi par les mariés, capacité en chaises, cercle d'intimité).
  * Définition du **quota maximum d'invités** (`max_guests`) avec jauge en temps réel et protection contre le dépassement.
  * Algorithme d'**auto-placement intelligent** (`autoAssignTables`) répartissant les invités par cercle d'intimité sans séparer les couples/familles, avec numérotation automatique des sièges (`#1-2`, `#3`...).
  * Libération automatique des chaises lorsqu'un invité décline l'invitation (`status = 'no'`).
* **Mode RSVP contrôlé par la BD des mariés (`strict_rsvp`)** : bloque les inscriptions sauvages hors-liste sur `/i/:slug/rsvp` et réserve le Pass QR aux invités enregistrés par les mariés.
* **Billet Pass QR enrichi (`/i/:slug/pass/:token` et `/i/:slug/pass/:token/ticket.svg`)** : intègre directement le QR code, le **Nom de l'invité**, le **Nom de sa Table** et ses **Numéros de sièges** sur l'image téléchargeable et sur l'écran de scan Jour J des hôtesses (`views/couple/checkin.ejs` & `views/couple/accueil.ejs`).

---

## [1.2.0] - 2026-11-08
### Ajouté
* Feuille de style dédiée **Mobile-First** pour l'espace mariés (`public/css/couple.css`) conçue à partir d'un écran smartphone `360px` avec enrichissement progressif (`min-width: 640px` et `min-width: 960px`).
* Barre de navigation basse fixe (`.cp-tabbar`) façon application mobile sur l'espace mariés (Invités, Ajouter, Envoi WhatsApp, Cagnotte, Jour J).
* Filtres rapides horizontaux (`.cp-chips`) et barre d'envoi WhatsApp séquentiel collante (`.cp-sender`) avec jauge de progression.

### Modifié
* Refonte **Mobile-First** complète du dashboard des mariés (`views/couple/dashboard.ejs`) et de l'écran d'accueil Jour J / hôtesses (`views/couple/accueil.ejs`) : suppression totale des tableaux HTML (`<table>`) au profit de cartes tactiles (`.guest-card`, `.checkin-row`, `.cp-gift`).
* Harmonisation visuelle et responsive du back-office Admin (`views/admin/dashboard.ejs`, `views/admin/wedding-form.ejs`, `views/partials/admin-nav.ejs`) avec en-têtes dorés et cartes empilables sans débordement horizontal.
* Suppression du `min-width: 680px` global sur la balise `table` dans `public/css/app.css` et désactivation du cache statique CSS en développement (`?v=4.0`).

---

## [1.1.0] - 2026-11-07
### Ajouté
* Intégration de la suite d'icônes vectorielles **FontAwesome 6.5.2** (CDN).
* Micro-animations CSS fluides (élévation des cartes, pulsion du bouton WhatsApp, mockup de smartphone flottant).
* Suite de tests automatisés natifs (`node:test`) validant la normalisation des téléphones, l'unicité des slugs, la logique RSVP/cagnotte et la signature HMAC des webhooks (`npm test`).
* Documentation de cadrage méthodologique complet : PRD (`docs/PRD.md`), Architecture & Mermaid ERD (`docs/ARCHITECTURE.md`), Consignes d'agent (`AGENT.md`).

### Modifié
* Restructuration du titre principal du Hero sur la landing page pour tenir strictement en 3 lignes percutantes.
* Mise à jour du numéro de contact commercial WhatsApp par défaut (`657664546` / `237657664546`).
* Refonte ergonomique du tableau d'administration avec barre de défilement fluide et masquer la barre horizontale agressive.

---

## [1.0.0] - 2026-11-07
### Ajouté
* Initialisation de la plateforme Express + SQLite natif (`node:sqlite`).
* Système de faire-part interactif multi-thèmes avec compte à rebours, GPS, programme, RSVP et galerie.
* Module de cagnotte des mariés compatible Notch Pay (MoMo/Orange Money) avec simulateur de démonstration.
* Espace mariés avec générateur de messages d'invitation personnalisés et envoi en série WhatsApp.
* Module de pass d'entrée avec QR code infalsifiable et écran de check-in le jour J.
* Back-office d'administration pour gestion des leads et suivi des commissions partenaires.
