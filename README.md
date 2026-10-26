# FleetCheck

Application de suivi de maintenance pour une flotte de véhicules prioritaires
(ambulances, SAMU, SMUR, pompiers, police, armée, etc.).

**100% hors-ligne, 100% locale.** Aucun backend, aucune base de données
distante, pas de Firebase, pas de Kodular. Toutes les données restent sur
l'appareil de l'utilisateur (stockées dans IndexedDB, le stockage local du
navigateur).

## Sauvegarde (indépendante du navigateur)

IndexedDB est un stockage **du navigateur** : « Effacer les données de
navigation » dans Chrome (ou désinstaller l'application) supprime tout, sans
retour possible. Pour s'en protéger :

- ⚙️ → **Sauvegarde des données** → *Enregistrer une sauvegarde* : crée un
  fichier `FleetCheck-sauvegarde-AAAA-MM-JJ.json` (véhicules, entretiens,
  anomalies avec photos, garages, profil). À conserver hors du navigateur
  (Téléchargements, Google Drive, WhatsApp à soi-même).
- ⚙️ → **Sauvegarde des données** → *Restaurer depuis un fichier* : recharge
  une sauvegarde sur n'importe quel appareil ou navigateur. La restauration
  **remplace** les données actuelles ; elle est atomique (en cas d'erreur,
  rien n'est modifié).
- Un bandeau de rappel s'affiche sur le tableau de bord si aucune sauvegarde
  n'a été faite depuis plus de 7 jours.
- L'application demande aussi au navigateur de protéger le stockage contre les
  purges automatiques (sans effet sur un effacement manuel).

Le code est dans `backup.js` : il sauvegarde tous les magasins de la base
« fleetcheck » de façon générique.

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
├── backup.js           sauvegarde / restauration (fichier .json)
├── scoring.js          catégories de véhicules, seuils d'entretien, calcul du score
├── documents.js        documents administratifs et échéances
├── inspection.js       inspection avant départ (check-lists par catégorie)
├── costs.js            carburant, consommation, coûts, dérives
├── direction.js        tableau de bord direction et rapport imprimable
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


## Catégories de véhicules et score

Chaque véhicule a deux attributs distincts :

- **Catégorie** (gabarit) : léger, utilitaire, minibus, bus / autocar, poids
  lourd, deux-roues. Elle détermine les **seuils d'entretien** appliqués.
- **Usage / service** : ambulance, SAMU, police, bus universitaire, véhicule
  de service… Les usages prioritaires (ambulance, SAMU, SMUR, pompiers,
  police, armée) déclenchent l'alerte « proche » plus tôt (25 % de l'intervalle
  restant au lieu de 15 %).

Pour chaque élément (batterie, vidange, pneus, freins), l'échéance est atteinte
**au premier des deux critères : kilométrage ou délai en mois**. Seules les
anomalies **non résolues** pénalisent le score ; une anomalie résolue reste
dans l'historique (auteur, date, note de réparation).

⚠️ **Les seuils par catégorie (`DEFAULT_INTERVALS` dans `scoring.js`) sont des
valeurs de départ indicatives**, ni réglementaires ni constructeur. À valider
avec un mécanicien ou le carnet du constructeur, puis à ajuster véhicule par
véhicule (fiche → ⚙️ Seuils). Les engins à heures de fonctionnement (chantier,
agricole) ne sont pas couverts.

Les véhicules créés avant l'introduction des catégories n'ont pas de catégorie :
ils sont évalués comme « Léger » et signalés « Catégorie à définir » jusqu'à ce
qu'on les modifie (✏️ Modifier).


## Documents et échéances

Chaque véhicule peut suivre des documents (assurance, visite technique, carte
grise, permis du chauffeur, autorisation de transport, ou tout autre document
nommé librement) avec leur date d'expiration. **FleetCheck ne fixe aucune
obligation légale** : c'est vous qui choisissez quoi suivre.

- Statuts : *valide*, *à renouveler* (≤ 30 jours), *urgent* (≤ 7 jours),
  *expiré*. Un document reste valable le jour de sa date d'expiration.
- Le tableau de bord affiche un bandeau et une étiquette par véhicule ;
  l'écran **Échéances** (`#/echeances`) liste tout ce qui expire ou a expiré.
- La déclaration de mission reprend les documents et avertit en cas
  d'expiration.

## Inspection avant départ

Liste de contrôle en un tap (OK / Défaut / N/A), adaptée à la catégorie et à
l'usage (ex. issues de secours pour un bus, attelage pour un poids lourd,
gyrophare pour un véhicule prioritaire).

