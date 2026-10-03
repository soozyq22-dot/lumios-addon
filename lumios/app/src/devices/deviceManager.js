/* ============================================================
   deviceManager.js — the device-abstraction layer (multi-location)
   ------------------------------------------------------------
   The clean internal API the whole app calls. It holds the live
   building state FOR EACH LOCATION, routes every command through
   the active driver (mock or real), persists, and broadcasts a
   "change" so all connected screens update in real time.

   Every device method takes a locationId as its first argument
   (defaults to "main"), so one server controls one or many spas.

   Public API (locId first):
     getState(locId) · listLocations() · addLocation() · renameLocation() · removeLocation()
     lock/unlock(locId, doorId, ctx)
     setLight(locId, zoneId, on, dim, ctx) · setShade(locId, zoneId, level, ctx)
     setTemp(locId, zoneId, value, ctx) · setMusic(locId, zoneId, playlist, vol, ctx)
     setMusicGroup / setShadeGroup(locId, …, ctx)
     setCamera(locId, camId, opts, ctx) · getCameraFeed(locId, camId)
     setSecurity(locId, mode, ctx) · powerSnapshot(locId) · setGrid(locId, onGrid, ctx) · powerTick()
     updateZone(locId, id, patch, ctx) · raiseMotion(locId, camId, ctx)
   ctx = { who, role } for the audit log (optional).
   ============================================================ */
const CONFIG = require("../../config");
const store = require("../store");
const bus = require("../bus");
const audit = require("../audit");

const driver = CONFIG.DRIVER === "real"
  ? require("./drivers/realDriver")
  : require("./drivers/mockDriver");

/* ---------- load / seed (with migration from single-location) ---------- */
function freshLocation(name) {
  return Object.assign({ name }, JSON.parse(JSON.stringify(CONFIG.DEFAULT_STATE)));
}
function load() {
  const db = store.read("db", null);
  if (db && db.locations) return db;
  // migrate an older single-location state.json if present
  const old = store.read("state", null);
  const main = old
    ? Object.assign({ name: "Lumi Main Spa" }, old)
    : freshLocation("Lumi Main Spa");
  const seeded = { locations: { main } };
  store.write("db", seeded);
  return seeded;
}
let DB = load();
// self-heal: ensure every location has the newer fields (e.g. audioGroups) without a data wipe
(function migrate() {
  let changed = false;
  for (const id in DB.locations) {
    const L = DB.locations[id];
    if (!L.audioGroups) { L.audioGroups = JSON.parse(JSON.stringify(CONFIG.DEFAULT_STATE.audioGroups || [])); changed = true; }
    for (const zid in L.zones) {
      const z = L.zones[zid];
      if (z.cct == null) { z.cct = 3000; changed = true; }
      if (z.hasColor == null) { z.hasColor = !/^bath/.test(zid); changed = true; } // no accent color in bathrooms
      if (z.color == null) { z.color = "#ffffff"; changed = true; }
      if (z.autoLight == null) { z.autoLight = /^(bath|break)/.test(zid); changed = true; } // motion-lighting in utility areas
      if (z.presets == null) {
        z.presets = z.treatment
          ? [{ name: "Facial", dim: 25, cct: 2700, color: z.color }, { name: "Cleanup", dim: 100, cct: 4500, color: "#ffffff" }, { name: "Consult", dim: 60, cct: 3500, color: z.color }]
          : [];
        changed = true;
      }
    }
    // add any cameras defined in config that this location is missing (discreet set)
    for (const cid in CONFIG.DEFAULT_STATE.cams) if (!L.cams[cid]) { L.cams[cid] = JSON.parse(JSON.stringify(CONFIG.DEFAULT_STATE.cams[cid])); changed = true; }
    for (const cid in L.cams) if (L.cams[cid].ai == null) { L.cams[cid].ai = { enabled: true }; changed = true; } // AI detection on by default
    if (!L.aiEvents) { L.aiEvents = []; changed = true; }
    if (!L.equipment) { L.equipment = JSON.parse(JSON.stringify(CONFIG.DEFAULT_STATE.equipment || [])); changed = true; }
    if (!L.sterilization) { L.sterilization = []; changed = true; }
    if (!L.signage) { L.signage = JSON.parse(JSON.stringify(CONFIG.DEFAULT_STATE.signage || [])); changed = true; }
    if (L.security.siren == null) { L.security.siren = false; changed = true; }
    if (!L.safety) { L.safety = JSON.parse(JSON.stringify(CONFIG.DEFAULT_STATE.safety || [])); changed = true; }
    if (!L.shades) { L.shades = JSON.parse(JSON.stringify(CONFIG.DEFAULT_STATE.shades || [])); changed = true; }
    const seed = (k) => { if (!L[k]) { L[k] = JSON.parse(JSON.stringify(CONFIG.DEFAULT_STATE[k])); changed = true; } };
    seed("fridges"); seed("turnover"); seed("checklist"); seed("scents"); seed("diffusers"); seed("display");
    if (L.power.rate == null) { L.power.rate = CONFIG.DEFAULT_STATE.power.rate; changed = true; }
    // add room-level access doors defined in config that this location is missing
    for (const did in CONFIG.DEFAULT_STATE.doors) if (!L.doors[did]) { L.doors[did] = JSON.parse(JSON.stringify(CONFIG.DEFAULT_STATE.doors[did])); changed = true; }
  }
  if (changed) store.write("db", DB);
})();

