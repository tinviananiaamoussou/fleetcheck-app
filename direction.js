"use strict";

/* =========================================================================
   FleetCheck — Lot 4 : tableau de bord direction et rapport de flotte

   Statut d'un véhicule (calculé, jamais saisi) :
   - 🔴 À TRAITER  : score < 60, OU anomalie critique ouverte, OU entretien
                     dépassé, OU document expiré.
   - 🟠 À SURVEILLER : score 60–79, OU anomalie à surveiller ouverte, OU entretien
                     proche, OU document à renouveler (≤ 30 jours).
   - 🟢 OPÉRATIONNEL : aucun des points ci-dessus.

   « Taux d'opérationnels » = part de véhicules 🟢. C'est un indicateur de
   conformité calculé à partir des données saisies, pas une mesure de
   disponibilité réelle (qui exigerait de suivre les jours d'immobilisation).
   ========================================================================= */

const STATUS_LABEL = { ok: "Opérationnel", surveiller: "À surveiller", traiter: "À traiter" };

function fleetStatus(vehicle, maints, issues, docs, inspections, now = new Date()) {
  const s = computeScore(vehicle, maints, issues, now);
  const red = [], orange = [];

  const open = issues.filter((i) => !i.resolved);
  const crit = open.filter((i) => i.severity === "critique");
  const minor = open.filter((i) => i.severity !== "critique");
  if (crit.length) red.push(`${crit.length} anomalie${crit.length > 1 ? "s" : ""} critique${crit.length > 1 ? "s" : ""} ouverte${crit.length > 1 ? "s" : ""} (${[...new Set(crit.map((i) => i.part))].join(", ")})`);
  if (minor.length) orange.push(`${minor.length} anomalie${minor.length > 1 ? "s" : ""} à surveiller`);

  const overdue = s.items.filter((i) => i.status === "depasse").map((i) => i.label);
  const near = s.items.filter((i) => i.status === "proche").map((i) => i.label);
  if (overdue.length) red.push(`Entretien dépassé : ${overdue.join(", ")}`);
  if (near.length) orange.push(`Entretien proche : ${near.join(", ")}`);

  const dExp = docs.filter((d) => documentStatus(d, now).level === "expire").map(docName);
  const dSoon = docs.filter((d) => ["urgent", "bientot"].includes(documentStatus(d, now).level)).map(docName);
  if (dExp.length) red.push(`Document expiré : ${dExp.join(", ")}`);
  if (dSoon.length) orange.push(`Document à renouveler : ${dSoon.join(", ")}`);

  let status = red.length || s.score < 60 ? "traiter" : orange.length || s.score < 80 ? "surveiller" : "ok";
  if (status === "traiter" && !red.length) red.push(`Score faible (${s.score}/100)`);
  if (status === "surveiller" && !orange.length) orange.push(`Score à surveiller (${s.score}/100)`);

  const last = inspections.length ? [...inspections].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] : null;
  const inspected24h = !!last && (now.getTime() - new Date(last.createdAt).getTime()) / 3600000 <= INSPECTION_STALE_HOURS;
  return { status, score: s.score, reasons: [...red, ...orange], redCount: red.length, inspected24h, openIssues: open.length };
}

/* ---------- Agrégation de la flotte (pur, testable) ---------- */