- Chaque **défaut** crée automatiquement une anomalie (« critique » pour un
  point critique, « à surveiller » sinon), sans doublon tant qu'une anomalie
  ouverte existe pour le même point. Le score et la déclaration de mission en
  tiennent compte.
- Un défaut sur un point **critique** donne le résultat « Défaut bloquant :
  départ déconseillé ». Les points critiques sont un choix de départ du
  prototype, **pas une norme** : adaptez la liste à vos procédures et à la
  réglementation (`checklistFor` dans `inspection.js`).
- Le kilométrage saisi met à jour le véhicule (jamais à la baisse). La
  déclaration de mission signale une inspection de plus de 24 h ou absente.

Base de données : passage de la version 1 à 2 (ajout des magasins `documents`
et `inspections`), automatique et sans perte pour les données existantes.


## Photo de document

Chaque document administratif peut porter une photo (prise à l'appareil ou
choisie dans la galerie), compressée en JPEG et stockée **à part** dans le
magasin `docphotos` : les listes et le tableau de bord restent légers. Un tap
sur la photo l'agrandit ; supprimer le document ou le véhicule supprime aussi
la photo.

## Carburant et coûts

- **Pleins** (fiche véhicule → ⛽ Ajouter un plein) : date, litres, montant
  FCFA, kilométrage, plein complet ou partiel, station. Le kilométrage du
  véhicule suit (jamais à la baisse).
- **Consommation** en L/100 km par la méthode « plein à plein » : seuls les
  pleins *complets* ferment un intervalle, les pleins partiels intermédiaires
  s'additionnent. Les valeurs hors 1–80 L/100 km sont isolées comme suspectes
  et exclues des moyennes.
- **Dérive** : la dernière consommation dépasse de plus de 25 % la moyenne des
  intervalles précédents (au moins 3). C'est un **signal à vérifier** (fuite,
  pneus, conduite, erreur de saisie), pas une preuve.
- **Coûts** = entretiens (coût déjà saisi) + carburant, sur la période choisie
  (ce mois, 90 jours, 12 mois). Le coût au km est estimé à partir des relevés
  kilométriques de la période ; sans au moins deux relevés : « n/d ».

## Tableau de bord direction et rapport

Accessible par 📊 sur l'écran d'accueil (`#/direction`).

Statut d'un véhicule, **calculé** et jamais saisi :

- 🔴 **À traiter** : score < 60, ou anomalie critique ouverte, ou entretien
  dépassé, ou document expiré.
- 🟠 **À surveiller** : score 60–79, ou anomalie à surveiller ouverte, ou
  entretien proche, ou document à renouveler (≤ 30 jours).
- 🟢 **Opérationnel** : aucun des points ci-dessus.

Le « taux d'opérationnels » est un **indicateur de conformité** calculé à
partir des données saisies, pas une mesure de disponibilité réelle (qui
demanderait de suivre les jours d'immobilisation).

L'écran présente : indicateurs, véhicules à traiter en priorité (avec motifs),
répartition par catégorie, anomalies / documents / inspections, coûts par
période, consommations à vérifier. Le **rapport imprimable**
(`#/rapport/mois|90j|12m`) reprend ces éléments avec signature du responsable ;
« Imprimer / Enregistrer en PDF » utilise l'impression du navigateur.

Base de données : version 3 (magasins `fuel` et `docphotos` ajoutés),
migration automatique depuis les versions 1 et 2.
