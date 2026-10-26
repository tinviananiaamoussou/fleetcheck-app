"use strict";

/* =========================================================================
   FleetCheck — Lot 5 : carburant, consommation et coûts

   - Pleins de carburant par véhicule (date, litres, montant FCFA, kilométrage).
   - Consommation en L/100 km par la méthode du « plein à plein » : seuls les
     pleins marqués « plein complet » ferment un intervalle ; les pleins
     partiels intermédiaires s'additionnent.
   - Coûts = entretiens (déjà saisis avec leur coût) + carburant.
   - Alerte de dérive : la dernière consommation dépasse de plus de 25 % la
     moyenne des intervalles précédents (≥ 3). C'est un SIGNAL à vérifier
     (fuite, pneus, conduite, erreur de saisie…), pas une preuve.
   ========================================================================= */

const FUEL_DRIFT_PCT = 25;
const FUEL_MIN_INTERVALS_FOR_DRIFT = 4; // 3 de référence + le dernier
const FUEL_SANE_MIN = 1, FUEL_SANE_MAX = 80; // L/100 km : hors de cet intervalle, la saisie est suspecte

/* ---------- Périodes ---------- */

const PERIODS = [
  { key: "mois", label: "Ce mois" },
  { key: "90j", label: "90 jours" },
  { key: "12m", label: "12 mois" },
];

function periodRange(key, now = new Date()) {
  const to = localDateStr(now);
  const back = (n) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n); return localDateStr(d); };
  let from;
  if (key === "90j") from = back(89);
  else if (key === "12m") from = back(364);
  else from = to.slice(0, 8) + "01";
  const label = (PERIODS.find((p) => p.key === key) || PERIODS[0]).label;
  return { key, from, to, label };
}

const inRange = (d, from, to) => !!d && d >= from && d <= to;

/* ---------- Consommation ---------- */

function fuelIntervals(fills) {
  const sorted = [...fills].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.mileage - b.mileage));
  const out = [];
  let prevFull = null, liters = 0, amount = 0;
  for (const f of sorted) {
    liters += Number(f.liters) || 0;
    amount += Number(f.amount) || 0;
    if (f.full) {
      if (prevFull) {
        const km = f.mileage - prevFull.mileage;
        if (km > 0) {
          const l100 = (liters / km) * 100;
          out.push({ id: f.id, date: f.date, km, liters, amount, l100, costPerKm: amount / km, suspect: l100 < FUEL_SANE_MIN || l100 > FUEL_SANE_MAX });
        }
      }
      prevFull = f; liters = 0; amount = 0;
    }
  }
  return out;
}

function fuelSummary(fills) {
  const intervals = fuelIntervals(fills);
  const valid = intervals.filter((i) => !i.suspect);
  const wavg = (arr) => {
    const km = arr.reduce((s, i) => s + i.km, 0);
    const l = arr.reduce((s, i) => s + i.liters, 0);
    return km > 0 ? (l / km) * 100 : null;
  };
  const avg = wavg(valid);
  const last = valid[valid.length - 1] || null;
  let drift = null;
  if (valid.length >= FUEL_MIN_INTERVALS_FOR_DRIFT) {
    const base = wavg(valid.slice(0, -1));
    if (base && last.l100 > base * (1 + FUEL_DRIFT_PCT / 100)) {
      drift = { pct: Math.round((last.l100 / base - 1) * 100), base, last: last.l100 };
    }
  }
  return { intervals, valid, avg, last, drift, suspects: intervals.filter((i) => i.suspect) };
}

/* ---------- Coûts ---------- */

function costsForVehicle(maints, fills, from, to) {
  const maint = maints.filter((m) => inRange(m.date, from, to)).reduce((s, m) => s + (Number(m.cost) || 0), 0);
  const fuel = fills.filter((f) => inRange(f.date, from, to)).reduce((s, f) => s + (Number(f.amount) || 0), 0);
  return { maint, fuel, total: maint + fuel };
}