function persist() { store.write("db", DB); }
function loc(id) { const l = DB.locations[id || "main"]; if (!l) throw new Error("Unknown location"); return l; }
function emitChange(locId, scope) { bus.emit("change", { loc: locId, scope }); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getState(locId = "main") { return loc(locId); }

/* ---------- hub state feedback (real driver only) ----------
   Applies device state READ BACK from the hub (e.g. a light flipped at the wall
   switch or in the HA app) WITHOUT re-issuing commands, so the dashboard reflects
   reality instead of only what LumiOS last sent. No-op with the mock driver. */
function applyExternalState(locId, patch) {
  const L = loc(locId);
  let changed = false;
  const merge = (group) => {
    if (!patch[group]) return;
    for (const id in patch[group]) if (L[group] && L[group][id]) { Object.assign(L[group][id], patch[group][id]); changed = true; }
  };
  merge("zones"); merge("doors"); merge("cams");
  if (changed) { persist(); emitChange(locId, "zones"); emitChange(locId, "doors"); }
  return changed;
}
function startDriverSync() {
  if (typeof driver.startSync !== "function") return; // mock driver has none
  driver.startSync((locId, patch) => applyExternalState(locId || "main", patch), CONFIG.SYNC_INTERVAL_MS);
  console.log("[deviceManager] hub state-sync started (" + CONFIG.SYNC_INTERVAL_MS + "ms)");
}
function hasLocation(id) { return !!DB.locations[id]; }
function listLocations() { return Object.entries(DB.locations).map(([id, l]) => ({ id, name: l.name })); }
function addLocation(id, name) {
  if (!/^[a-z0-9_]{2,16}$/i.test(id || "")) throw new Error("Invalid location id");
  if (DB.locations[id]) throw new Error("Location already exists");
  DB.locations[id] = freshLocation(name || id);
  persist();
  bus.emit("locations", listLocations());
  return { id, name: DB.locations[id].name };
}
function renameLocation(id, name) { loc(id).name = String(name).slice(0, 40); persist(); bus.emit("locations", listLocations()); }
function removeLocation(id) {
  if (id === "main") throw new Error("The main location can't be removed");
  if (!DB.locations[id]) throw new Error("No such location");
  delete DB.locations[id];
  persist();
  bus.emit("locations", listLocations());
}

// Add a new zone to a location.
function addZone(locId, id, meta = {}, ctx = {}) {
  const L = loc(locId);
  if (!/^[a-z0-9_]{2,16}$/i.test(id || "")) throw new Error("Invalid zone id");
  if (L.zones[id]) throw new Error("Zone already exists");
  L.zones[id] = { name: meta.name || id, emoji: meta.emoji || "✨", light: false, dim: 70, temp: 72, music: "off", vol: 20, shade: 100, hasShade: true };
  persist();
  audit.record({ msg: `Zone "${L.zones[id].name}" added`, who: ctx.who, role: ctx.role, category: "config", loc: locId });
  emitChange(locId, "zones");
  return L.zones[id];
}

// Edit a zone's metadata (name, emoji, treatment flag, shade capability).
function updateZone(locId, id, patch, ctx = {}) {
  const z = loc(locId).zones[id];
  if (!z) throw new Error("Unknown zone");
  if (patch.name != null) z.name = String(patch.name).slice(0, 40);
  if (patch.emoji != null) z.emoji = String(patch.emoji).slice(0, 4);
  if (patch.treatment != null) z.treatment = !!patch.treatment;
  if (patch.hasShade != null) z.hasShade = !!patch.hasShade;
  persist();
  audit.record({ msg: `Zone "${z.name}" settings updated`, who: ctx.who, role: ctx.role, category: "config", loc: locId });
  emitChange(locId, "zones");
  return z;
}

/* ---------- doors ---------- */
async function setDoor(locId, doorId, locked, ctx = {}) {
  const d = loc(locId).doors[doorId];
  if (!d) throw new Error("Unknown door");
  await (locked ? driver.lock(doorId) : driver.unlock(doorId));
  d.locked = locked;
  if (d.room && !locked) { d.lastAccessBy = ctx.who || "—"; d.lastAccessTs = Date.now(); } // room access record
  persist();
  audit.record({ msg: `${d.room ? "Room access" : "Door"} — ${d.name}: ${locked ? "LOCKED" : "UNLOCKED"}`, who: ctx.who, role: ctx.role, category: d.room ? "access" : "door", loc: locId });
  emitChange(locId, "doors");
  return d;
}
const lock = (locId, id, ctx) => setDoor(locId, id, true, ctx);
const unlock = (locId, id, ctx) => setDoor(locId, id, false, ctx);

/* ---------- lights ---------- */
async function setLight(locId, zoneId, on, dim, ctx = {}) {
  const z = loc(locId).zones[zoneId];
  if (!z) throw new Error("Unknown zone");
  const level = dim != null ? clamp(+dim, 0, 100) : z.dim;
  await driver.setLight(zoneId, on, level);
  z.light = !!on;
  if (dim != null) z.dim = level;
  persist();
  if (ctx.log !== false)
    audit.record({ msg: `${z.name}: lights ${on ? `on ${z.dim}%` : "off"}`, who: ctx.who, role: ctx.role, category: "light", loc: locId });
  emitChange(locId, "zones");
  return z;
}

/* ---------- tunable white (color temperature) ---------- */
async function setCct(locId, zoneId, value, ctx = {}) {
  const z = loc(locId).zones[zoneId];
  if (!z) throw new Error("Unknown zone");
  const k = clamp(Math.round(+value / 100) * 100, 2200, 6500);
  if (driver.setCct) await driver.setCct(zoneId, k);
  z.cct = k;
  persist();
  if (ctx.log !== false)
    audit.record({ msg: `${z.name}: light tone ${k}K (${k <= 3000 ? "warm" : k >= 4600 ? "cool" : "neutral"})`, who: ctx.who, role: ctx.role, category: "light", loc: locId });
  emitChange(locId, "zones");
  return z;
}

/* ---------- RGB accent color ---------- */
async function setColor(locId, zoneId, hex, ctx = {}) {
  const z = loc(locId).zones[zoneId];
  if (!z) throw new Error("Unknown zone");
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) throw new Error("Invalid color");
  if (driver.setColor) await driver.setColor(zoneId, hex);
  z.color = hex.toLowerCase();
  persist();
  if (ctx.log !== false)
    audit.record({ msg: `${z.name}: accent color ${z.color}`, who: ctx.who, role: ctx.role, category: "light", loc: locId });
  emitChange(locId, "zones");
  return z;
}

