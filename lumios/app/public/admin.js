/* ============================================================
   LumiOS Admin — users, zones, scenes, schedules.
   Requires an Owner (full) or Manager (no user mgmt) session.
   ============================================================ */
let TOKEN = localStorage.getItem("lumios_token");
let STATE = null;

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
  const res = await fetch(path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
let toastTimer;
function toast(m) { const e = document.getElementById("toast"); e.textContent = m; e.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove("show"), 2600); }

async function boot() {
  if (!TOKEN) return;
  try { STATE = await api("/api/state"); } catch { return; }
  if (!(STATE.perms.manageUsers || STATE.perms.editScenes)) return; // staff/manager gate
  document.getElementById("gate").style.display = "none";
  document.getElementById("main").style.display = "block";
  if (!STATE.perms.manageUsers) {
    document.getElementById("usersCard").style.display = "none";
    document.getElementById("locsCard").style.display = "none";
  }
  renderUsers(); renderLocations(); renderZones(); renderAudioGroups(); renderSceneSelect(); renderSchedEdit(); populateSchedLoc();
}

/* ---- locations ---- */
function renderLocations() {
  if (!STATE.perms.manageUsers) return;
  const t = document.getElementById("locsTbl");
  t.innerHTML = "<tr><th>Location</th><th>Id</th><th></th></tr>" + STATE.locations.map((l) =>
    `<tr><td><b>${l.name}</b></td><td class="muted">${l.id}</td>
      <td>${l.id !== "main" ? `<button class="btn danger" style="width:auto" onclick="delLocation('${l.id}')">Remove</button>` : '<span class="muted">primary</span>'}</td></tr>`).join("");
}
async function addLocation() {
  const id = val("loc_id"), name = val("loc_name");
  try { await api("/api/locations", { method: "POST", body: { id, name } }); toast("✅ Location added");
    STATE = await api("/api/state"); renderLocations(); populateSchedLoc();
    document.getElementById("loc_id").value = ""; document.getElementById("loc_name").value = ""; }
  catch (e) { toast("⚠️ " + e.message); }
}
async function delLocation(id) {
  if (!confirm("Remove location " + id + "? Its devices and state are deleted.")) return;
  try { await api("/api/locations/" + id, { method: "DELETE" }); toast("Removed");
    STATE = await api("/api/state"); renderLocations(); populateSchedLoc(); }
  catch (e) { toast("⚠️ " + e.message); }
}
function populateSchedLoc() {
  const s = document.getElementById("sc_loc");
  if (s) s.innerHTML = STATE.locations.map((l) => `<option value="${l.id}">${l.name}</option>`).join("");
}

/* ---- users ---- */
async function renderUsers() {
  if (!STATE.perms.manageUsers) return;
  const users = await api("/api/users");
  const t = document.getElementById("usersTbl");
  const locTxt = (u) => (u.role === "owner" || u.role === "manager") ? "all" : ((u.locations || []).join(", ") || "main");
  t.innerHTML = "<tr><th>User</th><th>Role</th><th>Zones</th><th>Locations</th><th></th></tr>" + users.map((u) =>
    `<tr><td><b>${u.name}</b><br><span class="muted">${u.username}</span></td>
      <td>${u.role}</td><td class="muted">${(u.zones || []).join(", ") || "—"}</td>
      <td class="muted">${locTxt(u)}</td>
      <td>${u.username !== STATE.me.username ? `<button class="btn danger" style="width:auto" onclick="delUser('${u.username}')">Remove</button>` : '<span class="muted">you</span>'}</td></tr>`).join("");
}
async function addUser() {
  const body = {
    username: val("u_username"), name: val("u_name"), role: val("u_role"),
    zones: val("u_zones").split(",").map((s) => s.trim()).filter(Boolean),
    locations: val("u_locs").split(",").map((s) => s.trim()).filter(Boolean),
    password: val("u_pw"), pin: val("u_pin"),
  };
  try { await api("/api/users", { method: "POST", body }); toast("✅ User added"); ["u_username","u_name","u_zones","u_locs","u_pw","u_pin"].forEach((id)=>document.getElementById(id).value=""); renderUsers(); }
  catch (e) { toast("⚠️ " + e.message); }
}
async function delUser(un) {
  if (!confirm("Remove user " + un + "?")) return;
  try { await api("/api/users/" + un, { method: "DELETE" }); toast("Removed"); renderUsers(); }
  catch (e) { toast("⚠️ " + e.message); }
}