// Kilomètres parcourus estimés sur la période : écart entre le premier et le dernier relevé daté dans la période.
function kmInPeriod(readings, from, to) {
  const r = readings.filter((x) => inRange(x.date, from, to) && Number.isFinite(x.mileage));
  if (r.length < 2) return null;
  const km = Math.max(...r.map((x) => x.mileage)) - Math.min(...r.map((x) => x.mileage));
  return km > 0 ? km : null;
}

function readingsOf(maints, fills, inspections) {
  return [
    ...maints.map((m) => ({ date: m.date, mileage: m.mileage })),
    ...fills.map((f) => ({ date: f.date, mileage: f.mileage })),
    ...(inspections || []).filter((i) => i.mileage).map((i) => ({ date: i.date, mileage: i.mileage })),
  ];
}

const _fmtL = (n) => (n === null || n === undefined ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/* ---------- Fiche véhicule ---------- */

function costsSectionHTML(vehicle, maints, fills) {
  const r = periodRange("mois");
  const c = costsForVehicle(maints, fills, r.from, r.to);
  const s = fuelSummary(fills);
  const byId = Object.fromEntries(s.intervals.map((i) => [i.id, i]));
  const recent = [...fills].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.mileage - a.mileage)).slice(0, 5);

  const stats = `
    <div class="stat-grid">
      <div class="stat"><span>Entretien (ce mois)</span><strong>${fmtNum(c.maint)} FCFA</strong></div>
      <div class="stat"><span>Carburant (ce mois)</span><strong>${fmtNum(c.fuel)} FCFA</strong></div>
      <div class="stat"><span>Conso. moyenne</span><strong>${s.avg === null ? "—" : _fmtL(s.avg) + " L/100"}</strong></div>
      <div class="stat"><span>Dernière conso.</span><strong>${s.last ? _fmtL(s.last.l100) + " L/100" : "—"}</strong></div>
    </div>`;
  const drift = s.drift
    ? `<p class="notice drift"><span>⚠️</span><span><strong>Consommation à vérifier : +${s.drift.pct} %</strong> (${_fmtL(s.drift.base)} → ${_fmtL(s.drift.last)} L/100 km). Causes possibles : fuite, pneus, conduite, erreur de saisie. À contrôler.</span></p>`
    : "";
  const susp = s.suspects.length
    ? `<p class="notice"><span>🔎</span><span>${s.suspects.length} intervalle${s.suspects.length > 1 ? "s" : ""} de consommation improbable${s.suspects.length > 1 ? "s" : ""} (hors ${FUEL_SANE_MIN}–${FUEL_SANE_MAX} L/100 km), ignoré${s.suspects.length > 1 ? "s" : ""} dans les moyennes : vérifiez litres et kilométrages.</span></p>`
    : "";
  const list = recent.length === 0
    ? `<p style="color:var(--muted);font-size:0.9rem">Aucun plein enregistré. Ajoutez-en au moins deux « complets » pour calculer la consommation.</p>`
    : `<ul class="history-list">${recent.map((f) => {
        const iv = byId[f.id];
        return `<li class="history-item doc-item"><button type="button" class="doc-edit" data-action="edit-fuel" data-id="${f.id}">
          <div class="top"><span class="title">${fmtDate(f.date)} · ${_fmtL(f.liters)} L</span><span class="meta">${fmtNum(f.amount)} FCFA</span></div>
          <p class="meta">${fmtNum(f.mileage)} km${f.full ? "" : " · plein partiel"}${f.station ? ` · ${esc(f.station)}` : ""}${iv ? ` · ${iv.suspect ? "⚠️ " : ""}${_fmtL(iv.l100)} L/100 km` : ""}</p>
        </button></li>`;
      }).join("")}</ul>`;
  return `<h3 class="section-title">Coûts et carburant</h3>${stats}${drift}${susp}${list}
    <button type="button" class="btn secondary block" data-action="add-fuel" style="margin-top:.7rem">⛽ Ajouter un plein</button>`;
}