/* ---------- motion / auto lighting ---------- */
const AUTO_OFF_MS = 90 * 1000; // lights off after this much no-motion (demo-friendly)
function setAutoLight(locId, zoneId, on, ctx = {}) {
  const z = loc(locId).zones[zoneId];
  if (!z) throw new Error("Unknown zone");
  z.autoLight = !!on;
  persist();
  audit.record({ msg: `${z.name}: motion lighting ${on ? "ON" : "off"}`, who: ctx.who, role: ctx.role, category: "light", loc: locId });
  emitChange(locId, "zones");
  return z;
}
async function motion(locId, zoneId, ctx = {}) {
  const z = loc(locId).zones[zoneId];
  if (!z) throw new Error("Unknown zone");
  z.lastMotionTs = Date.now();
  if (z.autoLight && !z.light) {
    await setLight(locId, zoneId, true, z.dim || 70, { ...ctx, log: false });
    audit.record({ msg: `${z.name}: motion → lights on (auto)`, who: ctx.who || "sensor", role: "system", category: "light", loc: locId });
  }
  return z;
}
// Called each scheduler tick: auto-off rooms that have gone quiet.
function autoLightTick() {
  const now = Date.now();
  let changed = false;
  for (const lid in DB.locations) {
    const L = DB.locations[lid];
    for (const zid in L.zones) {
      const z = L.zones[zid];
      if (z.autoLight && z.light && z.lastMotionTs && now - z.lastMotionTs > AUTO_OFF_MS) {
        z.light = false; z.lastMotionTs = null; changed = true;
        audit.record({ msg: `${z.name}: no motion → lights off (auto)`, who: "sensor", role: "system", category: "light", loc: lid });
        emitChange(lid, "zones");
      }
    }
  }
  if (changed) persist();
}

/* ---------- lighting presets (saved looks per room) ---------- */
async function applyLightPreset(locId, zoneId, name, ctx = {}) {
  const z = loc(locId).zones[zoneId];
  if (!z) throw new Error("Unknown zone");
  const p = (z.presets || []).find((x) => x.name === name);
  if (!p) throw new Error("No such preset");
  await setLight(locId, zoneId, true, p.dim, { ...ctx, log: false });
  if (p.cct != null) await setCct(locId, zoneId, p.cct, { ...ctx, log: false });
  if (p.color && z.hasColor !== false) await setColor(locId, zoneId, p.color, { ...ctx, log: false });
  audit.record({ msg: `${z.name}: light preset "${name}"`, who: ctx.who, role: ctx.role, category: "light", loc: locId });
  emitChange(locId, "zones");
  return z;
}
function saveLightPreset(locId, zoneId, name, ctx = {}) {
  const z = loc(locId).zones[zoneId];
  if (!z) throw new Error("Unknown zone");
  name = String(name || "").trim().slice(0, 20);
  if (!name) throw new Error("Name required");
  z.presets = z.presets || [];
  const snap = { name, dim: z.dim, cct: z.cct, color: z.color };
  const i = z.presets.findIndex((x) => x.name === name);
  if (i >= 0) z.presets[i] = snap; else z.presets.push(snap);
  persist();
  audit.record({ msg: `${z.name}: saved light preset "${name}"`, who: ctx.who, role: ctx.role, category: "config", loc: locId });
  emitChange(locId, "zones");
  return z;
}
function deleteLightPreset(locId, zoneId, name, ctx = {}) {
  const z = loc(locId).zones[zoneId];
  if (!z) throw new Error("Unknown zone");
  z.presets = (z.presets || []).filter((x) => x.name !== name);
  persist();
  emitChange(locId, "zones");
  return z;
}

