"use strict";

/* =========================================================================
   FleetCheck — application 100% locale (IndexedDB), sans backend.
   ========================================================================= */

/* ---------- Constantes métier ---------- */

const VEHICLE_TYPES = [
  "Ambulance", "SAMU", "SMUR", "Pompiers", "Police", "Armée",
  "Bus universitaire", "Véhicule de service", "Taxi", "Transport", "Entreprise", "Particulier", "Autre",
];

const VEHICLE_ICONS = {
  Ambulance: "🚑", SAMU: "🏥", SMUR: "🚨", Pompiers: "🚒", Police: "🚓",
  Armée: "🪖", "Bus universitaire": "🚌", "Véhicule de service": "🏛️", Taxi: "🚕", Transport: "🚐", Entreprise: "🏢",
  Particulier: "🚗", Autre: "⚙️",
};

const MAINTENANCE_TYPES = ["Vidange", "Freins", "Pneus", "Batterie", "Autre"];
const ISSUE_PARTS = ["Freins", "Pneus", "Batterie", "Moteur", "Carrosserie", "Éclairage", "Direction", "Équipement de sécurité", "Autre"];

const SEVERITIES = [
  { value: "faible", label: "🟢 Faible" },
  { value: "surveiller", label: "🟡 À surveiller" },
  { value: "critique", label: "🔴 Critique" },
];
const SEVERITY_LABEL = { faible: "Faible", surveiller: "À surveiller", critique: "Critique" };

const SCORE_DISCLAIMER =
  "Ce score est un indicateur calculé à partir des données que vous saisissez et de seuils d'entretien indicatifs. Ce n'est pas un diagnostic mécanique.";

/* ---------- IndexedDB ---------- */

const DB_NAME = "fleetcheck";
const DB_VERSION = 2;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("vehicles")) {
        db.createObjectStore("vehicles", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("maintenances")) {
        const s = db.createObjectStore("maintenances", { keyPath: "id", autoIncrement: true });
        s.createIndex("vehicleId", "vehicleId");
      }
      if (!db.objectStoreNames.contains("issues")) {
        const s = db.createObjectStore("issues", { keyPath: "id", autoIncrement: true });
        s.createIndex("vehicleId", "vehicleId");
      }
      if (!db.objectStoreNames.contains("profile")) {
        db.createObjectStore("profile", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("garages")) {
        db.createObjectStore("garages", { keyPath: "vehicleId" });
      }
      if (!db.objectStoreNames.contains("documents")) {
        const s = db.createObjectStore("documents", { keyPath: "id", autoIncrement: true });
        s.createIndex("vehicleId", "vehicleId");
      }
      if (!db.objectStoreNames.contains("inspections")) {
        const s = db.createObjectStore("inspections", { keyPath: "id", autoIncrement: true });
        s.createIndex("vehicleId", "vehicleId");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Si un autre onglet doit mettre la base à niveau, on se ferme pour ne pas le bloquer.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const Data = {
  async getVehicles() {
    const store = await tx("vehicles", "readonly");
    return reqToPromise(store.getAll());
  },
  async getVehicle(id) {
    const store = await tx("vehicles", "readonly");
    return reqToPromise(store.get(id));
  },
  async addVehicle(v) {
    const store = await tx("vehicles", "readwrite");
    return reqToPromise(store.add(v));
  },
  async updateVehicleMileage(id, mileage) {
    const store = await tx("vehicles", "readwrite");
    const v = await reqToPromise(store.get(id));
    if (v && mileage > v.mileage) {
      v.mileage = mileage;
      await reqToPromise(store.put(v));
    }
  },
  async getMaintenances(vehicleId) {
    const store = await tx("maintenances", "readonly");
    return reqToPromise(store.index("vehicleId").getAll(vehicleId));
  },
  async getAllMaintenances() {
    const store = await tx("maintenances", "readonly");
    return reqToPromise(store.getAll());
  },
  async addMaintenance(m) {
    const store = await tx("maintenances", "readwrite");
    return reqToPromise(store.add(m));
  },
  async getIssues(vehicleId) {
    const store = await tx("issues", "readonly");
    return reqToPromise(store.index("vehicleId").getAll(vehicleId));
  },
  async getAllIssues() {
    const store = await tx("issues", "readonly");
    return reqToPromise(store.getAll());
  },
  async addIssue(i) {
    const store = await tx("issues", "readwrite");
    return reqToPromise(store.add(i));
  },
  async getProfile() {
    const store = await tx("profile", "readonly");
    return reqToPromise(store.get("local"));
  },
  async saveProfile(organisation, manager) {
    const store = await tx("profile", "readwrite");
    return reqToPromise(store.put({ key: "local", organisation, manager }));
  },
  async getGarage(vehicleId) {
    const store = await tx("garages", "readonly");
    return reqToPromise(store.get(vehicleId));
  },
  async saveGarage(vehicleId, name, phone) {
    const store = await tx("garages", "readwrite");
    return reqToPromise(store.put({ vehicleId, name, phone }));
  },
  async getDocuments(vehicleId) {
    const store = await tx("documents", "readonly");
    return reqToPromise(store.index("vehicleId").getAll(vehicleId));
  },
  async getAllDocuments() {
    const store = await tx("documents", "readonly");
    return reqToPromise(store.getAll());
  },
  async addDocument(d) {
    const store = await tx("documents", "readwrite");
    return reqToPromise(store.add(d));
  },
  async updateDocument(d) {
    const store = await tx("documents", "readwrite");
    return reqToPromise(store.put(d));
  },
  async deleteDocument(id) {
    const store = await tx("documents", "readwrite");
    return reqToPromise(store.delete(id));
  },
  async getInspections(vehicleId) {
    const store = await tx("inspections", "readonly");
    return reqToPromise(store.index("vehicleId").getAll(vehicleId));
  },
  // Inspection + anomalies générées + kilométrage : UNE transaction (tout ou rien).
  async saveInspection(inspection, newIssues, vehicleId, mileage) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(["inspections", "issues", "vehicles"], "readwrite");
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("Enregistrement annulé"));
      t.objectStore("inspections").add(inspection);
      const issues = t.objectStore("issues");
      newIssues.forEach((i) => issues.add(i));
      if (mileage != null) {
        const vs = t.objectStore("vehicles");
        const r = vs.get(vehicleId);
        r.onsuccess = () => { const v = r.result; if (v && mileage > v.mileage) { v.mileage = mileage; vs.put(v); } };
      }
    });
  },
  async updateVehicle(v) {
    const store = await tx("vehicles", "readwrite");
    return reqToPromise(store.put(v));
  },
  async updateIssue(i) {
    const store = await tx("issues", "readwrite");
    return reqToPromise(store.put(i));
  },
  // Suppression en cascade dans UNE transaction : tout est supprimé, ou rien.
  async deleteVehicle(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(["vehicles", "maintenances", "issues", "garages", "documents", "inspections"], "readwrite");
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("Suppression annulée"));
      t.objectStore("vehicles").delete(id);
      t.objectStore("garages").delete(id);
      for (const name of ["maintenances", "issues", "documents", "inspections"]) {
        const store = t.objectStore(name);
        const req = store.index("vehicleId").getAllKeys(id);
        req.onsuccess = () => req.result.forEach((k) => store.delete(k));
      }
    });
  },
};

