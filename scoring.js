"use strict";

/* =========================================================================
   FleetCheck — Catégories de véhicules et calcul du score de maintenance

   Deux axes distincts :
   - CATÉGORIE (gabarit)  : léger, utilitaire, minibus, bus, poids lourd, deux-roues
                            → détermine les seuils d'entretien appliqués.
   - USAGE (service)      : ambulance, police, bus universitaire, véhicule de service…
                            → champ `type` historique ; les usages « prioritaires »
                              déclenchent l'alerte plus tôt.

   ⚠️ Les seuils ci-dessous sont des valeurs de DÉPART INDICATIVES choisies pour
   ce prototype. Ce ne sont ni des valeurs réglementaires ni des préconisations
   constructeur : elles doivent être validées par un mécanicien / le carnet du
   constructeur, puis ajustées véhicule par véhicule (bouton « Seuils »).
   ========================================================================= */

const CATEGORIES = [
  { key: "leger",       label: "Léger",         icon: "🚗", hint: "Berline, SUV, 4x4" },
  { key: "utilitaire",  label: "Utilitaire",    icon: "🛻", hint: "Pick-up, camionnette, fourgon" },
  { key: "minibus",     label: "Minibus",       icon: "🚐", hint: "Minibus, car léger" },
  { key: "bus",         label: "Bus / Autocar", icon: "🚌", hint: "Bus universitaire, transport collectif" },
  { key: "poids_lourd", label: "Poids lourd",   icon: "🚛", hint: "Camion, citerne, benne" },
  { key: "deux_roues",  label: "Deux-roues",    icon: "🏍️", hint: "Moto, scooter" },
];
const DEFAULT_CATEGORY = "leger";
const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

// Préselection pratique du formulaire (modifiable par l'utilisateur).
const USAGE_DEFAULT_CATEGORY = { "Bus universitaire": "bus" };

// Usages dont l'indisponibilité est la plus coûteuse : alerte plus précoce (25 % au lieu de 15 %).
const PRIORITY_USAGES = ["Ambulance", "SAMU", "SMUR", "Pompiers", "Police", "Armée"];
const WARN_FRACTION = 0.15;
const WARN_FRACTION_PRIORITY = 0.25;

const ITEM_ORDER = ["Batterie", "Vidange", "Pneus", "Freins"];

// { km : intervalle en kilomètres, months : intervalle en mois } — le premier atteint déclenche l'échéance.
const DEFAULT_INTERVALS = {
  leger:       { Vidange: { km: 10000, months: 12 }, Freins: { km: 30000, months: 24 }, Pneus: { km: 40000, months: 48 }, Batterie: { km: 60000, months: 48 } },
  utilitaire:  { Vidange: { km: 8000,  months: 9 },  Freins: { km: 25000, months: 18 }, Pneus: { km: 35000, months: 36 }, Batterie: { km: 50000, months: 36 } },
  minibus:     { Vidange: { km: 8000,  months: 6 },  Freins: { km: 20000, months: 12 }, Pneus: { km: 30000, months: 36 }, Batterie: { km: 50000, months: 36 } },
  bus:         { Vidange: { km: 10000, months: 6 },  Freins: { km: 15000, months: 9 },  Pneus: { km: 40000, months: 36 }, Batterie: { km: 40000, months: 24 } },
  poids_lourd: { Vidange: { km: 15000, months: 6 },  Freins: { km: 20000, months: 9 },  Pneus: { km: 50000, months: 36 }, Batterie: { km: 40000, months: 24 } },
  deux_roues:  { Vidange: { km: 3000,  months: 6 },  Freins: { km: 10000, months: 12 }, Pneus: { km: 15000, months: 24 }, Batterie: { km: 20000, months: 24 } },
};

const _nf = (n) => Number(n || 0).toLocaleString("fr-FR");
const _validPos = (x) => typeof x === "number" && isFinite(x) && x > 0;

function categoryOf(vehicle) {
  return CATEGORY_BY_KEY[vehicle && vehicle.category] || CATEGORY_BY_KEY[DEFAULT_CATEGORY];
}
function hasCategory(vehicle) {
  return !!(vehicle && CATEGORY_BY_KEY[vehicle.category]);
}

/* Seuils effectifs = défauts de la catégorie, surchargés par vehicle.intervals (champ par champ, valeurs valides uniquement). */
function getIntervals(vehicle) {
  const base = DEFAULT_INTERVALS[categoryOf(vehicle).key];
  const over = (vehicle && vehicle.intervals) || {};
  const out = {};
  for (const label of ITEM_ORDER) {
    const o = over[label] || {};
    out[label] = {
      km: _validPos(o.km) ? o.km : base[label].km,
      months: _validPos(o.months) ? o.months : base[label].months,
    };
  }
  return out;
}
function defaultIntervals(categoryKey) {
  const base = DEFAULT_INTERVALS[CATEGORY_BY_KEY[categoryKey] ? categoryKey : DEFAULT_CATEGORY];
  return JSON.parse(JSON.stringify(base));
}

function lastOfType(maintenances, type) {
  return maintenances
    .filter((m) => m.type === type)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1; // le plus récent d'abord
      return (b.mileage || 0) - (a.mileage || 0);
    })[0];
}