/* ---------- motorized shades (individual devices) ---------- */
async function setOneShade(locId, shadeId, level, ctx = {}) {
  const s = (loc(locId).shades || []).find((x) => x.id === shadeId);
  if (!s) throw new Error("Unknown shade");
  const lv = clamp(Math.round(+level), 0, 100);
  await driver.setShade(shadeId, lv);
  s.level = lv;
  persist();
  if (ctx.log !== false)
    audit.record({ msg: `Shade "${s.name}" ${lv === 0 ? "closed" : lv === 100 ? "open" : lv + "% open"}`, who: ctx.who, role: ctx.role, category: "shade", loc: locId });
  emitChange(locId, "shades");
  return s;
}
async function setShadeGroup(locId, level, shadeIds, ctx = {}) {
  const L = loc(locId);
  const ids = (shadeIds && shadeIds.length) ? shadeIds : (L.shades || []).map((s) => s.id);
  for (const id of ids) await setOneShade(locId, id, level, { ...ctx, log: false });
  audit.record({ msg: `All shades ${level === 0 ? "closed" : level === 100 ? "opened" : level + "% open"}`, who: ctx.who, role: ctx.role, category: "shade", loc: locId });
  emitChange(locId, "shades");
}

/* ---------- thermostat ---------- */
async function setTemp(locId, zoneId, value, ctx = {}) {
  const z = loc(locId).zones[zoneId];
  if (!z) throw new Error("Unknown zone");
  const t = clamp(Math.round(+value), 60, 85);
  await driver.setTemp(zoneId, t);
  z.temp = t;
  persist();
  if (ctx.log !== false)
    audit.record({ msg: `${z.name}: thermostat ${t}°F`, who: ctx.who, role: ctx.role, category: "temp", loc: locId });
  emitChange(locId, "zones");
  return z;
}

/* ---------- salon-wide thermostat ----------
   Lumi Nails runs one shared HVAC (two Honeywell T6 thermostats that heat/cool
   the whole open space together). This sets a single salon temperature: it moves
   the hardware once (any zone maps to both thermostats in the real driver) and
   mirrors that one value across every room so the UI stays consistent. */
async function setSalonTemp(locId, value, ctx = {}) {
  const L = loc(locId);
  const t = clamp(Math.round(+value), 60, 85);
  const firstZone = Object.keys(L.zones)[0];
  await driver.setTemp(firstZone, t);
  for (const id in L.zones) L.zones[id].temp = t;
  persist();
  if (ctx.log !== false)
    audit.record({ msg: `Salon temperature set to ${t}°F`, who: ctx.who, role: ctx.role, category: "temp", loc: locId });
  emitChange(locId, "zones");
  return { temp: t };
}

/* Whole-salon thermostat mode: "off" | "heat" | "cool" | "heat_cool" (auto).
   Moves both Honeywell T6 units together (any zone maps to both thermostats). */
const HVAC_MODES = ["off", "heat", "cool", "heat_cool"];
const HVAC_LABEL = { off: "Off", heat: "Heat", cool: "Cool", heat_cool: "Auto" };
async function setSalonMode(locId, mode, ctx = {}) {
  const L = loc(locId);
  if (!HVAC_MODES.includes(mode)) throw new Error("Unknown thermostat mode");
  const firstZone = Object.keys(L.zones)[0];
  await driver.setTempMode(firstZone, mode);
  L.hvac = L.hvac || {};
  L.hvac.mode = mode;
  persist();
  if (ctx.log !== false)
    audit.record({ msg: `Thermostat turned ${mode === "off" ? "OFF" : HVAC_LABEL[mode]}`, who: ctx.who, role: ctx.role, category: "temp", loc: locId });
  emitChange(locId, "zones");
  return { mode };
}

/* ---------- music ---------- */
async function setMusic(locId, zoneId, playlist, vol, ctx = {}) {
  const L = loc(locId);
  const z = L.zones[zoneId];
  if (!z) throw new Error("Unknown zone");
  if (playlist != null && !L.playlists.includes(playlist)) throw new Error("Unknown playlist");
  const v = vol != null ? clamp(+vol, 0, 100) : z.vol;
  await driver.setMusic(zoneId, playlist != null ? playlist : z.music, v);
  if (playlist != null) z.music = playlist;
  z.vol = v;
  persist();
  if (ctx.log !== false)
    audit.record({ msg: `${z.name}: ${z.music === "off" ? "music off" : "playing " + z.music}`, who: ctx.who, role: ctx.role, category: "music", loc: locId });
  emitChange(locId, "zones");
  return z;
}
async function setMusicGroup(locId, playlist, vol, zoneIds, ctx = {}) {
  const L = loc(locId);
  const ids = (zoneIds && zoneIds.length) ? zoneIds : Object.keys(L.zones);
  for (const id of ids) await setMusic(locId, id, playlist, vol, { ...ctx, log: false });
  audit.record({
    msg: `Whole-spa audio: ${playlist === "off" ? "stopped everywhere" : `"${playlist}" everywhere${vol != null ? ` @ ${vol}%` : ""}`}`,
    who: ctx.who, role: ctx.role, category: "music", loc: locId,
  });
  emitChange(locId, "zones");
}

/* ---------- smart sound zoning ---------- */
async function setAudioGroup(locId, groupId, playlist, vol, ctx = {}) {
  const L = loc(locId);
  const g = (L.audioGroups || []).find((x) => x.id === groupId);
  if (!g) throw new Error("Unknown sound zone");
  for (const id of g.zones) if (L.zones[id]) await setMusic(locId, id, playlist, vol, { ...ctx, log: false });
  audit.record({
    msg: `Sound zone "${g.name}": ${playlist === "off" ? "stopped" : `playing ${playlist}${vol != null ? ` @ ${vol}%` : ""}`}`,
    who: ctx.who, role: ctx.role, category: "music", loc: locId,
  });
  emitChange(locId, "zones");
  return g;
}
function updateAudioGroups(locId, groups, ctx = {}) {
  const L = loc(locId);
  L.audioGroups = Array.isArray(groups) ? groups : [];
  persist();
  audit.record({ msg: "Sound zones updated", who: ctx.who, role: ctx.role, category: "config", loc: locId });
  emitChange(locId, "zones");
  return L.audioGroups;
}