/* ---- zones ---- */
function renderZones() {
  const t = document.getElementById("zonesTbl");
  t.innerHTML = "<tr><th>Zone</th><th>Id</th><th>Treatment room</th><th>Has shade</th><th></th></tr>" +
    Object.entries(STATE.zones).map(([id, z]) =>
    `<tr><td>${z.emoji} <b>${z.name}</b></td><td class="muted">${id}</td>
      <td><input type="checkbox" ${z.treatment ? "checked" : ""} data-zt="${id}"></td>
      <td><input type="checkbox" ${z.hasShade !== false ? "checked" : ""} data-zs="${id}"></td>
      <td><button class="btn btn-primary" style="padding:6px 12px;width:auto" onclick="saveZone('${id}')">Save</button></td></tr>`).join("");
}
async function saveZone(id) {
  const treatment = document.querySelector(`[data-zt="${id}"]`).checked;
  const hasShade = document.querySelector(`[data-zs="${id}"]`).checked;
  try { await api("/api/layout/zone", { method: "PUT", body: { id, treatment, hasShade } });
    toast("✅ Zone updated"); STATE = await api("/api/state"); renderZones(); }
  catch (e) { toast("⚠️ " + e.message); }
}
async function addZone() {
  const body = { id: val("z_id"), name: val("z_name"), emoji: val("z_emoji") || "✨" };
  try { await api("/api/layout/zone", { method: "POST", body }); toast("✅ Zone added"); STATE = await api("/api/state"); renderZones(); }
  catch (e) { toast("⚠️ " + e.message); }
}

/* ---- sound zones ---- */
let AG = [];
function renderAudioGroups() {
  AG = JSON.parse(JSON.stringify(STATE.audioGroups || []));
  const wrap = document.getElementById("audioEdit");
  wrap.innerHTML = AG.map((g, i) => `
    <div class="sched-edit">
      <input value="${g.name}" data-agn="${i}" style="max-width:160px">
      <input value="${(g.zones || []).join(", ")}" data-agz="${i}" style="flex:1;min-width:160px" placeholder="room ids">
      <button class="btn danger" style="width:auto" onclick="delAudioGroup(${i})">✕</button>
    </div>`).join("") || '<div class="muted" style="padding:6px 0">No sound zones yet.</div>';
}
function collectAudio() {
  document.querySelectorAll("[data-agn]").forEach((el) => AG[+el.dataset.agn].name = el.value);
  document.querySelectorAll("[data-agz]").forEach((el) => AG[+el.dataset.agz].zones = el.value.split(",").map((s) => s.trim()).filter(Boolean));
  return AG;
}
function addAudioGroup() {
  collectAudio();
  const name = val("ag_name"); if (!name) return toast("⚠️ Name the group");
  AG.push({ id: "ag_" + Date.now().toString(36), name, zones: val("ag_zones").split(",").map((s) => s.trim()).filter(Boolean) });
  document.getElementById("ag_name").value = ""; document.getElementById("ag_zones").value = "";
  STATE.audioGroups = AG; renderAudioGroups();
}
function delAudioGroup(i) { collectAudio(); AG.splice(i, 1); STATE.audioGroups = AG; renderAudioGroups(); }
async function saveAudioGroups() {
  try { await api("/api/audio/groups", { method: "PUT", body: { groups: collectAudio() } }); toast("✅ Sound zones saved"); STATE = await api("/api/state"); renderAudioGroups(); }
  catch (e) { toast("⚠️ " + e.message); }
}

/* ---- scene builder ---- */
const DEVICES = ["light", "shade", "temp", "music", "door", "camera", "security"];
const DEV_LABEL = { light: "💡 Lights", shade: "🪟 Shades", temp: "🌡️ Temperature", music: "🎵 Music", door: "🚪 Door", camera: "📹 Camera", security: "🛡️ Security" };
let builderKey = null, builderCls = "open", builderActions = [];

function renderSceneSelect() {
  const sel = document.getElementById("sceneSel");
  sel.innerHTML = Object.keys(STATE.scenes).map((k) => `<option value="${k}">${STATE.scenes[k].name} (${k})</option>`).join("");
  const ss = document.getElementById("sc_scene");
  ss.innerHTML = Object.keys(STATE.scenes).map((k) => `<option value="${k}">${STATE.scenes[k].name}</option>`).join("");
  loadScene();
}

function loadScene() {
  const k = document.getElementById("sceneSel").value;
  const sc = STATE.scenes[k]; if (!sc) return;
  builderKey = k; builderCls = sc.cls || "open";
  document.getElementById("sc_name").value = sc.name || k;
  document.getElementById("sc_emoji").value = sc.emoji || "✨";
  document.getElementById("sc_desc").value = sc.desc || "";
  document.getElementById("sc_perroom").checked = !!sc.perRoom;
  builderActions = JSON.parse(JSON.stringify(sc.actions || []));
  renderActions();
}

