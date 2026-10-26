"use strict";

/* =========================================================================
   FleetCheck — Lot 2 : documents administratifs et échéances

   Chaque véhicule peut porter des documents (assurance, visite technique,
   carte grise, permis du chauffeur…) avec une date d'expiration. FleetCheck
   ne fixe AUCUNE obligation légale : c'est l'utilisateur qui décide quels
   documents suivre. L'app signale ce qui expire (≤ 30 jours) ou a expiré.

   Statut calculé en jours calendaires locaux : un document est encore valable
   le jour de sa date d'expiration.
   ========================================================================= */

const DOC_TYPES = ["Assurance", "Visite technique", "Carte grise", "Permis du chauffeur", "Autorisation de transport", "Autre"];
const DOC_SOON_DAYS = 30;
const DOC_URGENT_DAYS = 7;

function docName(d) {
  return d.type === "Autre" ? (d.label || "Document") : d.type;
}

function _docMidnight(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function documentStatus(doc, now = new Date()) {
  const exp = _docMidnight(doc.expiresAt);
  if (!exp) return { level: "inconnu", days: null, label: "Date invalide" };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((exp.getTime() - today.getTime()) / 86400000);
  const date = exp.toLocaleDateString("fr-FR");
  let level, label;
  if (days < 0) { level = "expire"; label = `Expiré depuis ${fmtDelayDays(days)}`; }
  else if (days === 0) { level = "urgent"; label = "Expire aujourd'hui"; }
  else if (days <= DOC_URGENT_DAYS) { level = "urgent"; label = `Expire dans ${days} j (${date})`; }
  else if (days <= DOC_SOON_DAYS) { level = "bientot"; label = `Expire dans ${days} j (${date})`; }
  else { level = "valide"; label = `Valide jusqu'au ${date}`; }
  return { level, days, label, date };
}

function summarizeDocuments(docs, now = new Date()) {
  const c = { expire: 0, urgent: 0, bientot: 0, valide: 0, inconnu: 0 };
  for (const d of docs) c[documentStatus(d, now).level]++;
  c.problems = c.expire + c.urgent + c.bientot;
  return c;
}

function sortDocsByUrgency(docs, now = new Date()) {
  return [...docs].sort((a, b) => {
    const da = documentStatus(a, now).days, db = documentStatus(b, now).days;
    return (da ?? 1e9) - (db ?? 1e9);
  });
}

/* ---------- Fragments HTML ---------- */

function docChipHTML(st) {
  return `<span class="doc-chip ${st.level}">${esc(st.label)}</span>`;
}

// Petit marqueur pour la liste des véhicules.
function docRowTag(docs) {
  if (!docs.length) return "";
  const c = summarizeDocuments(docs);
  if (c.expire) return "📄 Document expiré";
  if (c.urgent || c.bientot) return "📄 À renouveler";
  return "";
}

// Bandeau du tableau de bord (uniquement s'il y a un problème).
function docsAlertHTML(docs) {
  const c = summarizeDocuments(docs);
  if (!c.problems) return "";
  const parts = [];
  if (c.expire) parts.push(`<strong>${c.expire} expiré${c.expire > 1 ? "s" : ""}</strong>`);
  const soon = c.urgent + c.bientot;
  if (soon) parts.push(`${soon} à renouveler sous ${DOC_SOON_DAYS} j`);
  return `<a class="notice doc-alert ${c.expire ? "expire" : ""}" href="#/echeances"><span>📄</span><span>Documents : ${parts.join(" · ")}. Touchez pour voir les échéances.</span></a>`;
}

function docsSectionHTML(docs, photoIds = new Set()) {
  const list = sortDocsByUrgency(docs);
  const body = list.length === 0
    ? `<p style="color:var(--muted);font-size:0.9rem">Aucun document suivi pour ce véhicule.</p>`
    : `<ul class="history-list">${list.map((d) => {
        const st = documentStatus(d);
        return `<li class="history-item doc-item">
          <button type="button" class="doc-edit" data-action="edit-doc" data-id="${d.id}">
            <div class="top"><span class="title">${esc(docName(d))}${photoIds.has(d.id) ? " 📎" : ""}</span>${docChipHTML(st)}</div>
            ${d.reference ? `<p class="meta">N° ${esc(d.reference)}</p>` : ""}
            ${d.holder ? `<p class="meta">Titulaire : ${esc(d.holder)}</p>` : ""}
          </button>
        </li>`;
      }).join("")}</ul>`;
  return `<h3 class="section-title">Documents administratifs</h3>${body}
    <button type="button" class="btn secondary block" data-action="add-doc" style="margin-top:.7rem">+ Ajouter un document</button>`;
}

function bindDocs(vehicle, docs, root) {
  const add = qs('[data-action="add-doc"]', root);
  if (add) add.addEventListener("click", () => openDocModal(vehicle, null));
  qsa('[data-action="edit-doc"]', root).forEach((b) => b.addEventListener("click", () => {
    const d = docs.find((x) => x.id === Number(b.dataset.id));
    if (d) openDocModal(vehicle, d);
  }));
}

function docsReportHTML(docs) {
  if (!docs.length) return `<p class="issue-line">Aucun document enregistré pour ce véhicule.</p>`;
  const rows = sortDocsByUrgency(docs).map((d) => {
    const st = documentStatus(d);
    return `<div class="row"><span>${esc(docName(d))}${d.reference ? ` (n° ${esc(d.reference)})` : ""}</span><span class="doc-txt ${st.level}">${esc(st.label)}</span></div>`;
  }).join("");
  const c = summarizeDocuments(docs);
  const warn = c.expire ? `<p class="issue-line" style="color:var(--bad)"><strong>⚠️ ${c.expire} document${c.expire > 1 ? "s" : ""} expiré${c.expire > 1 ? "s" : ""} : régularisation nécessaire avant la mission.</strong></p>` : "";
  return rows + warn;
}

/* ---------- Modale d'ajout / modification ---------- */

async function openDocModal(vehicle, doc) {
  const editing = !!doc;
  const d = doc || {};
  let photo = null, photoChanged = false;
  if (editing) {
    try { const r = await Data.getDocPhoto(d.id); photo = r ? r.photo : null; } catch { /* photo illisible : on continue sans */ }
  }
  const o = openModal(`
    <h3>${editing ? "Modifier le document" : "Ajouter un document"}</h3>
    <div class="field"><label for="dc-type">Type de document</label>
      <select id="dc-type">${DOC_TYPES.map((t) => `<option value="${t}" ${t === (d.type || DOC_TYPES[0]) ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    <div class="field" id="dc-label-wrap" ${d.type === "Autre" ? "" : "hidden"}><label for="dc-label">Nom du document</label>
      <input id="dc-label" value="${esc(d.label || "")}" placeholder="Ex : Attestation de transport scolaire" /></div>
    <div class="field"><label for="dc-ref">Numéro / référence (facultatif)</label><input id="dc-ref" value="${esc(d.reference || "")}" /></div>
    <div class="field"><label for="dc-holder">Titulaire / chauffeur (facultatif)</label><input id="dc-holder" value="${esc(d.holder || "")}" placeholder="Utile pour un permis" /></div>
    <div class="field"><label for="dc-exp">Date d'expiration</label><input id="dc-exp" type="date" value="${esc(d.expiresAt || "")}" /></div>
    <div class="field"><label>Photo du document (facultatif)</label>
      <div id="dc-photo-box"></div>
      <input type="file" id="dc-file" accept="image/*" hidden />
      <div class="grid-2" style="margin-top:.4rem">
        <button type="button" class="btn secondary" id="dc-pick">📷 Photographier / choisir</button>
        <button type="button" class="btn ghost" id="dc-unpick" hidden>Retirer la photo</button>
      </div>
    </div>
    <button class="btn block" id="dc-save">${editing ? "Enregistrer" : "Ajouter"}</button>
    ${editing ? `<button class="btn ghost block danger-link" id="dc-del" style="margin-top:.6rem">🗑️ Supprimer ce document</button>` : ""}
  `);
  const sync = () => { qs("#dc-label-wrap", o).hidden = qs("#dc-type", o).value !== "Autre"; };
  qs("#dc-type", o).addEventListener("change", sync);

  const paint = () => {
    const box = qs("#dc-photo-box", o);
    box.innerHTML = photo ? `<img class="doc-thumb" src="${photo}" alt="Photo du document" />` : "";
    const img = qs("img", box);
    if (img) img.addEventListener("click", () => openLightbox(img.src));
    qs("#dc-unpick", o).hidden = !photo;
    qs("#dc-pick", o).textContent = photo ? "📷 Remplacer" : "📷 Photographier / choisir";
  };
  paint();
  qs("#dc-pick", o).addEventListener("click", () => qs("#dc-file", o).click());
  qs("#dc-file", o).addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try { photo = await fileToCompressedDataUrl(f, 1400); photoChanged = true; paint(); }
    catch (err) { toast("Photo illisible : " + err.message, true); }
  });
  qs("#dc-unpick", o).addEventListener("click", () => { photo = null; photoChanged = true; paint(); });

  qs("#dc-save", o).addEventListener("click", async () => {
    const type = qs("#dc-type", o).value;
    const label = qs("#dc-label", o).value.trim();
    const expiresAt = qs("#dc-exp", o).value;
    if (type === "Autre" && !label) { toast("Donnez un nom au document", true); return; }
    if (!_docMidnight(expiresAt)) { toast("Indiquez une date d'expiration valide", true); return; }
    const rec = {
      ...d, vehicleId: vehicle.id, type, expiresAt,
      label: type === "Autre" ? label : undefined,
      reference: qs("#dc-ref", o).value.trim() || undefined,
      holder: qs("#dc-holder", o).value.trim() || undefined,
    };
    if (!editing) rec.createdAt = new Date().toISOString();
    const action = photoChanged ? (photo ? { set: photo } : { remove: true }) : null;
    try {
      await Data.saveDocument(rec, action);
      o.remove(); toast(editing ? "Document modifié" : "Document ajouté"); render();
    } catch (err) { toast("Enregistrement impossible : " + err.message, true); }
  });

  const del = qs("#dc-del", o);
  if (del) del.addEventListener("click", async () => {
    if (del.dataset.confirm !== "1") {
      del.dataset.confirm = "1"; del.textContent = "Confirmer la suppression"; return;
    }
    await Data.deleteDocument(d.id);
    o.remove(); toast("Document supprimé"); render();
  });
}

/* ---------- Écran « Échéances » (toute la flotte) ---------- */

async function renderEcheances(root) {
  const [vehicles, docs] = await Promise.all([Data.getVehicles(), Data.getAllDocuments()]);
  const byId = Object.fromEntries(vehicles.map((v) => [v.id, v]));
  const live = sortDocsByUrgency(docs.filter((d) => byId[d.vehicleId]));
  const problems = live.filter((d) => documentStatus(d).level !== "valide");
  const valid = live.length - problems.length;
  const row = (d) => {
    const v = byId[d.vehicleId];
    const st = documentStatus(d);
    return `<li><a class="history-item doc-item" href="#/vehicule/${v.id}" style="display:block;text-decoration:none;color:inherit">
      <div class="top"><span class="title">${esc(docName(d))}</span>${docChipHTML(st)}</div>
      <p class="meta">${VEHICLE_ICONS[v.type] || ""} ${esc(v.brand)} ${esc(v.model)}${v.plate ? ` · ${esc(v.plate)}` : ""}${d.holder ? ` · ${esc(d.holder)}` : ""}</p>
    </a></li>`;
  };
  root.innerHTML = `
    <div class="screen">
      ${shellHTML({ title: "Échéances", subtitle: "Documents de toute la flotte", backHref: "#/" })}
      <main class="main">
        ${live.length === 0
          ? `<div class="empty"><p>Aucun document suivi</p><p>Ajoutez-en depuis la fiche d'un véhicule.</p></div>`
          : problems.length === 0
            ? `<div class="empty"><p>✅ Tout est à jour</p><p>${valid} document${valid > 1 ? "s" : ""} valide${valid > 1 ? "s" : ""}, aucune échéance sous ${DOC_SOON_DAYS} jours.</p></div>`
            : `<ul class="history-list">${problems.map(row).join("")}</ul>
               ${valid ? `<p class="disclaimer">${valid} autre${valid > 1 ? "s" : ""} document${valid > 1 ? "s" : ""} valide${valid > 1 ? "s" : ""} (échéance au-delà de ${DOC_SOON_DAYS} jours).</p>` : ""}`}
      </main>
    </div>`;
}