/* ---------- cameras ---------- */
async function setCamera(locId, camId, opts, ctx = {}) {
  const c = loc(locId).cams[camId];
  if (!c) throw new Error("Unknown camera");
  await driver.setCamera(camId, opts);
  if (opts.alert != null) c.alert = !!opts.alert;
  if (opts.nightMode != null) c.nightMode = !!opts.nightMode;
  persist();
  emitChange(locId, "cams");
  return c;
}
async function getCameraFeed(locId, camId) {
  if (!loc(locId).cams[camId]) throw new Error("Unknown camera");
  return driver.getCameraFeed(camId);
}

/* Live cameras discovered from the hub (Home Assistant). Returns [] on the mock
   driver or if the hub can't be reached, so the UI just shows nothing. */
async function listLiveCameras(locId, opts = {}) {
  if (!driver.listCameras) return [];
  try { return await driver.listCameras(opts); } catch (e) { return []; }
}
async function cameraSnapshot(entityId) {
  if (!driver.cameraSnapshot) throw new Error("Live camera not available");
  return driver.cameraSnapshot(entityId);
}
async function cameraStream(entityId, signal) {
  if (!driver.cameraStream) throw new Error("Live camera stream not available");
  return driver.cameraStream(entityId, signal);
}
async function cameraStreamUrl(entityId, format) {
  if (!driver.getStreamUrl) throw new Error("Live video not available");
  return driver.getStreamUrl(entityId, format);
}
async function hlsGet(haPath) {
  if (!driver.hlsGet) throw new Error("HLS not available");
  return driver.hlsGet(haPath);
}

/* ---------- unified security panel ---------- */
async function setSecurity(locId, mode, ctx = {}) {
  if (!["disarmed", "home", "away"].includes(mode)) throw new Error("Invalid security mode");
  const L = loc(locId);
  await driver.setSecurity(mode);
  L.security.mode = mode;
  L.security.since = new Date().toISOString();
  if (mode === "disarmed") { L.security.alarm = false; L.security.siren = false; if (driver.setSiren) await driver.setSiren(false); }
  const armed = mode !== "disarmed";
  for (const id in L.cams) { L.cams[id].alert = false; L.cams[id].nightMode = armed; }
  persist();
  audit.record({ msg: `Security ${mode === "disarmed" ? "DISARMED" : "ARMED (" + mode + ")"}`, who: ctx.who, role: ctx.role, category: "security", loc: locId });
  emitChange(locId, "security"); emitChange(locId, "cams");
  return L.security;
}

/* ---------- siren / panic ---------- */
async function panic(locId, ctx = {}) {
  const L = loc(locId);
  L.security.alarm = true; L.security.siren = true;
  if (driver.setSiren) await driver.setSiren(true);
  persist();
  audit.record({ msg: "🚨 PANIC alarm triggered — siren ON", who: ctx.who, role: ctx.role, category: "alert", loc: locId });
  bus.emit("alert", { loc: locId, name: "Panic button", locName: L.name, armed: true });
  bus.emit("push", { title: "LumiOS Panic Alarm", body: `Panic alarm triggered at ${L.name}.` });
  emitChange(locId, "security");
  return L.security;
}
async function silence(locId, ctx = {}) {
  const L = loc(locId);
  L.security.siren = false;
  if (driver.setSiren) await driver.setSiren(false);
  persist();
  audit.record({ msg: "Alarm siren silenced", who: ctx.who, role: ctx.role, category: "security", loc: locId });
  emitChange(locId, "security");
  return L.security;
}

/* ---------- life-safety: smoke + CO ---------- */
async function triggerSafety(locId, id, ctx = {}) {
  const L = loc(locId);
  const d = (L.safety || []).find((x) => x.id === id);
  if (!d) throw new Error("Unknown detector");
  d.status = "alarm";
  L.security.siren = true;
  if (driver.setSiren) await driver.setSiren(true);
  // life-safety fail-safe: unlock egress doors for evacuation
  for (const did in L.doors) if (!L.doors[did].room && L.doors[did].locked) {
    L.doors[did].locked = false;
    try { await driver.unlock(did); } catch (e) {}
  }
  persist();
  audit.record({ msg: `🔥 LIFE-SAFETY ALARM — ${d.type} at ${d.name} · egress doors unlocked`, who: ctx.who || "sensor", role: "system", category: "alert", loc: locId });
  bus.emit("alert", { loc: locId, name: `${d.type} — ${d.name}`, locName: L.name, armed: true, safety: true });
  bus.emit("push", { title: "🔥 LumiOS LIFE-SAFETY ALARM", body: `${d.type} alarm at ${d.name} (${L.name}). Egress doors unlocked — evacuate.` });
  emitChange(locId, "safety"); emitChange(locId, "security"); emitChange(locId, "doors");
  return d;
}
function clearSafety(locId, id, ctx = {}) {
  const L = loc(locId);
  const d = (L.safety || []).find((x) => x.id === id);
  if (!d) throw new Error("Unknown detector");
  d.status = "clear";
  if (!(L.safety || []).some((x) => x.status === "alarm")) { L.security.siren = false; if (driver.setSiren) driver.setSiren(false); }
  persist();
  audit.record({ msg: `Life-safety cleared — ${d.name}`, who: ctx.who, role: ctx.role, category: "security", loc: locId });
  emitChange(locId, "safety"); emitChange(locId, "security");
  return d;
}