/* ---------- Score ---------- */

/* Score : voir scoring.js (catégories, seuils, computeScore) */

/* ---------- Utilitaires ---------- */

function fmtNum(n) { return Number(n || 0).toLocaleString("fr-FR"); }
function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function toast(message, isError = false) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 2200);
}

function fileToCompressedDataUrl(file, maxSize = 1000) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(String(reader.result)); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.65));
      };
      img.onerror = () => reject(new Error("Image invalide"));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("Lecture impossible"));
    reader.readAsDataURL(file);
  });
}

/* ---------- App shell (header commun) ---------- */

function shellHTML({ title, subtitle, backHref, action }) {
  return `
    <header class="header">
      <div class="header-inner">
        ${backHref
          ? `<a class="header-back" href="${backHref}" aria-label="Retour">‹</a>`
          : `<span class="header-badge">🛡️</span>`}
        <div class="header-title">
          <h1>${esc(title)}</h1>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
        </div>
        <div>${action || ""}</div>
      </div>
    </header>
  `;
}

/* ---------- Modales ---------- */

function openModal(innerHTML) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal-sheet">${innerHTML}</div>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}

function openLightbox(src) {
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  overlay.innerHTML = `<button class="lightbox-close" aria-label="Fermer">✕</button><img src="${src}" alt="Photo de l'anomalie" />`;
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

async function openProfileModal() {
  const profile = await Data.getProfile();
  const overlay = openModal(`
    <h3>Profil local</h3>
    <p class="desc">Ces informations restent sur cet appareil, comme toutes les données de l'application.</p>
    <div class="field"><label for="pf-org">Organisation</label>
      <input id="pf-org" value="${esc(profile?.organisation || "")}" placeholder="Ex : Ministère de la Santé — SAMU Cotonou" /></div>
    <div class="field"><label for="pf-mgr">Responsable de flotte</label>
      <input id="pf-mgr" value="${esc(profile?.manager || "")}" placeholder="Ex : Anania" /></div>
    <button class="btn block" id="pf-save">Enregistrer</button>
    <button class="btn ghost block" id="pf-backup" style="margin-top:.6rem">💾 Sauvegarde des données</button>
  `);
  qs("#pf-backup", overlay).addEventListener("click", () => { overlay.remove(); FleetBackup.openPanel(); });
  qs("#pf-save", overlay).addEventListener("click", async () => {
    const org = qs("#pf-org", overlay).value.trim();
    const mgr = qs("#pf-mgr", overlay).value.trim();
    await Data.saveProfile(org, mgr);
    overlay.remove();
    render();
  });
}

/* ---------- Écrans ---------- */

let dashFilter = "all";

async function renderDashboard(root) {
  const [vehicles, maintenances, issues, profile, allDocs] = await Promise.all([
    Data.getVehicles(), Data.getAllMaintenances(), Data.getAllIssues(), Data.getProfile(), Data.getAllDocuments(),
  ]);
  const liveIds = new Set(vehicles.map((v) => v.id));
  const docs = allDocs.filter((d) => liveIds.has(d.vehicleId));

  const present = CATEGORIES.filter((c) => vehicles.some((v) => categoryOf(v).key === c.key));
  if (dashFilter !== "all" && !present.some((c) => c.key === dashFilter)) dashFilter = "all";
  const chipsHTML = present.length < 2 ? "" : `<div class="chip-row" role="tablist">
      <button class="chip ${dashFilter === "all" ? "active" : ""}" data-filter="all">Tous (${vehicles.length})</button>
      ${present.map((c) => `<button class="chip ${dashFilter === c.key ? "active" : ""}" data-filter="${c.key}">${c.icon} ${c.label} (${vehicles.filter((v) => categoryOf(v).key === c.key).length})</button>`).join("")}
    </div>`;

  const rows = vehicles
    .filter((v) => dashFilter === "all" || categoryOf(v).key === dashFilter)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((v) => ({
      vehicle: v,
      score: computeScore(v, maintenances.filter((m) => m.vehicleId === v.id), issues.filter((i) => i.vehicleId === v.id)),
    }));

  const list = vehicles.length === 0
    ? `<div class="empty"><p>Aucun véhicule enregistré</p><p>Ajoutez un premier véhicule pour commencer le suivi.</p></div>`
    : `<ul class="vehicle-list">${rows.map(({ vehicle: v, score: s }) => `
        <li>
          <a class="vehicle-row" href="#/vehicule/${v.id}">
            <span class="vehicle-icon">${VEHICLE_ICONS[v.type] || "⚙️"}</span>
            <span class="vehicle-info">
              <span class="name">${esc(v.brand)} ${esc(v.model)}</span>
              <span class="meta">${[hasCategory(v) ? `${categoryOf(v).icon} ${categoryOf(v).label}` : "⚠️ Catégorie à définir", v.type, v.plate, `${fmtNum(v.mileage)} km`].filter(Boolean).join(" · ")}</span>
              <span class="label">${esc(s.label)}${docRowTag(docs.filter((d) => d.vehicleId === v.id)) ? ` · ${docRowTag(docs.filter((d) => d.vehicleId === v.id))}` : ""}</span>
            </span>
            <span class="badge-score sm level-${s.level}">${s.score}</span>
          </a>
        </li>`).join("")}</ul>`;

  root.innerHTML = `
    <div class="screen">
      ${shellHTML({
        title: "FleetCheck",
        subtitle: profile?.organisation || "Chaque véhicule compte. Chaque mission aussi.",
        action: `<button class="header-action" id="btn-profile" aria-label="Profil">⚙️</button>`,
      })}
      <main class="main">
        ${FleetBackup.bannerHTML(vehicles.length)}
        ${docsAlertHTML(docs)}
        ${chipsHTML}
        ${list}
        <p class="disclaimer">${SCORE_DISCLAIMER}</p>
      </main>
      <div class="bottom-bar"><div class="bottom-bar-inner">
        <a class="btn block" href="#/nouveau">+ Ajouter un véhicule</a>
      </div></div>
    </div>
  `;
  qs("#btn-profile").addEventListener("click", openProfileModal);
  qsa("[data-filter]", root).forEach((b) => b.addEventListener("click", () => { dashFilter = b.dataset.filter; render(); }));
  FleetBackup.bindBanner(root);
}

function renderNewVehicle(root, existing) {
  const editing = !!existing;
  const v = existing || {};
  const selCat = hasCategory(v) ? v.category : (editing ? "" : DEFAULT_CATEGORY);
  root.innerHTML = `
    <div class="screen">
      ${shellHTML({ title: editing ? "Modifier le véhicule" : "Ajouter un véhicule", subtitle: editing ? `${v.brand} ${v.model}` : "Nouvelle fiche", backHref: editing ? `#/vehicule/${v.id}` : "#/" })}
      <main class="main">
        <form class="form-card" id="form-vehicle">
          <div class="field"><label for="v-cat">Catégorie du véhicule <span style="font-weight:400;color:var(--muted)">(détermine les seuils d'entretien)</span></label>
            <select id="v-cat">
              ${selCat === "" ? `<option value="" selected>— À définir —</option>` : ""}
              ${CATEGORIES.map((c) => `<option value="${c.key}" ${c.key === selCat ? "selected" : ""}>${c.icon} ${c.label} — ${c.hint}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label for="v-type">Usage / service</label>
            <select id="v-type">${VEHICLE_TYPES.map((t) => `<option value="${t}" ${t === v.type ? "selected" : ""}>${VEHICLE_ICONS[t]} ${t}</option>`).join("")}</select>
          </div>
          <div class="grid-2">
            <div class="field"><label for="v-brand">Marque</label><input id="v-brand" required value="${esc(v.brand || "")}" /></div>
            <div class="field"><label for="v-model">Modèle</label><input id="v-model" required value="${esc(v.model || "")}" /></div>
            <div class="field"><label for="v-year">Année</label><input id="v-year" inputmode="numeric" placeholder="2020" value="${editing ? esc(v.year || "") : ""}" /></div>
            <div class="field"><label for="v-plate">Immatriculation</label><input id="v-plate" placeholder="AB 1234 RB" value="${esc(v.plate || "")}" /></div>
          </div>
          <div class="field"><label for="v-mileage">Kilométrage (km)</label><input id="v-mileage" inputmode="numeric" placeholder="120000" value="${editing ? esc(v.mileage ?? "") : ""}" /></div>
          <button type="submit" class="btn block">${editing ? "Enregistrer les modifications" : "Enregistrer"}</button>
        </form>
      </main>
    </div>
  `;
  if (!editing) {
    qs("#v-type").addEventListener("change", () => {
      const k = USAGE_DEFAULT_CATEGORY[qs("#v-type").value];
      if (k) qs("#v-cat").value = k;
    });
  }
  qs("#form-vehicle").addEventListener("submit", async (e) => {
    e.preventDefault();
    const brand = qs("#v-brand").value.trim();
    const model = qs("#v-model").value.trim();
    const category = qs("#v-cat").value;
    if (!category) { toast("Choisissez une catégorie", true); return; }
    if (!brand || !model) { toast("Marque et modèle sont obligatoires", true); return; }
    const mileage = Number(qs("#v-mileage").value) || 0;
    const common = {
      type: qs("#v-type").value, category, brand, model,
      year: Number(qs("#v-year").value) || v.year || new Date().getFullYear(),
      plate: qs("#v-plate").value.trim().toUpperCase(),
      mileage,
    };
    if (editing) {
      const updated = { ...v, ...common };
      if (mileage < (v.initialMileage ?? mileage)) updated.initialMileage = mileage;
      let note = "Modifications enregistrées";
      if (updated.category !== v.category && v.intervals) {
        delete updated.intervals; // les seuils personnalisés correspondaient à l'ancienne catégorie
        note = "Enregistré — seuils personnalisés réinitialisés (nouvelle catégorie)";
      }
      await Data.updateVehicle(updated);
      toast(note);
      location.hash = `#/vehicule/${v.id}`;
      return;
    }
    const id = await Data.addVehicle({ ...common, initialMileage: mileage, createdAt: new Date().toISOString() });
    toast("Véhicule enregistré");
    location.hash = `#/vehicule/${id}`;
  });
}

function garageBoxHTML(vehicleId, garage, hasCritical, editing) {
  if (garage && !editing) {
    const tel = "tel:" + garage.phone.replace(/[^\d+]/g, "");
    const wa = "https://wa.me/" + garage.phone.replace(/\D/g, "");
    return `
      <div class="garage-box${hasCritical ? " alert" : ""}">
        ${hasCritical ? `<p class="alert-line">⚠️ Anomalie critique en cours — contactez le garage</p>` : ""}
        <p class="name">🔧 ${esc(garage.name)}</p>
        <p class="phone">${esc(garage.phone)}</p>
        <div class="garage-actions">
          <a class="btn" href="${tel}">📞 Appeler</a>
          <a class="btn whatsapp" href="${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>
        </div>
        <button class="photo-remove" style="margin-top:0.6rem" data-action="edit-garage" data-id="${vehicleId}">Modifier le contact</button>
      </div>`;
  }
  return `
    <div class="garage-box${hasCritical ? " alert" : ""}">
      ${hasCritical ? `<p class="alert-line">⚠️ Anomalie critique en cours — enregistrez un garage référent</p>` : ""}
      <p class="name" style="margin-bottom:0.6rem">🔧 Garage / mécanicien référent</p>
      <form id="form-garage" data-id="${vehicleId}">
        <div class="field"><label for="g-name">Nom</label><input id="g-name" value="${esc(garage?.name || "")}" placeholder="Ex : Garage CFAO Akpakpa" /></div>
        <div class="field"><label for="g-phone">Téléphone</label><input id="g-phone" value="${esc(garage?.phone || "")}" placeholder="Ex : 22997000000" inputmode="tel" /></div>
        <button type="submit" class="btn block">Enregistrer le contact</button>
      </form>
    </div>`;
}

/* ---------- Modales de la fiche véhicule ---------- */

async function openResolveModal(issue) {
  const profile = await Data.getProfile();
  const o = openModal(`
    <h3>Marquer comme résolue</h3>
    <p class="desc">${esc(issue.part)} — ${esc(SEVERITY_LABEL[issue.severity])}. L'anomalie reste dans l'historique mais ne pénalise plus le score.</p>
    <div class="field"><label for="rs-by">Résolue par</label><input id="rs-by" value="${esc(profile?.manager || "")}" placeholder="Nom du mécanicien / responsable" /></div>
    <div class="field"><label for="rs-note">Réparation effectuée (facultatif)</label><input id="rs-note" placeholder="Ex : plaquettes remplacées" /></div>
    <button class="btn block" id="rs-ok">Confirmer la résolution</button>
  `);
  qs("#rs-ok", o).addEventListener("click", async () => {
    const by = qs("#rs-by", o).value.trim();
    if (!by) { toast("Indiquez qui a résolu l'anomalie", true); return; }
    await Data.updateIssue({ ...issue, resolved: true, resolvedAt: new Date().toISOString(), resolvedBy: by, resolutionNote: qs("#rs-note", o).value.trim() || undefined });
    o.remove(); toast("Anomalie marquée comme résolue"); render();
  });
}

function openIntervalsModal(vehicle) {
  const cat = categoryOf(vehicle);
  const eff = getIntervals(vehicle);
  const defs = defaultIntervals(cat.key);
  const o = openModal(`
    <h3>Seuils d'entretien</h3>
    <p class="desc">Catégorie <strong>${cat.icon} ${cat.label}</strong>. Valeurs de départ <strong>indicatives</strong>, à valider avec un mécanicien ou le carnet du constructeur. L'échéance est atteinte au premier des deux critères (km ou mois).</p>
    ${ITEM_ORDER.map((l) => `
      <div class="grid-2">
        <div class="field"><label for="iv-km-${l}">${l} — tous les (km)</label><input id="iv-km-${l}" inputmode="numeric" value="${eff[l].km}" /></div>
        <div class="field"><label for="iv-mo-${l}">${l} — ou (mois)</label><input id="iv-mo-${l}" inputmode="numeric" value="${eff[l].months}" /></div>
      </div>`).join("")}
    <button class="btn block" id="iv-save">Enregistrer les seuils</button>
    <button class="btn ghost block" id="iv-reset" style="margin-top:.6rem">Rétablir les valeurs par défaut</button>
  `);
  qs("#iv-save", o).addEventListener("click", async () => {
    const overrides = {};
    for (const l of ITEM_ORDER) {
      const km = Number(qs(`#iv-km-${l}`, o).value);
      const months = Number(qs(`#iv-mo-${l}`, o).value);
      if (!(km >= 100) || !(months >= 1) || !Number.isFinite(km) || !Number.isFinite(months)) {
        toast(`${l} : km ≥ 100 et mois ≥ 1 requis`, true); return;
      }
      const diff = {};
      if (km !== defs[l].km) diff.km = Math.round(km);
      if (months !== defs[l].months) diff.months = Math.round(months);
      if (Object.keys(diff).length) overrides[l] = diff;
    }
    const updated = { ...vehicle };
    if (Object.keys(overrides).length) updated.intervals = overrides; else delete updated.intervals;
    await Data.updateVehicle(updated);
    o.remove(); toast("Seuils enregistrés"); render();
  });
  qs("#iv-reset", o).addEventListener("click", async () => {
    const updated = { ...vehicle }; delete updated.intervals;
    await Data.updateVehicle(updated);
    o.remove(); toast("Seuils par défaut rétablis"); render();
  });
}

function openDeleteModal(vehicle, nMaint, nIssues) {
  const o = openModal(`
    <h3>Supprimer ce véhicule ?</h3>
    <p class="desc" style="color:var(--bad)"><strong>${esc(vehicle.brand)} ${esc(vehicle.model)}</strong> sera supprimé définitivement avec ses <strong>${nMaint} entretien(s)</strong>, ses <strong>${nIssues} anomalie(s)</strong> (photos comprises) et son contact garage. Cette action est irréversible : pensez à enregistrer une sauvegarde avant (⚙️ → Sauvegarde des données).</p>
    <button class="btn destructive block" id="dl-ok">Supprimer définitivement</button>
    <button class="btn ghost block" id="dl-cancel" style="margin-top:.6rem">Annuler</button>
  `);
  qs("#dl-cancel", o).addEventListener("click", () => o.remove());
  qs("#dl-ok", o).addEventListener("click", async () => {
    try {
      await Data.deleteVehicle(vehicle.id);
      o.remove(); toast("Véhicule supprimé"); location.hash = "#/";
    } catch (err) { toast("Suppression impossible : " + err.message, true); }
  });
}

const garageEditing = new Set();

async function renderVehicleDetail(root, id) {
  const [vehicle, maintenances, issues, garage, documents, inspections] = await Promise.all([
    Data.getVehicle(id), Data.getMaintenances(id), Data.getIssues(id), Data.getGarage(id), Data.getDocuments(id), Data.getInspections(id),
  ]);

  if (!vehicle) {
    root.innerHTML = `
      <div class="screen">
        ${shellHTML({ title: "Véhicule introuvable", backHref: "#/" })}
        <main class="main"><p>Ce véhicule n'existe plus.</p></main>
      </div>`;
    return;
  }

  const s = computeScore(vehicle, maintenances, issues);
  const sortedM = [...maintenances].sort((a, b) => (a.date < b.date ? 1 : -1));
  const sortedI = [...issues].sort((a, b) => (!!a.resolved !== !!b.resolved ? (a.resolved ? 1 : -1) : (a.date < b.date ? 1 : -1)));
  const cat = categoryOf(vehicle);
  const hasCritical = issues.some((i) => !i.resolved && i.severity === "critique");

  const itemsHTML = s.items.map((item) => `
    <div class="item-card">
      <div class="row"><span class="dot ${item.status}"></span><span>${item.label}</span></div>
      <p>${describeItem(item).kmText}</p>
      <p>${describeItem(item).timeText}</p>
      <p>${item.lastDate ? `Dernier : ${fmtDate(item.lastDate)}` : "Jamais renseigné (calculé depuis l'ajout du véhicule)"}</p>
      <p>Seuil : ${fmtNum(item.interval.km)} km / ${item.interval.months} mois</p>
    </div>`).join("");

  const maintHTML = sortedM.length === 0
    ? `<p style="color:var(--muted);font-size:0.9rem">Aucun entretien enregistré.</p>`
    : `<ul class="history-list">${sortedM.map((m) => `
        <li class="history-item">
          <div class="top"><span class="title">${m.type}</span><span class="date">${fmtDate(m.date)}</span></div>
          <p class="meta">${fmtNum(m.mileage)} km · ${fmtNum(m.cost)} FCFA</p>
          ${m.note ? `<p class="note">${esc(m.note)}</p>` : ""}
          ${m.responsible ? `<p class="responsible">Par ${esc(m.responsible)}</p>` : ""}
        </li>`).join("")}</ul>`;

  const issuesHTML = sortedI.length === 0
    ? `<p style="color:var(--muted);font-size:0.9rem">Aucune anomalie signalée.</p>`
    : `<ul class="history-list">${sortedI.map((i) => `
        <li class="history-item ${i.resolved ? "resolved" : ""}">
          <div class="top"><span class="title">${i.part}</span>${i.resolved ? `<span class="resolved-badge">✅ Résolue</span>` : `<span class="severity-badge ${i.severity}">${SEVERITY_LABEL[i.severity]}</span>`}</div>
          <p class="meta">${fmtDate(i.date)}</p>
          ${i.description ? `<p class="note">${esc(i.description)}</p>` : ""}
          ${i.responsible ? `<p class="responsible">Par ${esc(i.responsible)}</p>` : ""}
          ${i.photo ? `<img class="thumb" src="${i.photo}" data-action="zoom" alt="Photo de l'anomalie" />` : ""}
          ${i.resolved
            ? `<p class="responsible">Résolue le ${fmtDate(i.resolvedAt)}${i.resolvedBy ? ` par ${esc(i.resolvedBy)}` : ""}${i.resolutionNote ? ` — ${esc(i.resolutionNote)}` : ""}</p>`
            : `<button class="btn secondary small" data-action="resolve" data-id="${i.id}" style="margin-top:.6rem">✅ Marquer comme résolue</button>`}
        </li>`).join("")}</ul>`;

  root.innerHTML = `
    <div class="screen">
      ${shellHTML({ title: `${esc(vehicle.brand)} ${esc(vehicle.model)}`, subtitle: `${cat.label} · ${vehicle.type} · ${vehicle.plate || "sans plaque"}`, backHref: "#/" })}
      <main class="main">
        ${hasCategory(vehicle) ? "" : `<a class="notice" href="#/modifier/${id}">⚠️ <span><strong>Catégorie non définie.</strong> Les seuils « Léger » sont appliqués par défaut. Touchez ici pour choisir la bonne catégorie.</span></a>`}
        <section class="card">
          <div class="vehicle-head">
            <div>
              <h2>${VEHICLE_ICONS[vehicle.type] || ""} ${esc(vehicle.brand)} ${esc(vehicle.model)}</h2>
              <p class="sub">${vehicle.year} · ${fmtNum(vehicle.mileage)} km</p>
              <p class="sub">${cat.icon} ${cat.label}${hasCategory(vehicle) ? "" : " (par défaut)"} · ${vehicle.type}</p>
              <p class="status-label">${s.label}</p>
            </div>
            <span class="badge-score lg level-${s.level}">${s.score}</span>
          </div>
          <dl class="dl">
            <div class="dl-row"><dt>Maintenance</dt><dd>${s.maintenanceState}</dd></div>
            <div class="dl-row"><dt>Prochaine échéance</dt><dd>${s.nextDueLabel}</dd></div>
          </dl>
        </section>

        <section class="item-grid">${itemsHTML}</section>

        <div class="action-row">
          <a class="btn ghost" href="#/modifier/${id}">✏️ Modifier</a>
          <button class="btn ghost" data-action="intervals">⚙️ Seuils</button>
        </div>
        <div class="mission-btn-wrap">
          <a class="btn block" href="#/inspection/${id}" style="margin-bottom:.6rem">🔍 Inspection avant départ</a>
          <a class="btn secondary block" href="#/mission/${id}">📄 Générer une déclaration de mission</a>
        </div>

        ${inspectionsSectionHTML(inspections)}

        ${docsSectionHTML(documents)}

        <h3 class="section-title">Historique des entretiens</h3>
        ${maintHTML}

        <h3 class="section-title">Anomalies signalées</h3>
        ${issuesHTML}

        <h3 class="section-title">Garage / mécanicien</h3>
        ${garageBoxHTML(id, garage, hasCritical, garageEditing.has(id))}

        <h3 class="section-title">Zone sensible</h3>
        <button class="btn ghost block danger-link" data-action="delete-vehicle">🗑️ Supprimer ce véhicule</button>

        <p class="disclaimer">${SCORE_DISCLAIMER}</p>
      </main>
      <div class="bottom-bar"><div class="bottom-bar-inner cols-2">
        <a class="btn" href="#/entretien/${id}">🔧 Entretien</a>
        <a class="btn destructive" href="#/anomalie/${id}">⚠️ Anomalie</a>
      </div></div>
    </div>
  `;

  qsa('[data-action="zoom"]').forEach((img) => img.addEventListener("click", () => openLightbox(img.src)));
  const editBtn = qs('[data-action="edit-garage"]');
  if (editBtn) editBtn.addEventListener("click", () => { garageEditing.add(id); render(); });
  qsa('[data-action="resolve"]').forEach((b) => b.addEventListener("click", () => {
    const issue = issues.find((x) => x.id === Number(b.dataset.id));
    if (issue) openResolveModal(issue);
  }));
  qs('[data-action="intervals"]').addEventListener("click", () => openIntervalsModal(vehicle));
  bindDocs(vehicle, documents, root);
  qs('[data-action="delete-vehicle"]').addEventListener("click", () => openDeleteModal(vehicle, maintenances.length, issues.length));
  const garageForm = qs("#form-garage");
  if (garageForm) {
    garageForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = qs("#g-name", garageForm).value.trim();
      const phone = qs("#g-phone", garageForm).value.trim();
      if (!name || !phone) { toast("Nom et téléphone sont requis", true); return; }
      await Data.saveGarage(id, name, phone);
      garageEditing.delete(id);
      toast("Contact enregistré");
      render();
    });
  }
}

function renderNewMaintenance(root, vehicleId) {
  const today = new Date().toISOString().slice(0, 10);
  root.innerHTML = `
    <div class="screen">
      ${shellHTML({ title: "Nouvel entretien", subtitle: "Lié au véhicule sélectionné", backHref: "#/" })}
      <main class="main">
        <form class="form-card" id="form-maint">
          <div class="field"><label for="m-type">Type d'entretien</label>
            <select id="m-type">${MAINTENANCE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}</select>
          </div>
          <div class="grid-2">
            <div class="field"><label for="m-date">Date</label><input id="m-date" type="date" value="${today}" /></div>
            <div class="field"><label for="m-km">Kilométrage</label><input id="m-km" inputmode="numeric" /></div>
          </div>
          <div class="field"><label for="m-cost">Coût (FCFA)</label><input id="m-cost" inputmode="numeric" /></div>
          <div class="field"><label for="m-resp">Responsable (mécanicien / chauffeur)</label><input id="m-resp" placeholder="Ex : Jean K." /></div>
          <div class="field"><label for="m-note">Note</label><textarea id="m-note" rows="3"></textarea></div>
          <button type="submit" class="btn block">Enregistrer</button>
        </form>
      </main>
    </div>
  `;
  qs("#form-maint").addEventListener("submit", async (e) => {
    e.preventDefault();
    const km = Number(qs("#m-km").value) || 0;
    await Data.addMaintenance({
      vehicleId, type: qs("#m-type").value, date: qs("#m-date").value || today,
      mileage: km, cost: Number(qs("#m-cost").value) || 0,
      note: qs("#m-note").value.trim() || undefined,
      responsible: qs("#m-resp").value.trim() || undefined,
      createdAt: new Date().toISOString(),
    });
    await Data.updateVehicleMileage(vehicleId, km);
    toast("Entretien enregistré");
    location.hash = `#/vehicule/${vehicleId}`;
  });
}

function renderNewIssue(root, vehicleId) {
  const today = new Date().toISOString().slice(0, 10);
  let severity = "surveiller";
  let photoDataUrl = null;

  root.innerHTML = `
    <div class="screen">
      ${shellHTML({ title: "Signaler une anomalie", subtitle: "Lié au véhicule sélectionné", backHref: "#/" })}
      <main class="main">
        <form class="form-card" id="form-issue">
          <div class="field"><label for="i-part">Élément concerné</label>
            <select id="i-part">${ISSUE_PARTS.map((p) => `<option value="${p}">${p}</option>`).join("")}</select>
          </div>
          <div class="field"><label for="i-date">Date</label><input id="i-date" type="date" value="${today}" /></div>
          <div class="field"><label for="i-desc">Description</label><textarea id="i-desc" rows="4" placeholder="Décrivez le problème constaté"></textarea></div>
          <div class="field"><label for="i-resp">Responsable (mécanicien / chauffeur)</label><input id="i-resp" placeholder="Ex : Jean K." /></div>
          <div class="field">
            <label>Niveau de gravité</label>
            <div class="severity-picker">
              ${SEVERITIES.map((s) => `<button type="button" class="severity-option ${s.value}" data-on="${s.value === severity}" data-sev="${s.value}">${s.label}</button>`).join("")}
            </div>
          </div>
          <div class="field">
            <label>Photo à l'appui (optionnel)</label>
            <div class="photo-input-row">
              <input type="file" id="i-photo" accept="image/*" capture="environment" />
            </div>
            <div id="photo-preview-wrap"></div>
          </div>
          <button type="submit" class="btn block">Enregistrer</button>
        </form>
      </main>
    </div>
  `;

  qsa(".severity-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      severity = btn.dataset.sev;
      qsa(".severity-option").forEach((b) => (b.dataset.on = String(b === btn)));
    });
  });

  qs("#i-photo").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      photoDataUrl = await fileToCompressedDataUrl(file);
      qs("#photo-preview-wrap").innerHTML = `
        <div style="display:flex;align-items:center;gap:0.6rem;margin-top:0.5rem">
          <img class="photo-preview" src="${photoDataUrl}" alt="Aperçu" />
          <button type="button" class="photo-remove" id="photo-remove">Retirer la photo</button>
        </div>`;
      qs("#photo-remove").addEventListener("click", () => {
        photoDataUrl = null;
        qs("#i-photo").value = "";
        qs("#photo-preview-wrap").innerHTML = "";
      });
    } catch {
      toast("Impossible de lire cette photo", true);
    }
  });

  qs("#form-issue").addEventListener("submit", async (e) => {
    e.preventDefault();
    await Data.addIssue({
      vehicleId, part: qs("#i-part").value, description: qs("#i-desc").value.trim(),
      severity, date: qs("#i-date").value || today,
      responsible: qs("#i-resp").value.trim() || undefined,
      photo: photoDataUrl || undefined,
      createdAt: new Date().toISOString(),
    });
    toast("Anomalie enregistrée");
    location.hash = `#/vehicule/${vehicleId}`;
  });
}

