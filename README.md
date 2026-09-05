# FleetCheck

Application de suivi de maintenance pour une flotte de véhicules prioritaires
(ambulances, SAMU, SMUR, pompiers, police, armée, etc.).

**100% hors-ligne, 100% locale.** Aucun backend, aucune base de données
distante, pas de Firebase, pas de Kodular. Toutes les données restent sur
l'appareil de l'utilisateur (stockées dans IndexedDB, le stockage local du
navigateur).

## Fonctionnalités

- Tableau de bord de la flotte avec score de maintenance par véhicule (🟢🟡🔴)
- Fiche véhicule : indicateurs (batterie, vidange, pneus, freins), historique
  des entretiens et des anomalies
- Enregistrement d'un entretien (type, date, kilométrage, coût en FCFA,
  **responsable**)
- Signalement d'une anomalie (élément, description, gravité, **responsable**,
  **photo à l'appui**)
- **Déclaration de mission** : document imprimable/exportable en PDF (via
  l'impression du navigateur) attestant l'état du véhicule, à présenter avant
  un départ en mission ou lors d'un contrôle
- **Garage / mécanicien référent** par véhicule, avec boutons Appeler et
  WhatsApp — mis en évidence si une anomalie critique est en cours
- Installable comme une application sur l'écran d'accueil Android (PWA),
  fonctionne ensuite sans connexion internet

## Comment l'héberger (gratuit, en quelques minutes)

L'application est un site statique (HTML/CSS/JS). Le mode hors-ligne complet
(service worker + installation sur l'écran d'accueil) nécessite un
hébergement en **HTTPS** — un simple double-clic sur `index.html` ne suffit
pas pour cette partie-là.

**Option la plus simple — Netlify Drop :**
1. Aller sur https://app.netlify.com/drop
2. Glisser-déposer le dossier `fleetcheck` (celui qui contient `index.html`)
3. Netlify donne immédiatement une adresse en `https://...netlify.app`
4. Ouvrir cette adresse sur le téléphone Android, dans Chrome
5. Menu ⋮ → **« Installer l'application »** (ou "Ajouter à l'écran d'accueil")

**Autres options tout aussi valables :** GitHub Pages, Vercel, Cloudflare
Pages — il suffit de déposer le contenu du dossier tel quel, sans build ni
installation (`npm install` n'est pas nécessaire, il n'y a aucune
dépendance).

**Pour tester rapidement en local (sur un ordinateur) :**
```
cd fleetcheck
python3 -m http.server 8080
```
puis ouvrir `http://localhost:8080` dans le navigateur.

## Structure du projet

```
fleetcheck/
├── index.html        page unique de l'application
├── style.css          identité visuelle
├── app.js              toute la logique (données, score, écrans)
├── manifest.json      configuration de l'installation PWA
├── sw.js                 service worker (cache hors-ligne)
└── icons/                 icônes de l'application
```

## Limites connues de cette V1

- Données stockées uniquement sur l'appareil utilisé : pas de synchronisation
  entre plusieurs téléphones. Convient à un usage par un seul responsable de
  flotte sur son appareil.
- Le score est un indicateur transparent basé sur les données saisies, pas un
  diagnostic mécanique.