/* ---------- backup power / energy ---------- */
function estimateWatts(L) {
  const per = {};
  let total = 0;
  for (const id in L.zones) {
    const z = L.zones[id];
    let w = 4;
    if (z.light) w += Math.round(z.dim * 0.6);
    if (z.music && z.music !== "off") w += 8 + Math.round((z.vol || 0) * 0.15);
    w += Math.round(Math.abs((z.temp || 70) - 70) * 12);
    per[id] = w; total += w;
  }
  return { per, total };
}
function powerSnapshot(locId) {
  const L = loc(locId);
  const { per, total } = estimateWatts(L);
  const rate = L.power.rate != null ? L.power.rate : 0.16;
  const costPerHour = (total / 1000) * rate;
  const monthlyEstimate = Math.round(costPerHour * 12 * 30); // ~12 open-hours/day, 30 days
  return { onGrid: L.power.onGrid, battery: L.power.battery, totalW: total, perZoneW: per, rate, costPerHour: +costPerHour.toFixed(2), monthlyEstimate };
}
function setGrid(locId, onGrid, ctx = {}) {
  const L = loc(locId);
  L.power.onGrid = !!onGrid;
  persist();
  audit.record({ msg: onGrid ? "⚡ Grid power restored" : "⚠️ Power outage — running on UPS battery (doors & security online)", who: ctx.who || "sensor", role: "system", category: "alert", loc: locId });
  if (!onGrid) bus.emit("push", { title: "LumiOS Power Alert", body: "Mains power lost — spa is on battery backup. Doors and security remain online." });
  emitChange(locId, "power");
}
// Drain/charge every location's UPS each tick so the energy tile feels live.
function powerTick() {
  let changed = false;
  for (const id in DB.locations) {
    const p = DB.locations[id].power;
    const before = p.battery;
    if (!p.onGrid) p.battery = Math.max(0, p.battery - 3);
    else if (p.battery < 100) p.battery = Math.min(100, p.battery + 6);
    if (p.battery !== before) { changed = true; emitChange(id, "power"); }
  }
  if (changed) persist();
}

/* ---------- exterior signage ---------- */
async function setSignage(locId, id, patch, ctx = {}) {
  const L = loc(locId);
  const s = (L.signage || []).find((x) => x.id === id);
  if (!s) throw new Error("Unknown sign");
  if (patch.on != null) s.on = !!patch.on;
  if (patch.brightness != null) s.brightness = clamp(Math.round(+patch.brightness), 0, 100);
  if (patch.mode != null && (!s.modes || s.modes.includes(patch.mode))) s.mode = patch.mode;
  if (driver.setSign) await driver.setSign(id, s);
  persist();
  if (ctx.log !== false)
    audit.record({ msg: `Signage "${s.name}": ${s.on ? "on" : "off"}${s.mode ? ` · ${s.mode}` : ""}`, who: ctx.who, role: ctx.role, category: "config", loc: locId });
  emitChange(locId, "signage");
  return s;
}

/* ---------- equipment / uptime monitoring ---------- */
function setEquipment(locId, id, online, ctx = {}) {
  const L = loc(locId);
  const d = (L.equipment || []).find((x) => x.id === id);
  if (!d) throw new Error("Unknown device");
  d.online = !!online;
  d.lastSeenTs = Date.now();
  persist();
  audit.record({ msg: `Equipment "${d.name}" ${online ? "back online" : "OFFLINE"}`, who: ctx.who || "monitor", role: "system", category: online ? "info" : "alert", loc: locId });
  if (!online) bus.emit("push", { title: "LumiOS Equipment Alert", body: `${d.name} went offline at ${L.name}.` });
  emitChange(locId, "equipment");
  return d;
}

/* ---------- autoclave sterilization log ---------- */
function addSterilization(locId, entry, ctx = {}) {
  const L = loc(locId);
  L.sterilization = L.sterilization || [];
  const rec = {
    id: "st_" + Date.now().toString(36),
    ts: new Date().toISOString(),
    operator: String(entry.operator || ctx.who || "—").slice(0, 40),
    load: String(entry.load || "").slice(0, 80),
    cycleType: String(entry.cycleType || "").slice(0, 60),
    result: entry.result === "Fail" ? "Fail" : "Pass",
    spore: ["Pass", "Fail", "—"].includes(entry.spore) ? entry.spore : "—",
    notes: String(entry.notes || "").slice(0, 200),
  };
  L.sterilization.unshift(rec);
  L.sterilization = L.sterilization.slice(0, 500);
  persist();
  audit.record({ msg: `Autoclave cycle logged — ${rec.result}${rec.spore !== "—" ? `, spore ${rec.spore}` : ""}`, who: ctx.who, role: ctx.role, category: "config", loc: locId });
  emitChange(locId, "sterilization");
  return rec;
}
function listSterilization(locId) { return loc(locId).sterilization || []; }