function buildFleetData({ vehicles, maints, issues, docs, inspections, fills, periodKey = "mois", now = new Date() }) {
  const group = (arr) => { const m = {}; for (const x of arr) (m[x.vehicleId] ||= []).push(x); return m; };
  const gM = group(maints), gI = group(issues), gD = group(docs), gN = group(inspections), gF = group(fills);
  const period = periodRange(periodKey, now);

  const rows = vehicles.map((v) => {
    const vm = gM[v.id] || [], vi = gI[v.id] || [], vd = gD[v.id] || [], vn = gN[v.id] || [], vf = gF[v.id] || [];
    const st = fleetStatus(v, vm, vi, vd, vn, now);
    const costs = costsForVehicle(vm, vf, period.from, period.to);
    const km = kmInPeriod(readingsOf(vm, vf, vn), period.from, period.to);
    const fs = fuelSummary(vf);
    return { vehicle: v, category: categoryOf(v).key, ...st, costs, km, fuelDrift: fs.drift, fuelAvg: fs.avg };
  });

  const counts = { ok: 0, surveiller: 0, traiter: 0 };
  rows.forEach((r) => counts[r.status]++);
  const total = rows.length;

  const byCategory = CATEGORIES.map((c) => {
    const rs = rows.filter((r) => r.category === c.key);
    if (!rs.length) return null;
    return {
      cat: c, count: rs.length,
      avgScore: Math.round(rs.reduce((s, r) => s + r.score, 0) / rs.length),
      traiter: rs.filter((r) => r.status === "traiter").length,
      surveiller: rs.filter((r) => r.status === "surveiller").length,
      costs: rs.reduce((s, r) => s + r.costs.total, 0),
    };
  }).filter(Boolean);

  const openIssues = issues.filter((i) => !i.resolved && vehicles.some((v) => v.id === i.vehicleId));
  const oldest = openIssues.map((i) => i.date).filter(Boolean).sort()[0];
  const today = localDateStr(now);
  const oldestDays = oldest ? Math.max(0, Math.round((new Date(today).getTime() - new Date(oldest).getTime()) / 86400000)) : null;

  const liveDocs = docs.filter((d) => vehicles.some((v) => v.id === d.vehicleId));
  const maint = rows.reduce((s, r) => s + r.costs.maint, 0);
  const fuel = rows.reduce((s, r) => s + r.costs.fuel, 0);
  const withKm = rows.filter((r) => r.km);
  const costPerKm = withKm.length ? withKm.reduce((s, r) => s + r.costs.total, 0) / withKm.reduce((s, r) => s + r.km, 0) : null;

  return {
    period, total, counts,
    opRate: total ? Math.round((counts.ok / total) * 100) : null,
    priority: rows.filter((r) => r.status === "traiter").sort((a, b) => b.redCount - a.redCount || a.score - b.score),
    watch: rows.filter((r) => r.status === "surveiller"),
    byCategory,
    issues: {
      open: openIssues.length,
      critical: openIssues.filter((i) => i.severity === "critique").length,
      minor: openIssues.filter((i) => i.severity !== "critique").length,
      oldestDays,
    },
    docs: summarizeDocuments(liveDocs, now),
    inspected: rows.filter((r) => r.inspected24h).length,
    costs: {
      total: maint + fuel, maint, fuel, costPerKm, kmVehicles: withKm.length,
      perVehicle: total ? Math.round((maint + fuel) / total) : 0,
      top: [...rows].sort((a, b) => b.costs.total - a.costs.total).filter((r) => r.costs.total > 0).slice(0, 5),
    },
    drift: rows.filter((r) => r.fuelDrift),
  };
}

/* ---------- Rendu (commun à l'écran et au rapport) ---------- */

const _fcfa = (n) => `${fmtNum(Math.round(n))} FCFA`;
const _vname = (v) => `${VEHICLE_ICONS[v.type] || ""} ${esc(v.brand)} ${esc(v.model)}${v.plate ? ` · ${esc(v.plate)}` : ""}`;
const _plural = (n, a, b) => (n > 1 ? b : a);

