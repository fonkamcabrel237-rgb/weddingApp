# Consignes de Développement & Standards Projet (AGENT.md)

Ce document régit les règles d'architecture, de sécurité, de code et d'interaction pour tout développement assisté par IA sur le projet **Ndolo Invitations**.

---

## 1. Stack Technique Imposée

* **Runtime** : Node.js `>= 22.13` (CommonJS).
* **Framework Web** : Express.js 4.x.
* **Moteur de Templates** : EJS avec inclusion de partials.
* **Base de Données** : `node:sqlite` natif (DatabaseSync) en mode WAL (`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`). Aucun ORM lourd.
* **Gestion des Formulaires & Médias** : `multer` (fichiers en mémoire, traitement/compression via `sharp` si disponible).
* **Styles & Icônes** : CSS vanilla natif sans build step lourd, FontAwesome 6.5.2 (CDN).
* **Fuseau Horaire Référence** : `Africa/Douala` (UTC+1 fixe, pas de changement d'heure).

---

## 2. Règles de Sécurité Inviolables

1. **Aucun Secret dans le Code** :
   * Les mots de passe, tokens et clés secrètes doivent être chargés exclusivement depuis les variables d'environnement (`process.env`).
   * Vérifier que `.env` reste listé dans `.gitignore`.
2. **Requêtes SQL Paramétrées Systématiques** :
   * Ne **jamais** concaténer de chaînes dans les requêtes SQLite.
   * Utiliser impérativement les placeholders `?` via le wrapper `q.get()`, `q.all()`, `q.run()`.
3. **Contrôle d'Accès Rigoureux** :
   * `/admin/*` : Protégé par cookie signé `adm` et vérification par comparaison temporelle constante (`crypto.timingSafeEqual`).
   * `/espace/:slug/*` : Isolé par le secret `access_key` propre à chaque mariage.
4. **Validation des Webhooks** :
   * Le webhook Notch Pay (`/webhooks/notchpay`) doit valider l'en-tête `x-notch-signature` par HMAC-SHA256 sur le payload brut avant tout traitement.

---

## 3. Conventions de Nommage & Structure

* **Fichiers JS** : `kebab-case.js` (ex: `public-helpers.js`).
* **Routes** : Découpées par domaine dans `src/routes/` (`public.js`, `couple.js`, `admin.js`, `webhook.js`).
* **Vues EJS** : `views/` structuré avec `views/partials/`, `views/admin/`, `views/couple/`.
* **Numéros de Téléphone** : Toujours normalisés au format camerounais international sans `+` (ex: `2376XXXXXXXX`) via la fonction `utils.normalizePhone()`.

---

## 4. Règle « Human-in-the-Loop »

Avant de créer de nouveaux modules ou d'ajouter une dépendance :
1. Présenter la logique et l'impact sur l'existant.
2. Éviter d'ajouter des packages tiers si les modules standards de Node.js (ex: `crypto`, `node:sqlite`) suffisent.
3. Toujours valider les cas d'erreur (champs invalides, paiement échoué, absence de réseau).