/* ---------- AI camera detection (discreet) ---------- */
function setCamAI(locId, camId, enabled, ctx = {}) {
  const c = loc(locId).cams[camId];
  if (!c) throw new Error("Unknown camera");
  c.ai = c.ai || {};
  c.ai.enabled = !!enabled;
  persist();
  audit.record({ msg: `AI detection ${enabled ? "ON" : "off"} — ${c.name}`, who: ctx.who, role: ctx.role, category: "ai", loc: locId });
  emitChange(locId, "cams");
  return c;
}
function listAIEvents(locId) { return loc(locId).aiEvents || []; }
// An AI-classified detection (person / loitering / package / vehicle).
function detectAI(locId, camId, type, ctx = {}) {
  const L = loc(locId);
  const c = L.cams[camId];
  if (!c) throw new Error("Unknown camera");
  if (!c.ai || c.ai.enabled === false) throw new Error("AI is off on this camera");
  const t = ["person", "loitering", "package", "vehicle", "intrusion"].includes(type) ? type : "person";
  const confidence = 80 + Math.floor((Date.now() % 1800) / 100); // 80–97%
  const ev = { id: "ai_" + Date.now().toString(36), ts: new Date().toISOString(), camId, camName: c.name, type: t, confidence };
  L.aiEvents = L.aiEvents || [];
  L.aiEvents.unshift(ev);
  L.aiEvents = L.aiEvents.slice(0, 100);

  const threat = ["person", "loitering", "intrusion"].includes(t);
  const armed = L.security.mode !== "disarmed";
  const h = new Date().getHours();
  const afterHours = h >= CONFIG.HOURS.afterHoursStart || h < CONFIG.HOURS.afterHoursEnd;
  if (threat) c.alert = true;
  if (threat && armed) { L.security.alarm = true; L.security.siren = true; if (driver.setSiren) driver.setSiren(true); }
  persist();
  audit.record({ msg: `🤖 AI: ${t} detected — ${c.name} (${confidence}%)`, who: ctx.who || "ai", role: "system", category: "ai", loc: locId });
  bus.emit("alert", { loc: locId, camId, name: c.name, locName: L.name, armed, ai: t });
  if (threat && (armed || afterHours))
    bus.emit("push", { title: "LumiOS AI Alert", body: `${t} detected at ${c.name} (${L.name})${armed ? " while armed" : " after hours"}.` });
  emitChange(locId, "cams"); emitChange(locId, "security");
  return ev;
}

/* ---------- medical fridge temperature ---------- */
let fridgeCounter = 0;
function fridgeTick() {
  fridgeCounter++;
  if (fridgeCounter % 10 !== 0) return; // log ~every 5 min at 30s ticks
  let changed = false;
  for (const id in DB.locations) for (const f of (DB.locations[id].fridges || [])) {
    f.readings = f.readings || []; f.readings.unshift({ ts: new Date().toISOString(), temp: f.temp }); f.readings = f.readings.slice(0, 300); changed = true;
  }
  if (changed) persist();
}
function recordFridgeTemp(locId, id, temp, ctx = {}) {
  const f = (loc(locId).fridges || []).find((x) => x.id === id);
  if (!f) throw new Error("Unknown fridge");
  f.temp = Math.round(+temp * 10) / 10;
  f.readings = f.readings || []; f.readings.unshift({ ts: new Date().toISOString(), temp: f.temp }); f.readings = f.readings.slice(0, 300);
  const wasOk = f.status !== "alarm";
  f.status = (f.temp < f.min || f.temp > f.max) ? "alarm" : "ok";
  persist();
  if (f.status === "alarm" && wasOk) {
    audit.record({ msg: `🌡️ Fridge "${f.name}" OUT OF RANGE — ${f.temp}°F (safe ${f.min}–${f.max}°F)`, who: ctx.who || "sensor", role: "system", category: "alert", loc: locId });
    bus.emit("push", { title: "🌡️ LumiOS Fridge Alert", body: `${f.name} at ${f.temp}°F — outside the safe range.` });
  }
  emitChange(locId, "fridges");
  return f;
}
function listFridgeReadings(locId) {
  const rows = [];
  for (const f of (loc(locId).fridges || [])) for (const r of (f.readings || [])) rows.push({ fridge: f.name, ...r, min: f.min, max: f.max, ok: r.temp >= f.min && r.temp <= f.max ? "OK" : "OUT" });
  return rows.sort((a, b) => b.ts.localeCompare(a.ts));
}

/* ---------- room turnover board ---------- */
function setRoomStatus(locId, roomId, status, ctx = {}) {
  if (!["ready", "inuse", "cleaning"].includes(status)) throw new Error("Invalid status");
  const t = loc(locId).turnover; if (!t[roomId]) t[roomId] = {};
  t[roomId].status = status; t[roomId].since = Date.now(); t[roomId].by = ctx.who || null;
  persist();
  audit.record({ msg: `Room turnover — ${roomId}: ${status === "inuse" ? "IN USE" : status === "cleaning" ? "needs cleaning" : "ready"}`, who: ctx.who, role: ctx.role, category: "config", loc: locId });
  emitChange(locId, "turnover");
  return t[roomId];
}

/* ---------- opening / closing checklist ---------- */
function ensureChecklistDay(L) {
  const today = new Date().toISOString().slice(0, 10);
  if (L.checklist && L.checklist.date !== today) {
    L.checklist.date = today;
    for (const w of ["open", "close"]) for (const it of L.checklist[w]) it.done = false;
    return true;
  }
  return false;
}
function checklistTick() {
  let changed = false;
  for (const id in DB.locations) if (ensureChecklistDay(DB.locations[id])) { changed = true; emitChange(id, "checklist"); }
  if (changed) persist();
}
function toggleChecklist(locId, which, index, done, ctx = {}) {
  const L = loc(locId); ensureChecklistDay(L);
  const list = L.checklist[which]; if (!list || !list[index]) throw new Error("Bad checklist item");
  list[index].done = !!done;
  persist();
  emitChange(locId, "checklist");
  return list[index];
}

