"use strict";

/* =========================================================================
   FleetCheck — Lot 6 : comptes, rôles et synchronisation (Supabase)
   Hors ligne d'abord : IndexedDB reste la source locale ; la synchro échange
   des enregistrements avec la table « records » (voir supabase-lot6.sql).
   Conflits : règle déterministe, SANS horloge — un enregistrement modifié
   localement depuis la dernière synchro n'est jamais écrasé par le serveur.
   Identifiants : chaque membre reçoit un « slot » ; ses nouveaux ids
   commencent à slot × 1 000 000 000 (pas de collision entre appareils).
   ========================================================================= */

const FleetCloud = (() => {
  const CFG = Object.assign({ url: "", anonKey: "" }, window.FLEET_CLOUD_CONFIG || {}); // ← à renseigner
  const DB = "fleetcheck", KEY = "fleetcheck_cloud", SLOT_BASE = 1e9;
  const STORES = ["vehicles", "maintenances", "issues", "garages", "documents", "fuel", "docphotos", "inspections"];
  const WRITE = { // miroir de fc_can() dans le SQL ; le serveur reste l'autorité
    gestionnaire: STORES, direction: [],
    mecanicien: ["maintenances", "issues"], chauffeur: ["inspections", "issues", "fuel"],
  };
  const ROLES = { gestionnaire: "Gestionnaire", mecanicien: "Mécanicien", chauffeur: "Chauffeur", direction: "Direction" };
  let st = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  let busy = false;
  const save = () => localStorage.setItem(KEY, JSON.stringify(st));
  const configured = () => !!(CFG.url && CFG.anonKey);
  const p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (t) => new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); });
  const openDb = () => p(indexedDB.open(DB));

  function hash(o) { // empreinte stable (clés triées)
    const s = JSON.stringify(o, (k, v) => v && typeof v === "object" && !Array.isArray(v)
      ? Object.keys(v).sort().reduce((a, x) => (a[x] = v[x], a), {}) : v);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ":" + s.length;
  }

  /* ---------- HTTP / authentification ---------- */
  async function api(path, { method = "GET", body, auth = true, headers = {} } = {}) {
    const h = { apikey: CFG.anonKey, "Content-Type": "application/json", ...headers };
    h.Authorization = "Bearer " + (auth ? await accessToken() : CFG.anonKey);
    const r = await fetch(CFG.url + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j = null;
    try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
    if (!r.ok) throw new Error((j && (j.msg || j.message || j.error_description || j.error)) || "Erreur " + r.status);
    return j;
  }
  function setSession(j) {
    st.session = { access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      uid: (j.user && j.user.id) || (st.session && st.session.uid) };
    save();
  }
  async function accessToken() {
    const s = st.session;
    if (!s) throw new Error("Non connecté");
    if (Date.now() / 1000 < s.expires_at - 60) return s.access_token;
    try {
      setSession(await api("/auth/v1/token?grant_type=refresh_token", { method: "POST", auth: false, body: { refresh_token: s.refresh_token } }));
    } catch (e) { throw new Error("Session expirée : reconnectez-vous"); }
    return st.session.access_token;
  }
  async function signUp(email, password) {
    const j = await api("/auth/v1/signup", { method: "POST", auth: false, body: { email, password } });
    if (!j.access_token) return false; // confirmation par e-mail requise
    setSession(j); st.email = email; save(); return true;
  }
  async function signIn(email, password) {
    setSession(await api("/auth/v1/token?grant_type=password", { method: "POST", auth: false, body: { email, password } }));
    st.email = email; save();
    const r = await api(`/rest/v1/members?user_id=eq.${st.session.uid}&select=org_id,role,slot`);
    if (r.length) { await attach(r[0]); }
  }
  async function signOut() { st = {}; save(); }

  /* ---------- Organisation ---------- */
  async function isEmpty() {
    const db = await openDb();
    try {
      for (const s of STORES) if (db.objectStoreNames.contains(s) && await p(db.transaction(s).objectStore(s).count()) > 0) return false;
      return true;
    } finally { db.close(); }
  }
  // Allocation explicite des ids dans la plage du membre : le générateur natif d'IndexedDB
  // saute dans la plage des autres dès qu'on reçoit leurs enregistrements, d'où collisions.
  const origAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (value, key) {
    if (st.org && key === undefined && this.autoIncrement && this.keyPath === "id" && this.transaction.db.name === DB
        && value && typeof value === "object" && value.id === undefined) {
      st.ids = st.ids || {};
      const n = Math.max(st.ids[this.name] || 0, st.slot * SLOT_BASE) + 1;
      st.ids[this.name] = n; save();
      return origAdd.call(this, { ...value, id: n });
    }
    return origAdd.call(this, value, key);
  };
  async function refreshIds(db) { // le compteur repart du plus grand id déjà présent dans ma plage
    st.ids = st.ids || {};
    for (const s of STORES) {
      if (!db.objectStoreNames.contains(s)) continue;
      const os = db.transaction(s).objectStore(s);
      if (!os.autoIncrement) continue;
      const c = await p(os.openKeyCursor(IDBKeyRange.bound(st.slot * SLOT_BASE, (st.slot + 1) * SLOT_BASE, false, true), "prev"));
      if (c) st.ids[s] = Math.max(st.ids[s] || 0, c.key);
    }
    save();
  }
  const LAST = "fleetcheck_cloud_org"; // dernière organisation liée à cet appareil (survit à la déconnexion)
  async function attach(m, fresh) {
    if (!fresh && !(await isEmpty()) && localStorage.getItem(LAST) !== m.org_id)
      throw new Error("Cet appareil contient déjà des données locales d'une autre origine : enregistrez une sauvegarde puis utilisez un appareil/navigateur vide pour rejoindre cette organisation.");
    st.org = m.org_id; st.role = m.role; st.slot = m.slot; st.rev = 0; st.synced = {}; st.ids = {};
    localStorage.setItem(LAST, m.org_id); save();
    const db = await openDb(); try { await refreshIds(db); } finally { db.close(); }
  }
  async function createOrg(name) { await attach((await api("/rest/v1/rpc/create_org", { method: "POST", body: { p_name: name } }))[0], true); }
  async function joinOrg(code) {
    if (!(await isEmpty()) && !localStorage.getItem(LAST)) throw new Error("Cet appareil contient déjà des données locales : utilisez un appareil/navigateur vide pour rejoindre une organisation.");
    await attach((await api("/rest/v1/rpc/join_org", { method: "POST", body: { p_code: code.trim() } }))[0]);
  }
  const createInvite = (role) => api("/rest/v1/rpc/create_invite", { method: "POST", body: { p_org: st.org, p_role: role } });

  /* ---------- Synchronisation ---------- */
  async function sync() {
    if (busy) return { skipped: true };
    if (!st.org) throw new Error("Aucune organisation");
    busy = true;
    const rep = { pulled: 0, pushed: 0, kept: 0, denied: [] };
    const db = await openDb();
    try {
      await refreshIds(db);
      for (;;) { // 1) recevoir
        const rows = await api(`/rest/v1/records?org_id=eq.${st.org}&rev=gt.${st.rev || 0}&order=rev.asc&limit=500&select=store,rid,data,rev,deleted`);
        if (!rows.length) break;
        const names = [...new Set(rows.map((r) => r.store))].filter((s) => db.objectStoreNames.contains(s));
        if (names.length) {
          const t = db.transaction(names, "readwrite");
          for (const r of rows) {
            if (!names.includes(r.store)) continue;
            const os = t.objectStore(r.store), k = r.store + ":" + r.rid, cur = await p(os.get(r.rid)), was = st.synced[k];
            if (cur ? hash(cur) !== (was === undefined ? (r.deleted ? null : hash(r.data)) : was) : was !== undefined) { rep.kept++; continue; } // modifié/supprimé localement : le local gagne
            if (r.deleted) { if (cur) { os.delete(r.rid); rep.pulled++; } delete st.synced[k]; }
            else if (!cur || hash(cur) !== hash(r.data)) { os.put(r.data); rep.pulled++; st.synced[k] = hash(r.data); }
            else st.synced[k] = hash(cur);
          }
          await done(t);
        }
        st.rev = rows[rows.length - 1].rev; save();
        if (rows.length < 500) break;
      }
      for (const s of WRITE[st.role] || []) { // 2) envoyer (magasins autorisés pour ce rôle)
        if (!db.objectStoreNames.contains(s)) continue;
        const os = db.transaction(s).objectStore(s), kp = os.keyPath, recs = await p(os.getAll());
        const rows = [], seen = new Set();
        for (const r of recs) {
          const k = s + ":" + r[kp]; seen.add(k);
          if (st.synced[k] !== hash(r)) rows.push({ org_id: st.org, store: s, rid: r[kp], data: r, deleted: false, _k: k, _h: hash(r) });
        }
        for (const k of Object.keys(st.synced))
          if (k.startsWith(s + ":") && !seen.has(k)) rows.push({ org_id: st.org, store: s, rid: Number(k.slice(s.length + 1)), data: {}, deleted: true, _k: k });
        try {
          for (let i = 0; i < rows.length; i += 200) {
            const part = rows.slice(i, i + 200);
            await api("/rest/v1/records?on_conflict=org_id,store,rid", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
              body: part.map(({ _k, _h, ...row }) => row) });
            part.forEach((r) => { if (r.deleted) delete st.synced[r._k]; else st.synced[r._k] = r._h; });
            rep.pushed += part.length;
          }
        } catch (e) { rep.denied.push(s + " : " + e.message); }
        save();
      }
      st.last = new Date().toISOString(); save();
      return rep;
    } finally { db.close(); busy = false; }
  }

  function refreshScreen(rep) { // ne jamais rafraîchir un formulaire ou une fenêtre ouverts
    const h = location.hash;
    if (rep.pulled && !document.querySelector(".modal-overlay") && typeof render === "function" &&
        (h === "" || h === "#" || h === "#/" || h.startsWith("#/vehicule/") || h === "#/direction")) render();
  }
  async function auto() {
    if (!st.org || !navigator.onLine) return;
    try { refreshScreen(await sync()); } catch (e) { console.warn("Synchro auto :", e.message); }
  }
  window.addEventListener("online", auto);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) auto(); });
  window.addEventListener("load", () => setTimeout(auto, 1500));

  /* ---------- Écran Compte ---------- */
  function openPanel() {
    const when = st.last ? new Date(st.last).toLocaleString("fr-FR") : "jamais";
    let body;
    if (!configured()) body = `<p class="desc">Le cloud n'est pas configuré : renseignez l'URL et la clé « anon » Supabase en haut de <code>cloud.js</code> (voir README).</p>`;
    else if (!st.session) body = `
      <div class="field"><label for="cl-mail">E-mail</label><input id="cl-mail" type="email" autocomplete="username" /></div>
      <div class="field"><label for="cl-pw">Mot de passe (8 caractères min.)</label><input id="cl-pw" type="password" autocomplete="current-password" /></div>
      <button class="btn block" id="cl-in">Connexion</button>
      <button class="btn ghost block" id="cl-up" style="margin-top:.6rem">Créer un compte</button>`;
    else if (!st.org) body = `
      <p class="desc">Connecté : <strong>${esc(st.email || "")}</strong>. Créez l'organisation de votre flotte (vous serez gestionnaire) ou rejoignez-en une avec un code d'invitation.</p>
      <div class="field"><label for="cl-name">Nom de l'organisation</label><input id="cl-name" placeholder="Ex : SAMU Cotonou" /></div>
      <button class="btn block" id="cl-create">Créer l'organisation</button>
      <div class="field" style="margin-top:1rem"><label for="cl-code">Code d'invitation</label><input id="cl-code" autocapitalize="characters" /></div>
      <button class="btn secondary block" id="cl-join">Rejoindre</button>`;
    else body = `
      <div class="backup-status">
        <div><span>Compte</span><strong>${esc(st.email || "")}</strong></div>
        <div><span>Rôle</span><strong>${esc(ROLES[st.role] || st.role)}</strong></div>
        <div><span>Dernière synchronisation</span><strong>${esc(when)}</strong></div>
      </div>
      <button class="btn block" id="cl-sync">🔄 Synchroniser maintenant</button>
      ${st.role === "gestionnaire" ? `
      <div class="field" style="margin-top:1rem"><label for="cl-role">Inviter un membre</label>
        <select id="cl-role"><option value="mecanicien">Mécanicien</option><option value="chauffeur">Chauffeur</option><option value="direction">Direction</option><option value="gestionnaire">Gestionnaire</option></select></div>
      <button class="btn secondary block" id="cl-inv">Créer un code d'invitation (7 jours, usage unique)</button>` : ""}
      <button class="btn ghost block" id="cl-out" style="margin-top:.6rem">Se déconnecter</button>`;
    const ov = openModal(`<h3>☁️ Compte et synchronisation</h3>${body}<p class="desc" id="cl-msg" style="margin:.8rem 0 0" aria-live="polite"></p>`);
    const msg = (t, bad) => { const e = qs("#cl-msg", ov); e.textContent = t; e.style.color = bad ? "var(--bad)" : ""; };
    const run = (id, fn) => { const b = qs(id, ov); if (b) b.addEventListener("click", async () => {
      b.disabled = true;
      try { await fn(); } catch (e) { msg(e.message, true); b.disabled = false; }
    }); };
    const again = () => { ov.remove(); openPanel(); };
    const cred = () => [qs("#cl-mail", ov).value.trim(), qs("#cl-pw", ov).value];
    run("#cl-in", async () => { await signIn(...cred()); again(); });
    run("#cl-up", async () => { const ok = await signUp(...cred()); if (ok) again(); else msg("Compte créé : confirmez votre e-mail puis connectez-vous.");
      qs("#cl-up", ov).disabled = false; });
    run("#cl-create", async () => { await createOrg(qs("#cl-name", ov).value.trim()); again(); });
    run("#cl-join", async () => { await joinOrg(qs("#cl-code", ov).value); again(); });
    run("#cl-sync", async () => {
      msg("Synchronisation…"); const r = await sync(); refreshScreen(r);
      msg(`Reçus : ${r.pulled} · envoyés : ${r.pushed}` + (r.kept ? ` · conservés en local : ${r.kept}` : "") + (r.denied.length ? ` · refusés : ${r.denied.join(" ; ")}` : ""), r.denied.length > 0);
      qs("#cl-sync", ov).disabled = false;
    });
    run("#cl-inv", async () => { msg("Code : " + await createInvite(qs("#cl-role", ov).value)); qs("#cl-inv", ov).disabled = false; });
    run("#cl-out", async () => { await signOut(); again(); });
  }

  return { openPanel, sync, signUp, signIn, createOrg, joinOrg, createInvite, signOut, state: () => st, SLOT_BASE };
})();