function directionBodyHTML(d, links) {
  const link = (r, inner) => (links ? `<a href="#/vehicule/${r.vehicle.id}" class="dir-link">${inner}</a>` : inner);
  if (d.total === 0) return `<div class="empty"><p>Aucun véhicule enregistré</p><p>Le tableau de bord se remplit dès le premier véhicule.</p></div>`;

  const kpis = `
    <div class="kpi-grid">
      <div class="kpi"><span>Véhicules</span><strong>${d.total}</strong></div>
      <div class="kpi ok"><span>Opérationnels</span><strong>${d.counts.ok}</strong><small>${d.opRate} %</small></div>
      <div class="kpi warn"><span>À surveiller</span><strong>${d.counts.surveiller}</strong></div>
      <div class="kpi bad"><span>À traiter</span><strong>${d.counts.traiter}</strong></div>
    </div>
    <p class="dir-note">Opérationnel : score ≥ 80, aucune anomalie ouverte, aucun entretien dépassé ou proche, aucun document expiré ou à renouveler. Indicateur de conformité calculé à partir des données saisies, pas une mesure de disponibilité réelle.</p>`;

  const priority = d.priority.length === 0
    ? `<p class="issue-line">✅ Aucun véhicule à traiter.</p>`
    : d.priority.map((r) => link(r, `<div class="dir-item bad">
        <div class="top"><span class="title">${_vname(r.vehicle)}</span><span class="dir-score">${r.score}</span></div>
        <ul>${r.reasons.slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>`)).join("");

  const cats = `<table class="dtable"><thead><tr><th>Catégorie</th><th>Nb</th><th>Score moy.</th><th>À traiter</th></tr></thead><tbody>
    ${d.byCategory.map((c) => `<tr><td>${c.cat.icon} ${c.cat.label}</td><td>${c.count}</td><td>${c.avgScore}</td><td>${c.traiter}</td></tr>`).join("")}</tbody></table>`;

  const ops = `
    <div class="row"><span>Anomalies ouvertes</span><span>${d.issues.open}${d.issues.open ? ` (${d.issues.critical} critique${_plural(d.issues.critical, "", "s")}, ${d.issues.minor} à surveiller)` : ""}</span></div>
    ${d.issues.oldestDays !== null ? `<div class="row"><span>Plus ancienne anomalie ouverte</span><span>${d.issues.oldestDays} j</span></div>` : ""}
    <div class="row"><span>Documents expirés</span><span>${d.docs.expire}</span></div>
    <div class="row"><span>Documents à renouveler (≤ 30 j)</span><span>${d.docs.urgent + d.docs.bientot}</span></div>
    <div class="row"><span>Véhicules inspectés (dernières 24 h)</span><span>${d.inspected} / ${d.total}</span></div>`;

  const c = d.costs;
  const costs = `
    <div class="row"><span>Total</span><span><strong>${_fcfa(c.total)}</strong></span></div>
    <div class="row"><span>Entretien</span><span>${_fcfa(c.maint)}</span></div>
    <div class="row"><span>Carburant</span><span>${_fcfa(c.fuel)}</span></div>
    <div class="row"><span>Coût moyen par véhicule</span><span>${_fcfa(c.perVehicle)}</span></div>
    <div class="row"><span>Coût au km (estimé)</span><span>${c.costPerKm === null ? "n/d (relevés insuffisants)" : `${fmtNum(Math.round(c.costPerKm))} FCFA/km`}</span></div>
    ${d.byCategory.some((x) => x.costs > 0) ? `<table class="dtable"><thead><tr><th>Catégorie</th><th>Coût (période)</th></tr></thead><tbody>
      ${d.byCategory.filter((x) => x.costs > 0).map((x) => `<tr><td>${x.cat.icon} ${x.cat.label}</td><td>${_fcfa(x.costs)}</td></tr>`).join("")}</tbody></table>` : ""}
    ${c.top.length ? `<h3 class="dir-sub">Véhicules les plus coûteux</h3>${c.top.map((r) => link(r, `<div class="row"><span>${_vname(r.vehicle)}</span><span>${_fcfa(r.costs.total)}${r.km ? ` · ${fmtNum(Math.round(r.costs.total / r.km))}/km` : ""}</span></div>`)).join("")}` : ""}`;

  const drift = d.drift.length === 0 ? "" : `
    <h2>Consommation à vérifier</h2>
    ${d.drift.map((r) => link(r, `<div class="dir-item warn"><div class="top"><span class="title">${_vname(r.vehicle)}</span><span class="dir-score">+${r.fuelDrift.pct} %</span></div>
      <p class="meta">${r.fuelDrift.base.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} → ${r.fuelDrift.last.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} L/100 km : fuite, pneus, conduite ou erreur de saisie à contrôler.</p></div>`)).join("")}`;

  return `${kpis}
    <h2>À traiter en priorité</h2>${priority}
    <h2>Par catégorie</h2>${cats}
    <h2>Anomalies, documents, inspections</h2>${ops}
    <h2>Coûts : ${esc(d.period.label.toLowerCase())}</h2>${costs}
    ${drift}`;
}