/* ---------- aromatherapy + reception display ---------- */
async function setDiffuser(locId, id, patch, ctx = {}) {
  const L = loc(locId);
  const d = (L.diffusers || []).find((x) => x.id === id);
  if (!d) throw new Error("Unknown diffuser");
  if (patch.on != null) d.on = !!patch.on;
  if (patch.scent != null && L.scents.includes(patch.scent)) d.scent = patch.scent;
  if (patch.intensity != null) d.intensity = clamp(Math.round(+patch.intensity), 0, 100);
  persist();
  if (ctx.log !== false) audit.record({ msg: `Aroma "${d.name}": ${d.on ? d.scent + " @ " + d.intensity + "%" : "off"}`, who: ctx.who, role: ctx.role, category: "config", loc: locId });
  emitChange(locId, "diffusers");
  return d;
}
function setDisplay(locId, patch, ctx = {}) {
  const L = loc(locId);
  if (patch.on != null) L.display.on = !!patch.on;
  if (patch.message != null) L.display.message = String(patch.message).slice(0, 120);
  persist();
  audit.record({ msg: `Reception display ${L.display.on ? `→ "${L.display.message}"` : "off"}`, who: ctx.who, role: ctx.role, category: "config", loc: locId });
  emitChange(locId, "display");
  return L.display;
}

/* ---------- owner daily digest ---------- */
function buildDigest(locId) {
  const L = loc(locId);
  const today = new Date().toISOString().slice(0, 10);
  const todays = audit.list(500).filter((e) => (e.loc || "main") === locId && e.ts.slice(0, 10) === today);
  const alerts = todays.filter((e) => e.category === "alert");
  const power = powerSnapshot(locId);
  return {
    date: today, location: L.name,
    scenesRun: todays.filter((e) => e.category === "scene").length,
    doorEvents: todays.filter((e) => e.category === "door" || e.category === "access").length,
    alerts: alerts.length,
    alertMsgs: alerts.slice(0, 6).map((a) => `${a.t} — ${a.msg}`),
    equipmentOffline: (L.equipment || []).filter((d) => !d.online).map((d) => d.name),
    fridgeAlarms: (L.fridges || []).filter((f) => f.status === "alarm").map((f) => `${f.name} ${f.temp}°F`),
    sterilizationToday: (L.sterilization || []).filter((s) => s.ts.slice(0, 10) === today).length,
    security: L.security.mode, powerkW: (power.totalW / 1000).toFixed(2), monthlyCost: power.monthlyEstimate,
  };
}
// Push the digest at close time (called by scheduler when the Close scene runs).
function pushDigest(locId) {
  const g = buildDigest(locId);
  bus.emit("push", { title: `LumiOS Daily Digest — ${g.location}`, body: `${g.scenesRun} scenes · ${g.doorEvents} door events · ${g.alerts} alerts · ~$${g.monthlyCost}/mo${g.fridgeAlarms.length ? " · ⚠️ fridge alarm" : ""}` });
  audit.record({ msg: "📋 Daily digest sent to owner", who: "system", role: "system", category: "info", loc: locId });
}

/* ---------- motion / alarm ---------- */
function raiseMotion(locId, camId, ctx = {}) {
  const L = loc(locId);
  const c = L.cams[camId];
  if (!c) return;
  c.alert = true;
  const armed = L.security.mode !== "disarmed";
  if (armed) { L.security.alarm = true; L.security.siren = true; if (driver.setSiren) driver.setSiren(true); }
  persist();
  const entry = audit.record({ msg: `${armed ? "🚨 ALARM — " : "⚠️ "}Motion detected — ${c.name}`, who: ctx.who || "sensor", role: "system", category: "alert", loc: locId });
  bus.emit("alert", { loc: locId, camId, name: c.name, locName: L.name, armed, entry });
  if (armed) bus.emit("push", { title: "LumiOS Security Alarm", body: `Motion at ${c.name} (${L.name}) while armed.` });
  emitChange(locId, "cams"); emitChange(locId, "security");
}

module.exports = {
  driverName: driver.name,
  getState, applyExternalState, startDriverSync, hasLocation, listLocations, addLocation, renameLocation, removeLocation,
  addZone, updateZone,
  setDoor, lock, unlock,
  setLight, setCct, setColor, setOneShade, setShadeGroup, setTemp, setSalonTemp, setSalonMode, setMusic, setMusicGroup, setAudioGroup, updateAudioGroups,
  setAutoLight, motion, autoLightTick, applyLightPreset, saveLightPreset, deleteLightPreset,
  setEquipment, addSterilization, listSterilization,
  setCamAI, detectAI, listAIEvents, setSignage,
  panic, silence, triggerSafety, clearSafety,
  fridgeTick, recordFridgeTemp, listFridgeReadings,
  setRoomStatus, checklistTick, toggleChecklist,
  setDiffuser, setDisplay, buildDigest, pushDigest,
  setCamera, getCameraFeed, listLiveCameras, cameraSnapshot, cameraStream, cameraStreamUrl, hlsGet,
  setSecurity, powerSnapshot, setGrid, powerTick,
  raiseMotion,
};