function defaultAction(device) {
  return ({
    light:    { device: "light",  target: "all", on: true, dim: 80 },
    shade:    { device: "shade",  target: "all", level: 0 },
    temp:     { device: "temp",   target: "all", value: 72 },
    music:    { device: "music",  target: "all", playlist: "Calm Spa", vol: 25 },
    door:     { device: "door",   target: "all", op: "lock" },
    camera:   { device: "camera", target: "all", alert: false, nightMode: true },
    security: { device: "security", mode: "disarmed" },
  })[device];
}

function targetOptions(device, current) {
  let ids;
  if (device === "door") ids = ["all", ...Object.keys(STATE.doors)];
  else if (device === "camera") ids = ["all", ...Object.keys(STATE.cams)];
  else ids = ["all", "{room}", ...Object.keys(STATE.zones)];
  const label = (id) => id === "all" ? "All" : id === "{room}" ? "(picked room)" : (STATE.zones[id]?.name || STATE.doors[id]?.name || STATE.cams[id]?.name || id);
  return ids.map((id) => `<option value="${id}" ${id === current ? "selected" : ""}>${label(id)}</option>`).join("");
}

function paramsHtml(a, i) {
  const num = (field, val, min, max) => `<input type="number" min="${min}" max="${max}" value="${val}" style="max-width:78px" onchange="upd(${i},'${field}',+this.value)">`;
  if (a.device === "door") return `<select onchange="upd(${i},'op',this.value)"><option ${a.op === "lock" ? "selected" : ""}>lock</option><option value="unlock" ${a.op === "unlock" ? "selected" : ""}>unlock</option></select>`;
  if (a.device === "light") return `<label class="muted"><input type="checkbox" ${a.on ? "checked" : ""} onchange="upd(${i},'on',this.checked)"> on</label> ${a.on ? "dim " + num("dim", a.dim ?? 80, 0, 100) + "%" : ""}`;
  if (a.device === "shade") return `open ${num("level", a.level ?? 0, 0, 100)}%`;
  if (a.device === "temp") return `${num("value", a.value ?? 72, 60, 85)}°F`;
  if (a.device === "music") return `<select onchange="upd(${i},'playlist',this.value)">${STATE.playlists.map((p) => `<option ${p === a.playlist ? "selected" : ""}>${p}</option>`).join("")}</select> vol ${num("vol", a.vol ?? 25, 0, 100)}%`;
  if (a.device === "camera") return `<label class="muted"><input type="checkbox" ${a.alert ? "checked" : ""} onchange="upd(${i},'alert',this.checked)"> motion alerts</label> <label class="muted"><input type="checkbox" ${a.nightMode ? "checked" : ""} onchange="upd(${i},'nightMode',this.checked)"> night mode</label>`;
  if (a.device === "security") return `<select onchange="upd(${i},'mode',this.value)">${["disarmed", "home", "away"].map((m) => `<option ${m === a.mode ? "selected" : ""}>${m}</option>`).join("")}</select>`;
  return "";
}

function renderActions() {
  const wrap = document.getElementById("actionList");
  wrap.innerHTML = builderActions.map((a, i) => `
    <div class="action-row">
      <select onchange="setDevice(${i}, this.value)">
        ${DEVICES.map((d) => `<option value="${d}" ${d === a.device ? "selected" : ""}>${DEV_LABEL[d]}</option>`).join("")}
      </select>
      ${a.device === "security" ? '<span class="muted">whole building</span>' : `<select onchange="upd(${i},'target',this.value)">${targetOptions(a.device, a.target)}</select>`}
      <span class="ar-params">${paramsHtml(a, i)}</span>
      <button class="btn danger" style="width:auto;padding:5px 10px" onclick="removeActionRow(${i})">✕</button>
    </div>`).join("") || '<div class="muted" style="padding:6px 0">No steps yet — add one below.</div>';
  updateJson();
}
function upd(i, field, val) { builderActions[i][field] = val; if (field === "on" || field === "device") renderActions(); else updateJson(); }
function setDevice(i, device) { builderActions[i] = defaultAction(device); renderActions(); }
function addActionRow() { builderActions.push(defaultAction("light")); renderActions(); }
function removeActionRow(i) { builderActions.splice(i, 1); renderActions(); }
function updateJson() { const el = document.getElementById("sceneJson"); if (el) el.value = JSON.stringify(collectScene(), null, 2); }