/* ---------- Chargement des données ---------- */

async function loadFleetData(periodKey) {
  const [vehicles, maints, issues, docs, inspections, fills, profile] = await Promise.all([
    Data.getVehicles(), Data.getAllMaintenances(), Data.getAllIssues(), Data.getAllDocuments(),
    Data.getAllInspections(), Data.getAllFuel(), Data.getProfile(),
  ]);
  return { data: buildFleetData({ vehicles, maints, issues, docs, inspections, fills, periodKey }), profile };
}

/* ---------- Écrans ---------- */

let dirPeriod = "mois";

async function renderDirection(root) {
  const { data, profile } = await loadFleetData(dirPeriod);
  root.innerHTML = `
    <div class="screen">
      ${shellHTML({
        title: "Tableau de bord direction", subtitle: profile?.organisation || "Vue d'ensemble de la flotte", backHref: "#/",
        action: `<a class="header-action" href="#/rapport/${dirPeriod}" aria-label="Rapport imprimable" style="text-decoration:none">🖨️</a>`,
      })}
      <main class="main dir-main">
        <div class="chip-row">${PERIODS.map((p) => `<button class="chip ${p.key === dirPeriod ? "active" : ""}" data-period="${p.key}">${p.label}</button>`).join("")}</div>
        ${directionBodyHTML(data, true)}
        ${data.total ? `<a class="btn block" href="#/rapport/${dirPeriod}" style="margin-top:1rem">🖨️ Rapport imprimable (PDF)</a>` : ""}
      </main>
    </div>`;
  qsa("[data-period]", root).forEach((b) => b.addEventListener("click", () => { dirPeriod = b.dataset.period; render(); }));
}

async function renderRapport(root, periodKey) {
  const key = PERIODS.some((p) => p.key === periodKey) ? periodKey : "mois";
  const { data, profile } = await loadFleetData(key);
  const now = new Date();
  root.innerHTML = `
    <div class="report-page">
      ${shellHTML({ title: "Rapport de flotte", backHref: "#/direction" })}
      <div class="report-doc">
        <h1>RAPPORT DE FLOTTE</h1>
        <p class="stamp">${esc(data.period.label)} (${new Date(data.period.from).toLocaleDateString("fr-FR")} au ${new Date(data.period.to).toLocaleDateString("fr-FR")}) · établi le ${now.toLocaleString("fr-FR")}${profile?.organisation ? ` · ${esc(profile.organisation)}` : ""}</p>
        ${directionBodyHTML(data, false)}
        <div class="sig">
          <h2>Responsable de flotte</h2>
          <p style="margin:0.3rem 0 0">${esc(profile?.manager || "")}</p>
          <div class="line">Fait le ${now.toLocaleDateString("fr-FR")}</div>
        </div>
        <p class="foot">Rapport calculé à partir des données saisies dans FleetCheck. Les seuils d'entretien et les statuts sont indicatifs et ne constituent ni un diagnostic mécanique ni une attestation réglementaire.</p>
      </div>
      <div class="report-actions"><div class="inner">
        <a class="btn secondary" href="#/direction">Retour</a>
        <button class="btn" id="btn-print">🖨️ Imprimer / Enregistrer en PDF</button>
      </div></div>
    </div>`;
  qs("#btn-print", root).addEventListener("click", () => window.print());
}