function bindFuel(vehicle, fills, maints, root) {
  const add = qs('[data-action="add-fuel"]', root);
  if (add) add.addEventListener("click", () => openFuelModal(vehicle, null, fills, maints));
  qsa('[data-action="edit-fuel"]', root).forEach((b) => b.addEventListener("click", () => {
    const f = fills.find((x) => x.id === Number(b.dataset.id));
    if (f) openFuelModal(vehicle, f, fills, maints);
  }));
}

function openFuelModal(vehicle, fill, fills, maints) {
  const editing = !!fill;
  const f = fill || {};
  const o = openModal(`
    <h3>${editing ? "Modifier le plein" : "Ajouter un plein"}</h3>
    <div class="grid-2">
      <div class="field"><label for="fu-date">Date</label><input id="fu-date" type="date" value="${esc(f.date || localDateStr())}" /></div>
      <div class="field"><label for="fu-km">Kilométrage</label><input id="fu-km" inputmode="numeric" value="${esc(f.mileage ?? vehicle.mileage ?? "")}" /></div>
      <div class="field"><label for="fu-l">Litres</label><input id="fu-l" inputmode="decimal" value="${esc(f.liters ?? "")}" placeholder="45,5" /></div>
      <div class="field"><label for="fu-amt">Montant (FCFA)</label><input id="fu-amt" inputmode="numeric" value="${esc(f.amount ?? "")}" /></div>
    </div>
    <div class="field"><label for="fu-st">Station (facultatif)</label><input id="fu-st" value="${esc(f.station || "")}" /></div>
    <label class="check-row"><input type="checkbox" id="fu-full" ${f.full === false ? "" : "checked"} /> <span>Plein complet (réservoir rempli à ras)<br><small>Nécessaire pour calculer la consommation.</small></span></label>
    <button class="btn block" id="fu-save">${editing ? "Enregistrer" : "Ajouter"}</button>
    ${editing ? `<button class="btn ghost block danger-link" id="fu-del" style="margin-top:.6rem">🗑️ Supprimer ce plein</button>` : ""}
  `);
  qs("#fu-save", o).addEventListener("click", async () => {
    const date = qs("#fu-date", o).value;
    const liters = Number(String(qs("#fu-l", o).value).replace(",", "."));
    const amount = Number(String(qs("#fu-amt", o).value).replace(/\s/g, "")) || 0;
    const mileage = Number(qs("#fu-km", o).value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("Date invalide", true); return; }
    if (!(liters > 0) || liters > 2000) { toast("Litres : entrez une valeur entre 0 et 2000", true); return; }
    if (!Number.isFinite(mileage) || mileage < 0 || qs("#fu-km", o).value.trim() === "") { toast("Kilométrage invalide", true); return; }
    if (amount < 0) { toast("Montant invalide", true); return; }
    if (!editing) {
      // Une saisie récente ne peut pas avoir un kilométrage inférieur au dernier relevé connu.
      const latest = [...fills.map((x) => x.date), ...maints.map((m) => m.date), String(vehicle.createdAt || "").slice(0, 10)].filter(Boolean).sort().pop() || "";
      if (date >= latest && mileage < (vehicle.mileage || 0)) {
        toast(`Kilométrage inférieur au dernier relevé (${fmtNum(vehicle.mileage)} km)`, true); return;
      }
    }
    const rec = { ...f, vehicleId: vehicle.id, date, liters, amount, mileage, full: qs("#fu-full", o).checked, station: qs("#fu-st", o).value.trim() || undefined };
    if (!editing) rec.createdAt = new Date().toISOString();
    try {
      await Data.saveFuel(rec, editing);
      o.remove(); toast(editing ? "Plein modifié" : "Plein ajouté"); render();
    } catch (err) { toast("Enregistrement impossible : " + err.message, true); }
  });
  const del = qs("#fu-del", o);
  if (del) del.addEventListener("click", async () => {
    if (del.dataset.confirm !== "1") { del.dataset.confirm = "1"; del.textContent = "Confirmer la suppression"; return; }
    await Data.deleteFuel(f.id);
    o.remove(); toast("Plein supprimé"); render();
  });
}