async function renderMissionReport(root, vehicleId, respFromQuery) {
  const [vehicle, maintenances, issues, profile, documents, inspections] = await Promise.all([
    Data.getVehicle(vehicleId), Data.getMaintenances(vehicleId), Data.getIssues(vehicleId), Data.getProfile(), Data.getDocuments(vehicleId), Data.getInspections(vehicleId),
  ]);

  if (!vehicle) {
    root.innerHTML = `<div class="screen">${shellHTML({ title: "Véhicule introuvable", backHref: "#/" })}<main class="main"><p>Ce véhicule n'existe plus.</p></main></div>`;
    return;
  }

  if (!respFromQuery) {
    root.innerHTML = `
      <div class="screen">
        ${shellHTML({ title: "Déclaration de mission", subtitle: `${vehicle.brand} ${vehicle.model}`, backHref: `#/vehicule/${vehicleId}` })}
        <main class="main">
          <form class="form-card" id="form-mission-start">
            <p style="margin-top:0;color:var(--muted);font-size:0.9rem">Cette déclaration atteste l'état du véhicule à l'instant présent, avant un départ en mission.</p>
            <div class="field"><label for="ms-resp">Nom du responsable qui signe</label>
              <input id="ms-resp" value="${esc(profile?.manager || "")}" placeholder="Ex : Anania" required /></div>
            <button type="submit" class="btn block">Générer la déclaration</button>
          </form>
        </main>
      </div>`;
    qs("#form-mission-start").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = qs("#ms-resp").value.trim();
      if (!name) { toast("Indiquez le nom du responsable", true); return; }
      location.hash = `#/mission/${vehicleId}?resp=${encodeURIComponent(name)}`;
    });
    return;
  }

  const s = computeScore(vehicle, maintenances, issues);
  const now = new Date();
  const openList = issues.filter((i) => !i.resolved);
  const issuesHTML = openList.length === 0
    ? `<p class="issue-line">Aucune anomalie non résolue.</p>`
    : openList.map((i) => `<p class="issue-line">${i.part} — ${SEVERITY_LABEL[i.severity]} — ${fmtDate(i.date)}${i.responsible ? ` — par ${esc(i.responsible)}` : ""}${i.description ? `<br/><span style="color:var(--muted)">${esc(i.description)}</span>` : ""}</p>`).join("");

  root.innerHTML = `
    <div class="report-page">
      ${shellHTML({ title: "Déclaration de mission", backHref: `#/vehicule/${vehicleId}` })}
      <div class="report-doc">
        <h1>DÉCLARATION DE MISSION</h1>
        <p class="stamp">État du véhicule au ${now.toLocaleString("fr-FR")}${profile?.organisation ? ` · ${esc(profile.organisation)}` : ""}</p>

        <h2>Véhicule</h2>
        <div class="row"><span>Catégorie</span><span>${categoryOf(vehicle).label}${hasCategory(vehicle) ? "" : " (par défaut)"}</span></div>
        <div class="row"><span>Usage / service</span><span>${vehicle.type}</span></div>
        <div class="row"><span>Marque / modèle</span><span>${esc(vehicle.brand)} ${esc(vehicle.model)}</span></div>
        <div class="row"><span>Année</span><span>${vehicle.year}</span></div>
        <div class="row"><span>Immatriculation</span><span>${esc(vehicle.plate) || "—"}</span></div>
        <div class="row"><span>Kilométrage</span><span>${fmtNum(vehicle.mileage)} km</span></div>

        <h2>Score de maintenance</h2>
        <div class="row"><span>Score</span><span>${s.score}/100 — ${s.level.toUpperCase()}</span></div>
        <div class="row"><span>État</span><span>${s.label}</span></div>
        <div class="row"><span>Prochaine échéance</span><span>${s.nextDueLabel}</span></div>

        <h2>Anomalies non résolues</h2>
        ${issuesHTML}

        <h2>Inspection avant départ</h2>
        ${inspectionReportHTML(inspections)}

        <h2>Documents administratifs</h2>
        ${docsReportHTML(documents)}

        <div class="sig">
          <h2>Responsable signataire</h2>
          <p style="margin:0.3rem 0 0">${esc(respFromQuery)}</p>
          <div class="line">Fait le ${now.toLocaleDateString("fr-FR")}</div>
        </div>

        <p class="foot">${SCORE_DISCLAIMER}</p>
      </div>
      <div class="report-actions"><div class="inner">
        <a class="btn secondary" href="#/vehicule/${vehicleId}">Retour</a>
        <button class="btn" id="btn-print">🖨️ Imprimer / Enregistrer en PDF</button>
      </div></div>
    </div>
  `;
  qs("#btn-print").addEventListener("click", () => window.print());
}

/* ---------- Routeur ---------- */

function parseHash() {
  const raw = (location.hash || "#/").slice(1);
  const [path, query] = raw.split("?");
  const segments = path.split("/").filter(Boolean);
  const params = new URLSearchParams(query || "");
  return { segments, params };
}

async function render() {
  const root = document.getElementById("app");
  const { segments, params } = parseHash();

  try {
    if (segments.length === 0) {
      await renderDashboard(root);
    } else if (segments[0] === "nouveau") {
      renderNewVehicle(root);
    } else if (segments[0] === "vehicule" && segments[1]) {
      await renderVehicleDetail(root, Number(segments[1]));
    } else if (segments[0] === "modifier" && segments[1]) {
      const vv = await Data.getVehicle(Number(segments[1]));
      if (!vv) { location.hash = "#/"; return; }
      renderNewVehicle(root, vv);
    } else if (segments[0] === "entretien" && segments[1]) {
      renderNewMaintenance(root, Number(segments[1]));
    } else if (segments[0] === "anomalie" && segments[1]) {
      renderNewIssue(root, Number(segments[1]));
    } else if (segments[0] === "inspection" && segments[1]) {
      await renderInspection(root, Number(segments[1]));
    } else if (segments[0] === "echeances") {
      await renderEcheances(root);
    } else if (segments[0] === "mission" && segments[1]) {
      await renderMissionReport(root, Number(segments[1]), params.get("resp"));
    } else {
      location.hash = "#/";
    }
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="screen"><main class="main"><p>Une erreur est survenue : ${esc(err.message)}</p><a class="btn" href="#/">Retour à l'accueil</a></main></div>`;
  }
  window.scrollTo(0, 0);
}

/* ---------- Démarrage ---------- */

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => {
  openDB().then(render).catch((err) => {
    console.error(err);
    toast("Erreur d'accès au stockage local", true);
  });
});

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