function _parseDate(s) {
  const t = Date.parse(s || "");
  return isNaN(t) ? null : new Date(t);
}
function _addMonths(d, n) {
  const r = new Date(d.getTime());
  r.setMonth(r.getMonth() + n);
  return r;
}
function _statusOf(fraction, warn) {
  if (fraction <= 0) return "depasse";
  if (fraction <= warn) return "proche";
  return "ok";
}
const _rank = { ok: 0, proche: 1, depasse: 2 };

function fmtDelayDays(days) {
  const d = Math.abs(days);
  if (d <= 60) return `${d} j`;
  const months = Math.round(d / 30.44);
  return `${months} mois`;
}

/**
 * Score de maintenance : 100 − pénalités.
 *  - chaque élément (batterie, vidange, pneus, freins) est évalué sur le KILOMÉTRAGE et sur le TEMPS ;
 *    c'est le critère le plus avancé qui décide (« km ou mois, au premier atteint ») ;
 *  - seules les anomalies NON RÉSOLUES comptent.
 * `now` est injectable pour les tests.
 */
function computeScore(vehicle, maintenances, issues, now = new Date()) {
  const intervals = getIntervals(vehicle);
  const warn = PRIORITY_USAGES.includes(vehicle.type) ? WARN_FRACTION_PRIORITY : WARN_FRACTION;
  const created = _parseDate(vehicle.createdAt);
  let score = 100;

  const items = ITEM_ORDER.map((label) => {
    const { km, months } = intervals[label];
    const last = lastOfType(maintenances, label);
    const baseKm = last ? last.mileage : (vehicle.initialMileage ?? vehicle.mileage);
    const dueAtKm = baseKm + km;
    const remainingKm = dueAtKm - vehicle.mileage;
    const fracKm = remainingKm / km;

    const baseDate = last ? _parseDate(last.date) : created;
    let remainingDays = null, dueDate = null, fracTime = null;
    if (baseDate) {
      dueDate = _addMonths(baseDate, months);
      remainingDays = Math.ceil((dueDate.getTime() - now.getTime()) / 86400000);
      const totalDays = Math.max(1, (dueDate.getTime() - baseDate.getTime()) / 86400000);
      fracTime = remainingDays / totalDays;
    }

    const stKm = _statusOf(fracKm, warn);
    const stTime = fracTime === null ? "ok" : _statusOf(fracTime, warn);
    const status = _rank[stTime] > _rank[stKm] ? stTime : stKm;
    const basis = fracTime !== null && fracTime < fracKm ? "temps" : "km";
    const fraction = fracTime !== null ? Math.min(fracKm, fracTime) : fracKm;

    if (status === "proche") score -= 5;
    if (status === "depasse") score -= 15;

    return {
      label, status, basis, fraction,
      remainingKm, dueAtKm, remainingDays,
      dueDate: dueDate ? dueDate.toISOString() : null,
      lastDate: last ? last.date : undefined,
      interval: { km, months },
    };
  });

  const openIssues = (issues || []).filter((i) => !i.resolved);
  for (const issue of openIssues) {
    if (issue.severity === "surveiller") score -= 10;
    if (issue.severity === "critique") score -= 30;
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 80 ? "vert" : score >= 60 ? "jaune" : "rouge";
  const label =
    level === "vert" ? "Bon niveau de maintenance" : level === "jaune" ? "À surveiller" : "Maintenance recommandée";
  const maintenanceState = level === "vert" ? "Bonne" : level === "jaune" ? "À surveiller" : "Recommandée";

  // À urgence égale (véhicule neuf), on affiche l'entretien le plus rapproché (intervalle le plus court).
  const next = [...items].sort((a, b) => (a.fraction - b.fraction) || (a.interval.km - b.interval.km))[0];
  let nextDueLabel = "—";
  if (next) {
    if (next.basis === "temps") {
      const d = next.remainingDays;
      nextDueLabel = d <= 0
        ? `${next.label} — dépassée de ${fmtDelayDays(d)}`
        : `${next.label} — dans ${fmtDelayDays(d)} (le ${new Date(next.dueDate).toLocaleDateString("fr-FR")})`;
    } else {
      nextDueLabel = next.remainingKm <= 0
        ? `${next.label} — dépassée de ${_nf(Math.abs(next.remainingKm))} km`
        : `${next.label} — dans ${_nf(next.remainingKm)} km (à ${_nf(next.dueAtKm)} km)`;
    }
  }

  return { score, level, label, maintenanceState, items, nextDueLabel, openIssues: openIssues.length, category: categoryOf(vehicle).key };
}

/* Textes d'affichage d'un élément (fiche véhicule) : une ligne km, une ligne délai. */
function describeItem(item) {
  const kmText = item.remainingKm <= 0
    ? `Km : dépassé de ${_nf(Math.abs(item.remainingKm))} km`
    : `Km : dans ${_nf(item.remainingKm)} km`;
  let timeText = "Délai : —";
  if (item.remainingDays !== null) {
    timeText = item.remainingDays <= 0
      ? `Délai : dépassé de ${fmtDelayDays(item.remainingDays)}`
      : `Délai : dans ${fmtDelayDays(item.remainingDays)}`;
  }
  return { kmText, timeText };
}
