"use strict";

/* =========================================================================
   FleetCheck — Sauvegarde / restauration (indépendant du navigateur)

   Les données vivent dans IndexedDB (stockage du navigateur). Ce module permet
   d'en faire une copie dans un simple fichier .json, conservable n'importe où
   (Téléchargements, Drive, WhatsApp…), et de la restaurer sur n'importe quel
   appareil ou navigateur.

   Il lit/écrit TOUS les magasins de la base « fleetcheck » de façon générique :
   si de nouveaux magasins sont ajoutés plus tard, ils sont sauvegardés sans
   modifier ce fichier. Chargé avant app.js ; utilise toast/openModal/esc/qs
   d'app.js uniquement au moment de l'exécution.
   ========================================================================= */

const FleetBackup = (() => {
  const DB = "fleetcheck";
  const FORMAT = 1;
  const LAST_KEY = "fleetcheck_last_backup";
  const REMIND_AFTER_DAYS = 7;

  /* ---------- Utilitaires IndexedDB ---------- */

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB); // sans version : ouvre la version existante
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const p = (req) => new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  // Les valeurs non sérialisables en JSON (Blob, ArrayBuffer…) seraient perdues en silence.
  // On préfère échouer clairement plutôt que produire une sauvegarde incomplète.
  function assertJsonSafe(value, path) {
    if (value === null || typeof value !== "object") return;
    if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Date) {
      throw new Error(`Type de donnée non pris en charge à ${path}`);
    }
    for (const k of Object.keys(value)) assertJsonSafe(value[k], `${path}.${k}`);
  }

  /* ---------- Export ---------- */

  async function collect() {
    const db = await openDb();
    try {
      const names = Array.from(db.objectStoreNames);
      if (!names.length) return { version: db.version, stores: {} };
      const t = db.transaction(names, "readonly");
      const stores = {};
      for (const n of names) {
        stores[n] = await p(t.objectStore(n).getAll());
        stores[n].forEach((rec, i) => assertJsonSafe(rec, `${n}[${i}]`));
      }
      return { version: db.version, stores };
    } finally {
      db.close();
    }
  }

  function countsOf(stores) {
    const c = {};
    for (const [n, rows] of Object.entries(stores)) c[n] = rows.length;
    return c;
  }

  async function buildBackup() {
    const { version, stores } = await collect();
    return {
      app: "fleetcheck",
      format: FORMAT,
      dbVersion: version,
      exportedAt: new Date().toISOString(),
      counts: countsOf(stores),
      stores,
    };
  }

  function fileName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `FleetCheck-sauvegarde-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  }

  function markBackedUp() {
    try { localStorage.setItem(LAST_KEY, new Date().toISOString()); } catch { /* ignoré */ }
  }
  function lastBackup() {
    try { return localStorage.getItem(LAST_KEY); } catch { return null; }
  }

  async function makeFile() {
    const backup = await buildBackup();
    const text = JSON.stringify(backup);
    // Contrôle de relecture : le fichier produit doit être relisible et complet.
    const check = JSON.parse(text);
    for (const n of Object.keys(backup.stores)) {
      if (check.stores[n].length !== backup.stores[n].length) throw new Error("Contrôle d'intégrité échoué");
    }
    return { file: new File([text], fileName(), { type: "application/json" }), backup };
  }

  async function download() {
    const { file, backup } = await makeFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    markBackedUp();
    return backup;
  }

  async function share() {
    const { file, backup } = await makeFile();
    await navigator.share({ files: [file], title: "Sauvegarde FleetCheck" });
    markBackedUp();
    return backup;
  }

  async function canShareFiles() {
    try {
      const f = new File(["{}"], "t.json", { type: "application/json" });
      return !!(navigator.canShare && navigator.canShare({ files: [f] }) && navigator.share);
    } catch { return false; }
  }

  /* ---------- Import ---------- */

  function validate(obj) {
    if (!obj || typeof obj !== "object") throw new Error("Fichier illisible.");
    if (obj.app !== "fleetcheck") throw new Error("Ce fichier n'est pas une sauvegarde FleetCheck.");
    if (obj.format !== FORMAT) throw new Error("Version de sauvegarde non reconnue (format " + obj.format + ").");
    if (!obj.stores || typeof obj.stores !== "object") throw new Error("Sauvegarde vide ou corrompue.");
    for (const [n, rows] of Object.entries(obj.stores)) {
      if (!Array.isArray(rows)) throw new Error(`Magasin « ${n} » corrompu.`);
    }
    return obj;
  }

  async function readFile(file) {
    let text;
    try { text = await file.text(); } catch { throw new Error("Impossible de lire ce fichier."); }
    let obj;
    try { obj = JSON.parse(text); } catch { throw new Error("Ce fichier n'est pas un JSON valide."); }
    return validate(obj);
  }

  // Remplacement atomique : tout est écrit dans UNE transaction ; à la moindre erreur,
  // elle est annulée et les données actuelles restent intactes.
  async function restore(backup) {
    const db = await openDb();
    try {
      const existing = Array.from(db.objectStoreNames);
      const unknown = Object.keys(backup.stores).filter((n) => !existing.includes(n));
      if (unknown.length) throw new Error("Magasins inconnus dans cette version : " + unknown.join(", "));
      const t = db.transaction(existing, "readwrite");
      const done = new Promise((resolve, reject) => {
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error || new Error("Écriture refusée"));
        t.onabort = () => reject(t.error || new Error("Restauration annulée"));
      });
      try {
        for (const n of existing) {
          const store = t.objectStore(n);
          store.clear();
          for (const rec of (backup.stores[n] || [])) store.put(rec);
        }
      } catch (e) {
        try { t.abort(); } catch { /* déjà terminée */ }
        await done.catch(() => {});
        throw e;
      }
      await done;
    } finally {
      db.close();
    }
  }

  /* ---------- Persistance du stockage ---------- */

  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch { /* ignoré */ }
    return false;
  }
  async function isPersisted() {
    try { return !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()); }
    catch { return false; }
  }

  /* ---------- Interface ---------- */

  const fmtWhen = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d) ? null : d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
  };

  function summary(counts) {
    const parts = [];
    if (counts.vehicles != null) parts.push(`${counts.vehicles} véhicule(s)`);
    if (counts.maintenances != null) parts.push(`${counts.maintenances} entretien(s)`);
    if (counts.issues != null) parts.push(`${counts.issues} anomalie(s)`);
    return parts.join(" · ") || "aucune donnée";
  }

  function daysSince(iso) {
    const t = Date.parse(iso || "");
    return isNaN(t) ? Infinity : (Date.now() - t) / 86400000;
  }

  // Bandeau de rappel affiché sur le tableau de bord (uniquement s'il y a des données à protéger).
  function bannerHTML(vehicleCount) {
    if (!vehicleCount) return "";
    const last = lastBackup();
    if (daysSince(last) < REMIND_AFTER_DAYS) return "";
    const msg = last
      ? `Dernière sauvegarde : ${esc(fmtWhen(last))}.`
      : "Aucune sauvegarde faite sur cet appareil.";
    return `<button class="backup-banner" id="btn-backup-banner" type="button">
      <span>💾</span><span><strong>Sauvegardez vos données.</strong> ${msg} Effacer les données de Chrome les supprimerait définitivement.</span>
    </button>`;
  }
  function bindBanner(root) {
    const b = root && root.querySelector("#btn-backup-banner");
    if (b) b.addEventListener("click", openPanel);
  }

  async function openPanel() {
    let counts = {};
    try { counts = (await buildBackup()).counts; } catch (e) { counts = {}; }
    const persisted = await isPersisted();
    const shareOk = await canShareFiles();
    const last = fmtWhen(lastBackup());

    const overlay = openModal(`
      <h3>Sauvegarde des données</h3>
      <p class="desc">Vos données sont stockées dans le navigateur de cet appareil. Effacer les données de Chrome ou désinstaller l'application peut les supprimer définitivement. Enregistrez régulièrement une sauvegarde et gardez le fichier <strong>en dehors du navigateur</strong> (Téléchargements, Drive, WhatsApp).</p>
      <div class="backup-status">
        <div><span>Contenu actuel</span><strong>${esc(summary(counts))}</strong></div>
        <div><span>Dernière sauvegarde</span><strong>${last ? esc(last) : "Jamais"}</strong></div>
        <div><span>Protection anti-purge</span><strong>${persisted ? "Activée" : "Non garantie par le navigateur"}</strong></div>
      </div>
      <button class="btn block" id="bk-save">💾 Enregistrer une sauvegarde</button>
      ${shareOk ? `<button class="btn secondary block" id="bk-share" style="margin-top:.6rem">📤 Partager la sauvegarde</button>` : ""}
      <button class="btn ghost block" id="bk-restore" style="margin-top:.6rem">📥 Restaurer depuis un fichier</button>
      <input type="file" id="bk-file" accept=".json,application/json" hidden />
      <p class="desc" id="bk-msg" style="margin:.8rem 0 0" aria-live="polite"></p>
    `);
    const msg = (t, err) => {
      const el = qs("#bk-msg", overlay);
      el.textContent = t;
      el.style.color = err ? "var(--bad)" : "var(--good)";
    };

    qs("#bk-save", overlay).addEventListener("click", async () => {
      try {
        const b = await download();
        msg(`Sauvegarde enregistrée (${summary(b.counts)}). Cherchez-la dans vos Téléchargements.`);
      } catch (e) { msg("Échec de la sauvegarde : " + e.message, true); }
    });

    const shareBtn = qs("#bk-share", overlay);
    if (shareBtn) shareBtn.addEventListener("click", async () => {
      try {
        const b = await share();
        msg(`Sauvegarde partagée (${summary(b.counts)}).`);
      } catch (e) {
        if (e && e.name === "AbortError") return; // l'utilisateur a fermé le panneau de partage
        msg("Partage impossible : " + e.message + ". Utilisez « Enregistrer ».", true);
      }
    });

    const input = qs("#bk-file", overlay);
    qs("#bk-restore", overlay).addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const f = input.files && input.files[0];
      input.value = "";
      if (!f) return;
      try {
        const backup = await readFile(f);
        confirmRestore(overlay, backup, counts);
      } catch (e) { msg(e.message, true); }
    });
  }

  function confirmRestore(panel, backup, currentCounts) {
    panel.remove();
    const when = fmtWhen(backup.exportedAt) || "date inconnue";
    const cur = Object.values(currentCounts).some((n) => n > 0);
    const o = openModal(`
      <h3>Remplacer les données ?</h3>
      <p class="desc">Sauvegarde du ${esc(when)} : <strong>${esc(summary(backup.counts || countsOf(backup.stores)))}</strong>.</p>
      <p class="desc" style="color:var(--bad)">${cur
        ? `Toutes les données actuelles de cet appareil (${esc(summary(currentCounts))}) seront <strong>remplacées</strong>. Cette action est irréversible : enregistrez d'abord une sauvegarde de l'état actuel si besoin.`
        : "Cet appareil ne contient encore aucune donnée : la sauvegarde sera simplement chargée."}</p>
      <button class="btn destructive block" id="bk-go">Remplacer par cette sauvegarde</button>
      <button class="btn ghost block" id="bk-cancel" style="margin-top:.6rem">Annuler</button>
      <p class="desc" id="bk-msg2" style="margin:.8rem 0 0" aria-live="polite"></p>
    `);
    qs("#bk-cancel", o).addEventListener("click", () => o.remove());
    qs("#bk-go", o).addEventListener("click", async () => {
      const btn = qs("#bk-go", o);
      btn.disabled = true;
      try {
        await restore(backup);
        markBackedUp();
        toast("Données restaurées");
        setTimeout(() => { location.hash = "#/"; location.reload(); }, 400);
      } catch (e) {
        btn.disabled = false;
        const el = qs("#bk-msg2", o);
        el.style.color = "var(--bad)";
        el.textContent = "Restauration annulée, vos données actuelles sont intactes : " + e.message;
      }
    });
  }

  /* ---------- Démarrage ---------- */
  // Demande au navigateur de ne pas purger le stockage automatiquement (sans effet sur
  // un effacement manuel par l'utilisateur).
  window.addEventListener("load", () => { requestPersistence(); });

  return { openPanel, bannerHTML, bindBanner, buildBackup, download, restore, readFile, requestPersistence };
})();