function collectScene() {
  const sc = { name: val("sc_name") || builderKey, emoji: val("sc_emoji") || "✨", cls: builderCls, desc: val("sc_desc"), actions: builderActions };
  if (document.getElementById("sc_perroom").checked) { sc.perRoom = true; sc.defaultRoom = "room1"; }
  return sc;
}
async function saveSceneBuilt() {
  if (!builderKey) return toast("⚠️ Pick or create a scene first");
  try { await api("/api/scenes/" + builderKey, { method: "PUT", body: collectScene() });
    toast("✅ Scene saved"); STATE = await api("/api/state"); renderSceneSelect();
    document.getElementById("sceneSel").value = builderKey; loadScene(); }
  catch (e) { toast("⚠️ " + e.message); }
}
async function newScene() {
  const name = prompt("New scene name (e.g. Lunch Break):"); if (!name) return;
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || ("scene_" + Date.now().toString(36));
  builderKey = key; builderCls = "open"; builderActions = [defaultAction("light")];
  try { await api("/api/scenes/" + key, { method: "PUT", body: { name, emoji: "✨", cls: "open", desc: "", actions: builderActions } });
    toast("✅ Scene created"); STATE = await api("/api/state"); renderSceneSelect();
    document.getElementById("sceneSel").value = key; loadScene(); }
  catch (e) { toast("⚠️ " + e.message); }
}
async function deleteScene() {
  if (!builderKey) return;
  if (["open", "close", "away", "treat"].includes(builderKey)) return toast("⚠️ The core scenes can't be deleted (edit them instead).");
  if (!confirm(`Delete scene "${builderKey}"?`)) return;
  try { await api("/api/scenes/" + builderKey, { method: "DELETE" }); toast("Deleted"); STATE = await api("/api/state"); renderSceneSelect(); }
  catch (e) { toast("⚠️ " + e.message); }
}

/* ---- schedules ---- */
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
function renderSchedEdit() {
  const wrap = document.getElementById("schedEdit");
  const a = STATE.automation;
  wrap.innerHTML = a.schedules.map((s, i) => `
    <div class="sched-edit">
      <input type="time" value="${s.time}" data-si="${i}" data-f="time" style="max-width:118px">
      <span class="muted" style="min-width:90px">${STATE.scenes[s.scene]?.name || s.scene}</span>
      ${STATE.locations.length > 1 ? `<span class="muted" style="font-size:12px">📍${(STATE.locations.find((l) => l.id === (s.location || "main")) || {}).name || s.location || "main"}</span>` : ""}
      <input value="${s.label || ""}" data-si="${i}" data-f="label" style="flex:1;min-width:120px">
      <span class="day-chips">${[0,1,2,3,4,5,6].map((d) => `<label class="day ${(s.days || []).includes(d) ? "on" : ""}"><input type="checkbox" ${(s.days || []).includes(d) ? "checked" : ""} data-sd="${i}" data-day="${d}">${DAYS[d]}</label>`).join("")}</span>
      <label class="muted"><input type="checkbox" ${s.enabled ? "checked" : ""} data-si="${i}" data-f="enabled"> on</label>
      <button class="btn danger" style="width:auto;padding:5px 10px" onclick="delSched(${i})">✕</button>
    </div>`).join("") +
    a.triggers.map((t, i) => `<div class="sched-edit"><span class="when" style="color:var(--plum);font-weight:600">Trigger</span>
      <span class="muted" style="flex:1">${t.label}</span>
      <label class="muted"><input type="checkbox" ${t.enabled ? "checked" : ""} data-ti="${i}" data-f="enabled"> on</label></div>`).join("");
}
function collectAuto() {
  const a = JSON.parse(JSON.stringify(STATE.automation));
  document.querySelectorAll("[data-si]").forEach((el) => {
    const i = +el.dataset.si, f = el.dataset.f;
    a.schedules[i][f] = f === "enabled" ? el.checked : el.value;
  });
  a.schedules.forEach((s) => { s.days = []; });
  document.querySelectorAll("[data-sd]").forEach((el) => { if (el.checked) a.schedules[+el.dataset.sd].days.push(+el.dataset.day); });
  document.querySelectorAll("[data-ti]").forEach((el) => {
    const i = +el.dataset.ti; a.triggers[i][el.dataset.f] = el.checked;
  });
  return a;
}
async function addSchedule() {
  const a = collectAuto();
  a.schedules.push({ id: "sch_" + Date.now().toString(36), time: val("sc_time"), scene: val("sc_scene"),
    label: val("sc_label") || STATE.scenes[val("sc_scene")].name, enabled: true, days: [0,1,2,3,4,5,6],
    location: val("sc_loc") || "main" });
  STATE.automation = a; renderSchedEdit();
}
function delSched(i) { const a = collectAuto(); a.schedules.splice(i, 1); STATE.automation = a; renderSchedEdit(); }
async function saveAutomation() {
  try { await api("/api/automation", { method: "PUT", body: collectAuto() }); toast("✅ Schedules saved"); STATE = await api("/api/state"); renderSchedEdit(); }
  catch (e) { toast("⚠️ " + e.message); }
}

function val(id) { return document.getElementById(id).value.trim(); }
boot();
