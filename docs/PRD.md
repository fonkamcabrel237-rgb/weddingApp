# Document d'Exigences Produit (PRD) — Ndolo Invitations

## 1. Vision & Cadrage du Problème

### 1.1 Le Constat Terrain (Cameroun)
* **Période critique** : Novembre à Février correspond au pic annuel des mariages et dots coutumières à Douala, Yaoundé, Bafoussam, Kribi et dans la diaspora.
* **Les frictions des cartons papier traditionnels** :
  * **Coût élevé** : 150 000 à 350 000 FCFA pour 200 à 400 cartons qui finissent souvent égarés ou jetés.
  * **Pertes d'orientation** : 40 à 50 appels téléphoniques le jour J pour demander l'itinéraire de la salle ou de la paroisse (« *on est au carrefour, on prend où ?* »).
  * **Gestion RSVP opaque** : Difficulté d'évaluer le nombre réel de convives, conduisant à des pénuries de repas ou à du gaspillage traiteur.
  * **Intrusions (« Pique-assiettes »)** : Absence de système simple de filtrage à l'accueil lors de la réception.
  * **Cagnotte complexe** : Les proches distants ou de la diaspora peinent à envoyer leurs dons sans frais élevés ou démarches fastidieuses.

### 1.2 La Solution Produit
Une application web responsive (mobile-first, optimisée pour réseaux 3G/4G camerounais) permettant aux couples de générer un faire-part interactif tout-en-un, d'automatiser l'envoi personnalisé sur WhatsApp, de collecter les dons MoMo/OM et de contrôler les entrées le jour J via QR code.

---

## 2. Utilisateurs Cibles (Personas)

1. **Les Futurs Mariés (Organisateurs)** :
   * Veulent une invitation moderne, prestigieuse et simple à piloter sans compétence technique.
   * Veulent savoir exactement qui vient pour ajuster les commandes du traiteur.
2. **Les Invités (Familles, Amis, Diaspora)** :
   * Consultent l'invitation sur smartphone via WhatsApp.
   * Veulent un itinéraire GPS en 1 clic et pouvoir répondre (RSVP) en moins de 30 secondes.
3. **Les Partenaires B2B (Wedding Planners, Photographes)** :
   * Recommandent la solution à leurs clients pour valoriser leur prestation et perçoivent une commission (10 000 FCFA/mariage).
4. **L'Administrateur de la Plateforme (Vous)** :
   * Supervise les commandes, valide les paiements de prestations et suit les cagnottes collectées.

---

## 3. Périmètre Fonctionnel du MVP (In Scope)

Le périmètre initial est strictement délimité aux 5 piliers essentiels :

1. **Faire-part Interactif Mobile-First (`/i/:slug`)** :
   * Enveloppe cachetée interactive avec animation d'ouverture.
   * Compte à rebours dynamique jusqu'à la célébration.
   * Programme chronologique des cérémonies (Dot, Mairie, Bénédiction, Réception).
   * Localisation GPS Google Maps & Waze directe.
   * Galerie photos des mariés & histoire du couple.
2. **Module RSVP & Livre d'or** :
   * Confirmation en 2 clics (Présent / Absent + nombre d'accompagnants autorisés).
   * Dépôt de vœux affichés dans le livre d'or.
3. **Cagnotte de Mariage MoMo / OM** :
   * Paiement en ligne sécurisé via agrégateur (Notch Pay) par MTN Mobile Money & Orange Money.
   * Affichage des numéros directs pour transfert manuel de secours.
4. **Pass d'Accès & Contrôle QR Code** :
   * Génération automatique d'un pass d'entrée individuel avec QR code pour chaque invité confirmé.
   * Page d'émargement / scan rapide pour les hôtesses à l'entrée de la salle (`/espace/:slug/accueil`).
5. **Espace de Pilotage des Mariés & Automatisation WhatsApp** :
   * Suivi des confirmations en temps réel et export Excel pour le traiteur.
   * Générateur de messages WhatsApp nominatifs avec bouton séquentiel d'envoi.

---

## 4. Hors Périmètre Explicite (Scope Out - V1)

Les fonctionnalités suivantes sont **volontairement exclues du MVP** pour préserver la vélocité, limiter les bugs et respecter les délais :

* ❌ **Pas d'application mobile native iOS/Android sur store** (inutile : tout passe par le navigateur web mobile et WhatsApp).
* ❌ **Pas de plan de table interactif 3D complexe** (remplacé par l'export Excel filtrable).
* ❌ **Pas d'envoi de SMS payants en masse automatisés** (remplacé par l'envoi WhatsApp natif sans coût additionnel par message).
* ❌ **Pas de système multi-vendeurs SaaS en self-service complet** (le couple remplit le formulaire, vous validez l'aperçu avant publication pour maintenir un contrôle qualité strict).
* ❌ **Pas de génération vidéo IA des mariés** dans la V1.

---

## 5. Critères d'Acceptation & Métriques de Succès

| Critère | Cible |
|---|---|
| **Vitesse de chargement sur réseau 3G/4G** | Page invitation interactive affichée en moins de 2,5 secondes. |
| **Taux de confirmation RSVP** | Temps moyen de réponse d'un invité < 45 secondes. |
| **Taux de délivrabilité WhatsApp** | 100% (utilisation des URLs natives `wa.me` sur les téléphones des mariés). |
| **Objectif Commercial Initial** | 20 à 30 mariages contractualisés avant le 31 décembre (panier moyen 50 000 FCFA). |
