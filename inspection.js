"use strict";

/* =========================================================================
   FleetCheck — Lot 3 : inspection avant départ

   Liste de contrôle en un tap (OK / Défaut / N/A) adaptée à la catégorie du
   véhicule et à son usage. Chaque défaut déclaré devient automatiquement une
   anomalie (sans doublon tant qu'une anomalie ouverte existe pour le même
   point) : il alimente donc le score et la déclaration de mission.

   ⚠️ La liste est INDICATIVE : à adapter aux procédures de votre structure et
   à la réglementation en vigueur. Les points « critiques » (défaut = départ
   déconseillé) sont un choix de départ du prototype, pas une norme.
   ========================================================================= */

const INSPECTION_STALE_HOURS = 24;
const INSPECTION_RESULT_LABEL = {
  apte: "✅ Apte au départ",
  defauts: "⚠️ Défauts à surveiller",
  bloquant: "⛔ Défaut bloquant : départ déconseillé",
};
const INSPECTOR_KEY = "fleetcheck_inspector";
const MEDICAL_USAGES = ["Ambulance", "SAMU", "SMUR"];

function checklistFor(vehicle) {
  const cat = categoryOf(vehicle).key;
  const it = (key, label, part, critical = false) => ({ key, label, part, critical });

  let list;
  if (cat === "deux_roues") {
    list = [
      it("freins", "Freins (levier et pédale, efficacité)", "Freins", true),
      it("pneus", "Pneus (usure, pression)", "Pneus", true),
      it("direction", "Guidon / direction (pas de jeu anormal)", "Direction", true),
      it("chaine", "Chaîne / transmission (tension, graissage)", "Autre"),
      it("feux", "Feux et clignotants", "Éclairage"),
      it("retros", "Rétroviseurs", "Carrosserie"),
      it("niveaux", "Niveau d'huile", "Moteur"),
      it("fuites", "Aucune fuite visible", "Moteur"),
      it("casque", "Casque disponible", "Équipement de sécurité"),
    ];
  } else {
    list = [
      it("freins", "Freins (pédale ferme, frein à main)", "Freins", true),
      it("pneus", "Pneus (usure, pression, hernies)", "Pneus", true),
      it("direction", "Direction (pas de jeu anormal)", "Direction", true),
      it("feux", "Feux, phares et clignotants", "Éclairage"),
      it("visibilite", "Pare-brise, essuie-glaces, rétroviseurs", "Carrosserie"),
      it("niveaux", "Niveaux (huile, liquide de refroidissement)", "Moteur"),
      it("fuites", "Aucune fuite visible sous le véhicule", "Moteur"),
      it("batterie", "Batterie (démarrage correct, bornes propres)", "Batterie"),
      it("klaxon", "Avertisseur sonore", "Équipement de sécurité"),
      it("carrosserie", "Carrosserie et portières (chocs, fixation)", "Carrosserie"),
    ];
    if (cat === "leger" || cat === "utilitaire") list.push(it("ceintures", "Ceintures de sécurité", "Équipement de sécurité"));
    if (cat === "utilitaire") list.push(it("chargement", "Chargement arrimé, portes arrière fermées", "Autre", true));
    if (cat === "minibus" || cat === "bus") {
      list.push(
        it("issues", "Issues de secours et portes de service", "Équipement de sécurité", true),
        it("extincteur", "Extincteur (présent, non périmé)", "Équipement de sécurité"),
        it("trousse", "Trousse de secours", "Équipement de sécurité"),
        it("sieges", "Sièges et ceintures passagers", "Équipement de sécurité"),
        it("interieur", "Éclairage intérieur et marchepied", "Éclairage"),
      );
    }
    if (cat === "poids_lourd") {
      list.push(
        it("attelage", "Attelage / remorque (si présent)", "Autre", true),
        it("chargement", "Chargement arrimé / bâche fixée", "Autre", true),
        it("securite", "Triangle de signalisation et extincteur", "Équipement de sécurité"),
      );
    }
  }
  if (PRIORITY_USAGES.includes(vehicle.type)) {
    list.push(it("signaux", "Signaux prioritaires (gyrophare, sirène)", "Équipement de sécurité"));
  }
  if (MEDICAL_USAGES.includes(vehicle.type)) {
    list.push(it("materiel", "Matériel de bord (brancard, oxygène…)", "Équipement de sécurité"));
  }
  return list;
}

function inspectionResult(items) {
  const defects = items.filter((i) => i.status === "defaut");
  if (defects.some((i) => i.critical)) return "bloquant";
  return defects.length ? "defauts" : "apte";
}

function localDateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function lastInspection(inspections) {
  return [...inspections].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

/* Construit l'inspection + les anomalies à créer (pur, testable). */
function buildInspection({ vehicle, items, inspector, mileage, existingIssues, now = new Date() }) {
  const result = inspectionResult(items);
  const openKeys = new Set(existingIssues.filter((i) => !i.resolved && i.source === "inspection").map((i) => i.itemKey));
  const defects = items.filter((i) => i.status === "defaut");
  const newIssues = [];
  const alreadyOpen = [];
  for (const d of defects) {
    if (openKeys.has(d.key)) { alreadyOpen.push(d); continue; }
    newIssues.push({
      vehicleId: vehicle.id,
      part: d.part,
      description: `Inspection avant départ : ${d.label}${d.note ? ` — ${d.note}` : ""}`,
      severity: d.critical ? "critique" : "surveiller",
      date: localDateStr(now),
      responsible: inspector,
      source: "inspection",
      itemKey: d.key,
      createdAt: now.toISOString(),
    });
  }
  const inspection = {
    vehicleId: vehicle.id, date: localDateStr(now), createdAt: now.toISOString(),
    inspector, mileage: mileage || undefined, items, result,
  };
  return { inspection, newIssues, alreadyOpen, result };
}

/* ---------- Fragments HTML ---------- */

function inspectionTimeLabel(i) {
  const d = new Date(i.createdAt);
  return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

function inspectionsSectionHTML(inspections) {
  const list = [...inspections].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5);
  const body = list.length === 0
    ? `<p style="color:var(--muted);font-size:0.9rem">Aucune inspection enregistrée.</p>`
    : `<ul class="history-list">${list.map((i) => {
        const defects = i.items.filter((x) => x.status === "defaut");
        return `<li class="history-item">
          <div class="top"><span class="title">${esc(inspectionTimeLabel(i))}</span><span class="insp-badge ${i.result}">${esc(INSPECTION_RESULT_LABEL[i.result] || i.result)}</span></div>
          <p class="meta">Par ${esc(i.inspector)}${i.mileage ? ` · ${fmtNum(i.mileage)} km` : ""}</p>
          ${defects.length ? `<p class="note">Défauts : ${defects.map((x) => esc(x.label)).join(" ; ")}</p>` : ""}
        </li>`;
      }).join("")}</ul>`;
  return `<h3 class="section-title">Inspections avant départ</h3>${body}`;
}

function inspectionReportHTML(inspections, now = new Date()) {
  const last = lastInspection(inspections);
  if (!last) return `<p class="issue-line">⚠️ Aucune inspection avant départ enregistrée.</p>`;
  const ageH = (now.getTime() - new Date(last.createdAt).getTime()) / 3600000;
  const stale = ageH > INSPECTION_STALE_HOURS;
  return `<div class="row"><span>Dernière inspection</span><span>${esc(inspectionTimeLabel(last))}</span></div>
    <div class="row"><span>Inspecteur</span><span>${esc(last.inspector)}</span></div>
    <div class="row"><span>Résultat</span><span>${esc(INSPECTION_RESULT_LABEL[last.result] || last.result)}</span></div>
    ${stale ? `<p class="issue-line" style="color:var(--bad)">⚠️ Cette inspection date de plus de ${INSPECTION_STALE_HOURS} h : refaites-la avant le départ.</p>` : ""}`;
}

/* ---------- Écran d'inspection ---------- */

async function renderInspection(root, vehicleId) {
  const [vehicle, profile] = await Promise.all([Data.getVehicle(vehicleId), Data.getProfile()]);
  if (!vehicle) {
    root.innerHTML = `<div class="screen">${shellHTML({ title: "Véhicule introuvable", backHref: "#/" })}<main class="main"><p>Ce véhicule n'existe plus.</p></main></div>`;
    return;
  }
  const list = checklistFor(vehicle);
  const state = {}; // key -> "ok" | "defaut" | "na"
  let saved = "";
  try { saved = localStorage.getItem(INSPECTOR_KEY) || ""; } catch { /* ignoré */ }

  root.innerHTML = `
    <div class="screen">
      ${shellHTML({ title: "Inspection avant départ", subtitle: `${vehicle.brand} ${vehicle.model}${vehicle.plate ? " · " + vehicle.plate : ""}`, backHref: `#/vehicule/${vehicleId}` })}
      <main class="main">
        <div class="form-card">
          <div class="grid-2">
            <div class="field"><label for="in-by">Inspecteur / chauffeur</label><input id="in-by" value="${esc(saved || profile?.manager || "")}" placeholder="Votre nom" /></div>
            <div class="field"><label for="in-km">Kilométrage actuel</label><input id="in-km" inputmode="numeric" value="${esc(vehicle.mileage ?? "")}" /></div>
          </div>
        </div>
        <ul class="history-list insp-list">
          ${list.map((x) => `
            <li class="history-item insp-row" data-key="${x.key}">
              <div class="insp-label">${esc(x.label)}${x.critical ? ` <span class="insp-crit">critique</span>` : ""}</div>
              <div class="insp-btns">
                <button type="button" class="insp-btn ok" data-s="ok">OK</button>
                <button type="button" class="insp-btn bad" data-s="defaut">Défaut</button>
                <button type="button" class="insp-btn na" data-s="na">N/A</button>
              </div>
              <input class="insp-note" placeholder="Précisez le défaut (facultatif)" hidden />
            </li>`).join("")}
        </ul>
        <p class="disclaimer">Liste indicative : à adapter à vos procédures internes et à la réglementation en vigueur. Chaque défaut déclaré crée une anomalie.</p>
      </main>
      <div class="bottom-bar"><div class="bottom-bar-inner cols-2">
        <button class="btn secondary" id="in-allok" type="button">Tout OK</button>
        <button class="btn" id="in-save" type="button" disabled>Valider (0/${list.length})</button>
      </div></div>
    </div>`;

  const saveBtn = qs("#in-save", root);
  const refresh = () => {
    const done = list.filter((x) => state[x.key]).length;
    saveBtn.textContent = `Valider (${done}/${list.length})`;
    saveBtn.disabled = done !== list.length;
  };
  const setState = (row, key, s) => {
    state[key] = s;
    qsa(".insp-btn", row).forEach((b) => b.classList.toggle("sel", b.dataset.s === s));
    row.classList.toggle("is-bad", s === "defaut");
    qs(".insp-note", row).hidden = s !== "defaut";
    refresh();
  };
  qsa(".insp-row", root).forEach((row) => {
    qsa(".insp-btn", row).forEach((b) => b.addEventListener("click", () => setState(row, row.dataset.key, b.dataset.s)));
  });
  qs("#in-allok", root).addEventListener("click", () => {
    qsa(".insp-row", root).forEach((row) => { if (!state[row.dataset.key]) setState(row, row.dataset.key, "ok"); });
  });

  saveBtn.addEventListener("click", async () => {
    const inspector = qs("#in-by", root).value.trim();
    if (!inspector) { toast("Indiquez le nom de l'inspecteur", true); return; }
    const kmRaw = qs("#in-km", root).value.trim();
    const km = kmRaw === "" ? null : Number(kmRaw);
    if (km !== null && (!Number.isFinite(km) || km < 0)) { toast("Kilométrage invalide", true); return; }
    if (km !== null && km < (vehicle.mileage || 0)) { toast("Le kilométrage est inférieur au dernier relevé", true); return; }
    saveBtn.disabled = true;
    try {
      const items = list.map((x) => {
        const row = qs(`.insp-row[data-key="${x.key}"]`, root);
        const note = state[x.key] === "defaut" ? qs(".insp-note", row).value.trim() : "";
        return { key: x.key, label: x.label, part: x.part, critical: x.critical, status: state[x.key], ...(note ? { note } : {}) };
      });
      const existing = await Data.getIssues(vehicleId);
      const built = buildInspection({ vehicle, items, inspector, mileage: km, existingIssues: existing });
      await Data.saveInspection(built.inspection, built.newIssues, vehicleId, km);
      try { localStorage.setItem(INSPECTOR_KEY, inspector); } catch { /* ignoré */ }
      showInspectionResult(vehicleId, built);
    } catch (err) {
      saveBtn.disabled = false;
      toast("Enregistrement impossible : " + err.message, true);
    }
  });
}

function showInspectionResult(vehicleId, built) {
  location.hash = `#/vehicule/${vehicleId}`; // on quitte l'écran de saisie : pas de double validation possible
  const n = built.newIssues.length;
  const m = built.alreadyOpen.length;
  const o = openModal(`
    <h3>${esc(INSPECTION_RESULT_LABEL[built.result])}</h3>
    <p class="desc">${n ? `<strong>${n} anomalie${n > 1 ? "s" : ""}</strong> créée${n > 1 ? "s" : ""} automatiquement à partir des défauts déclarés.` : "Aucune nouvelle anomalie créée."}${m ? ` ${m} défaut${m > 1 ? "s" : ""} déjà signalé${m > 1 ? "s" : ""} et toujours ouvert${m > 1 ? "s" : ""} (non dupliqué${m > 1 ? "s" : ""}).` : ""}</p>
    ${built.result === "bloquant" ? `<p class="desc" style="color:var(--bad)">Au moins un point critique est en défaut : faites réparer ou faites valider le départ par votre responsable.</p>` : ""}
    <button class="btn block" id="ir-ok">Fermer</button>
  `);
  qs("#ir-ok", o).addEventListener("click", () => o.remove());
}
